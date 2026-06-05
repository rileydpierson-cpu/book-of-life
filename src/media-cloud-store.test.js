import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  LOCAL_RETENTION,
  MediaCloudStore,
  isCloudOnlyApprovedRecord,
  isUploadedOriginalRecord
} from './media-cloud-store.js';

describe('media cloud store', () => {
  it('persists desired cloud original state and lists pending items', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bol-media-cloud-'));
    const photo = { id: 'photo-1', size: 128, mtimeMs: 10 };
    const indexer = { getPhoto: (id) => (id === photo.id ? photo : null) };
    const store = new MediaCloudStore({ cacheDir });
    await store.init();
    const queued = await store.setDesired(photo, true);
    expect(queued.status).toBe('queued');

    const reloaded = new MediaCloudStore({ cacheDir });
    await reloaded.init();
    expect((await reloaded.get(photo)).desired).toBe(true);
    expect(await reloaded.listPending(indexer)).toHaveLength(1);
  });

  it('only treats confirmed cloud originals as uploaded', () => {
    expect(isUploadedOriginalRecord({ status: 'cloud', cloudMediaId: 'media-1' })).toBe(true);
    expect(isUploadedOriginalRecord({ status: 'cloud', storagePath: 'media/photo.jpg' })).toBe(true);
    expect(isUploadedOriginalRecord({ status: 'queued', cloudMediaId: 'media-1' })).toBe(false);
    expect(isUploadedOriginalRecord({ status: 'error', storagePath: 'media/photo.jpg' })).toBe(false);
    expect(isUploadedOriginalRecord({ status: 'cloud' })).toBe(false);
  });

  it('requires explicit local retention approval for cloud-only originals', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bol-media-cloud-'));
    const store = new MediaCloudStore({ cacheDir: root });
    await store.init();
    const photo = { id: 'photo-1', size: 100, mtimeMs: 1 };

    await store.update(photo, {
      status: 'cloud',
      cloudMediaId: 'media-1',
      storagePath: 'media/photo.jpg'
    });
    expect(isCloudOnlyApprovedRecord(await store.get(photo))).toBe(false);

    const approved = await store.setLocalRetention(photo, LOCAL_RETENTION.CLOUD_ONLY_APPROVED, 'test');
    expect(approved.localRetention).toBe(LOCAL_RETENTION.CLOUD_ONLY_APPROVED);
    expect(approved.localRetentionSource).toBe('test');
    expect(approved.localRetentionUpdatedAt).toBeTruthy();
    expect(isCloudOnlyApprovedRecord(approved)).toBe(true);
  });
});
