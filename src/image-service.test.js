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
