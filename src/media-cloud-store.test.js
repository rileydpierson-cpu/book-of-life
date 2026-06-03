import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { MediaCloudStore } from './media-cloud-store.js';

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
});
