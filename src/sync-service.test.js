import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { SyncService } from './sync-service.js';
import { MUTATION_TYPES } from '../shared/sync-contracts.js';

function createFakeIndexer() {
  const entries = new Map();
  const photos = new Map([
    ['photo-1', {
      id: 'photo-1',
      isoDate: '2026-05-10',
      fileName: 'image.jpg',
      baseName: 'image',
      type: 'photo',
      size: 1,
      ext: '.jpg',
      filePath: 'D:/Photos/image.jpg',
      capturedAt: '2026-05-10T12:00:00.000Z',
      dateSource: 'manual',
      folder: '.',
      folderRootId: '0',
      folderRootLabel: 'Photos',
      relativePath: 'image.jpg',
      tags: [],
      description: '',
      liked: false
    }]
  ]);

  return {
    state: {
      generatedAt: '2026-05-11T00:00:00.000Z',
      dayKeys: [],
      days: new Map(),
      photosById: photos
    },
    getBootstrap() {
      return { totalDays: this.state.dayKeys.length };
    },
    serializePhoto(photo) {
      return { ...photo, thumbUrl: '/media/thumb/photo-1', previewUrl: '', fullUrl: '/media/full/photo-1', dateLabel: 'May 10, 2026', width: 0, height: 0 };
    },
    serializeDay(isoDate) {
      return {
        isoDate,
        journal: {
          title: 'Entry',
          wordCount: (entries.get(isoDate) || '').split(/\s+/).filter(Boolean).length
        }
      };
    },
    async saveEntry(isoDate, raw) {
      if (!raw.trim()) {
        entries.delete(isoDate);
        this.state.dayKeys = this.state.dayKeys.filter((item) => item !== isoDate);
        this.state.days.delete(isoDate);
        return null;
      }
      entries.set(isoDate, raw);
      if (!this.state.dayKeys.includes(isoDate)) this.state.dayKeys.push(isoDate);
      this.state.dayKeys.sort();
      this.state.days.set(isoDate, { isoDate, journal: { raw } });
      return { isoDate };
    },
    async setPhotoTags(photoId, tags) {
      const photo = photos.get(photoId);
      if (!photo) return null;
      photo.tags = tags;
      return photo;
    },
    async setPhotoDescription(photoId, description) {
      const photo = photos.get(photoId);
      if (!photo) return null;
      photo.description = description;
      return photo;
    },
    async setPhotoLiked(photoId, liked) {
      const photo = photos.get(photoId);
      if (!photo) return null;
      photo.liked = liked;
      return photo;
    },
    async setPhotoDateTime(photoId, patch) {
      const photo = photos.get(photoId);
      if (!photo) return null;
      if (patch.isoDate) photo.isoDate = patch.isoDate;
      return photo;
    },
    async renamePhoto(photoId, baseName) {
      const photo = photos.get(photoId);
      if (!photo) return null;
      photo.baseName = baseName;
      photo.fileName = `${baseName}${photo.ext}`;
      return photo;
    },
    async movePhoto(photoId, rootId, relativePath) {
      const photo = photos.get(photoId);
      if (!photo) return null;
      photo.folderRootId = rootId;
      photo.folder = relativePath || '.';
      return photo;
    },
    getPhoto(photoId) {
      return photos.get(photoId) || null;
    }
  };
}

describe('sync service', () => {
  it('issues device auth and returns bootstrap payload', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeserver-sync-'));
    const service = new SyncService({
      cacheDir,
      indexer: createFakeIndexer(),
      authenticate: ({ username, password }) => ({ ok: username === 'alice' && password === 'pw123456', username: username || '' }),
      getFolderTree: () => [{ rootId: '0', rootLabel: 'Photos', tree: { label: 'Photos', relativePath: '', mediaCount: 0, children: [] } }],
      createFolder: async (rootId, relativePath, folderName) => ({ rootId, relativePath: [relativePath, folderName].filter(Boolean).join('/') || '.' }),
      deletePhoto: async (photoId) => ({ photoId, isoDate: '2026-05-10', trashedTo: '.trash' }),
      resolveDeviceSyncRoot: async ({ deviceName }) => ({
        rootId: '2',
        rootLabel: 'device-sync',
        deviceFolderName: deviceName,
        baseRelativePath: deviceName
      })
    });
    await service.init();
    const connected = await service.connect({ username: 'alice', password: 'pw123456', deviceName: 'Phone', platform: 'ios' });
    expect(connected.authToken).toBeTruthy();
    expect(connected.syncRoot?.baseRelativePath).toBe('Phone');
    const device = await service.authenticateToken(connected.authToken);
    expect(device.deviceName).toBe('Phone');
    const bootstrap = service.buildBootstrapPayload();
    expect(bootstrap.folders).toHaveLength(1);
    expect(bootstrap.serverSummary.syncedMedia).toBe(1);
  });

  it('applies entry mutations and records changes', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeserver-sync-'));
    const service = new SyncService({
      cacheDir,
      indexer: createFakeIndexer(),
      authenticate: () => ({ ok: true, username: 'alice' }),
      getFolderTree: () => [],
      createFolder: async () => ({ rootId: '0', relativePath: '.' }),
      deletePhoto: async (photoId) => ({ photoId, isoDate: '2026-05-10', trashedTo: '.trash' })
    });
    await service.init();
    const result = await service.applyMutations([{
      id: 'm1',
      type: MUTATION_TYPES.ENTRY_SAVE,
      payload: {
        isoDate: '2026-05-11',
        raw: 'Synced entry'
      }
    }]);
    expect(result.results[0].accepted).toBe(true);
    const changes = await service.listChangesSince(0);
    expect(changes.changes.length).toBeGreaterThan(0);
    expect(changes.serverSummary.entries).toBe(1);
  });

  it('wakes long-polling clients when a change is appended', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeserver-sync-'));
    const service = new SyncService({
      cacheDir,
      indexer: createFakeIndexer(),
      authenticate: () => ({ ok: true, username: 'alice' }),
      getFolderTree: () => [],
      createFolder: async () => ({ rootId: '0', relativePath: '.' }),
      deletePhoto: async (photoId) => ({ photoId, isoDate: '2026-05-10', trashedTo: '.trash' })
    });
    await service.init();

    const waiting = service.waitForChangeAfter(0, 1000);
    await service.appendChange('entry.upsert', '2026-06-05', { entry: { isoDate: '2026-06-05' } });

    await expect(waiting).resolves.toBe(true);
  });
});
