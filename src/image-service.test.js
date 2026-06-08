import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { ImageService } from './image-service.js';
import { hash } from './utils.js';

describe('ImageService unavailable originals', () => {
  it('serves cached thumbnails when the original is unavailable', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bol-image-service-'));
    fs.mkdirSync(path.join(cacheDir, 'thumbs'), { recursive: true });
    const photo = {
      id: 'photo-1',
      filePath: path.join(cacheDir, 'missing.jpg'),
      mtimeMs: 123,
      size: 456,
      type: 'image',
      originalAvailable: false,
      availability: 'root-unavailable'
    };
    const key = hash(`${photo.filePath}|${photo.mtimeMs}|${photo.size}|thumb-v6`);
    const cachedThumb = path.join(cacheDir, 'thumbs', `${key}.webp`);
    fs.writeFileSync(cachedThumb, 'cached');
    const sent = {};
    const res = {
      set(name, value) {
        sent[name] = value;
      },
      sendFile(filePath) {
        sent.filePath = filePath;
      }
    };
    const service = new ImageService(
      { paths: { cacheDir }, mediaOptimization: { enabled: true } },
      { getPhoto: () => photo }
    );

    await service.sendThumb(res, photo.id);

    expect(sent.filePath).toBe(cachedThumb);
  });

  it('describes why an unavailable original cannot be opened', () => {
    const service = new ImageService({ paths: { cacheDir: '' } }, { getPhoto: () => null });
    expect(service.originalUnavailableMessage({ availability: 'root-unavailable' })).toContain('Reconnect');
    expect(service.originalUnavailableMessage({ availability: 'cloud-only' })).toContain('cloud');
    expect(service.originalUnavailableMessage({ availability: 'missing-unapproved' })).toContain('missing');
  });
});

describe('ImageService derivative cache state', () => {
  it('reports only missing current derivatives as work', () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bol-image-derivatives-'));
    fs.mkdirSync(path.join(cacheDir, 'thumbs'), { recursive: true });
    const service = new ImageService({ paths: { cacheDir } }, { getPhoto: () => null });
    const image = { id: 'image', filePath: '/photo.jpg', mtimeMs: 1, size: 2, type: 'image' };
    const video = { id: 'video', filePath: '/video.mp4', mtimeMs: 1, size: 2, type: 'video' };

    expect(service.needsDerivatives(image)).toBe(true);
    fs.writeFileSync(service.thumbCachePath(image), '');
    expect(service.needsDerivatives(image)).toBe(false);

    fs.writeFileSync(service.thumbCachePath(video), '');
    expect(service.needsDerivatives(video)).toBe(true);
    fs.writeFileSync(service.videoPreviewCachePath(video), '');
    expect(service.needsDerivatives(video)).toBe(false);
  });
});
