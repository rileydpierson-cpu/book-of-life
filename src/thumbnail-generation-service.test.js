import { describe, expect, it, vi } from 'vitest';
import { ThumbnailGenerationService } from './thumbnail-generation-service.js';

describe('ThumbnailGenerationService', () => {
  it('deduplicates media, skips cached derivatives, and reports progress', async () => {
    const generated = [];
    const imageService = {
      needsDerivatives: (photo) => photo.id !== 'cached',
      ensureThumb: vi.fn(async (photo) => generated.push(`thumb:${photo.id}`)),
      ensureVideoPreview: vi.fn(async (photo) => generated.push(`preview:${photo.id}`))
    };
    const service = new ThumbnailGenerationService({ imageService, concurrency: 1 });
    service.queuePhotos([
      { id: 'image', type: 'image' },
      { id: 'image', type: 'image' },
      { id: 'video', type: 'video' },
      { id: 'cached', type: 'image' }
    ]);

    await service.run();

    expect(generated).toEqual(['thumb:image', 'thumb:video', 'preview:video']);
    expect(service.getStatus()).toMatchObject({
      running: false,
      queued: false,
      current: 2,
      total: 2,
      percent: 100,
      generated: 2,
      failed: 0
    });
  });

  it('continues after individual failures', async () => {
    const imageService = {
      needsDerivatives: () => true,
      ensureThumb: vi.fn(async (photo) => {
        if (photo.id === 'bad') throw new Error('broken media');
      }),
      ensureVideoPreview: vi.fn()
    };
    const service = new ThumbnailGenerationService({ imageService, concurrency: 1 });
    service.queuePhotos([{ id: 'bad', type: 'image' }, { id: 'good', type: 'image' }]);

    await service.run();

    expect(imageService.ensureThumb).toHaveBeenCalledTimes(2);
    expect(service.getStatus()).toMatchObject({ generated: 1, failed: 1, error: 'broken media' });
  });

  it('accepts deduplicated follow-up work while a run is active', async () => {
    let releaseFirst;
    const firstBlocked = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const imageService = {
      needsDerivatives: () => true,
      ensureThumb: vi.fn(async (photo) => {
        if (photo.id === 'first') await firstBlocked;
      }),
      ensureVideoPreview: vi.fn()
    };
    const service = new ThumbnailGenerationService({ imageService, concurrency: 1 });
    service.queuePhotos([{ id: 'first', type: 'image' }]);
    const run = service.run();
    await Promise.resolve();

    expect(service.getStatus().running).toBe(true);
    service.queuePhotos([{ id: 'second', type: 'image' }, { id: 'second', type: 'image' }]);
    releaseFirst();
    await run;

    expect(imageService.ensureThumb).toHaveBeenCalledTimes(2);
    expect(service.getStatus()).toMatchObject({ current: 2, total: 2, generated: 2, queued: false });
  });
});
