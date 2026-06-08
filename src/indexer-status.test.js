import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { TimelineIndexer, selectImageExifDateInfo } from './indexer.js';
import { LOCAL_RETENTION, MediaCloudStore } from './media-cloud-store.js';

function createConfig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bol-index-status-'));
  return {
    paths: {
      journalVault: path.join(root, 'vault'),
      journalFolderName: 'Journal',
      journalImagesFolderName: 'Images',
      photoFolders: [path.join(root, 'photos')],
      cacheDir: path.join(root, 'cache')
    },
    mediaOptimization: {
      enabled: true,
      imageMaxEdge: 2560,
      imageQuality: 86,
      videoMaxHeight: 1080,
      videoCrf: 22,
      videoPreset: 'medium'
    },
    indexing: { chunkSize: 24 }
  };
}

describe('indexer status', () => {
  it('serializes idle and completed rebuild progress', async () => {
    const config = createConfig();
    fs.mkdirSync(path.join(config.paths.journalVault, config.paths.journalFolderName), { recursive: true });
    fs.mkdirSync(path.join(config.paths.journalVault, config.paths.journalImagesFolderName), { recursive: true });
    fs.mkdirSync(config.paths.photoFolders[0], { recursive: true });
    fs.mkdirSync(config.paths.cacheDir, { recursive: true });

    const indexer = new TimelineIndexer(config);
    expect(indexer.getRebuildStatus().running).toBe(false);
    await indexer.rebuild('test');
    const status = indexer.getRebuildStatus();
    expect(status.running).toBe(false);
    expect(status.percent).toBe(100);
    expect(status.completedAt).toBeTruthy();
  });
});

describe('media date selection', () => {
  it('prefers image EXIF modified date over capture and create dates', () => {
    const modified = new Date('2024-02-18T01:53:10.000Z');
    const captured = new Date('2026-05-31T22:59:28.000Z');

    const dateInfo = selectImageExifDateInfo({
      DateTimeOriginal: captured,
      CreateDate: captured,
      ModifyDate: modified
    });

    expect(dateInfo.capturedAtDate).toBe(modified);
    expect(dateInfo.modifiedAtDate).toBe(modified);
    expect(dateInfo.source).toBe('exif-modified');
  });

  it('uses filesystem modified time before filesystem created time when EXIF is missing', async () => {
    const config = createConfig();
    fs.mkdirSync(config.paths.photoFolders[0], { recursive: true });
    fs.mkdirSync(config.paths.cacheDir, { recursive: true });
    const filePath = path.join(config.paths.photoFolders[0], '1000008973.jpg');
    fs.writeFileSync(filePath, '');

    const indexer = new TimelineIndexer(config);
    const dateInfo = await indexer.extractMediaDateInfo(filePath, {
      mtimeMs: Date.parse('2024-02-18T01:53:10.000Z'),
      birthtimeMs: Date.parse('2026-05-31T22:59:28.050Z')
    });

    expect(dateInfo.capturedAt).toBe('2024-02-18T01:53:10.000Z');
    expect(dateInfo.source).toBe('filesystem-modified');
  });
});

describe('missing media availability', () => {
  async function createIndexedPhoto({ cloudUploaded = false, localRetention = LOCAL_RETENTION.UNKNOWN } = {}) {
    const config = createConfig();
    fs.mkdirSync(path.join(config.paths.journalVault, config.paths.journalFolderName), { recursive: true });
    fs.mkdirSync(path.join(config.paths.journalVault, config.paths.journalImagesFolderName), { recursive: true });
    fs.mkdirSync(config.paths.photoFolders[0], { recursive: true });
    fs.mkdirSync(config.paths.cacheDir, { recursive: true });
    const filePath = path.join(config.paths.photoFolders[0], 'photo.jpg');
    fs.writeFileSync(filePath, 'first');
    fs.utimesSync(filePath, new Date('2024-01-01T00:00:00.000Z'), new Date('2024-01-01T00:00:00.000Z'));

    const mediaCloudStore = new MediaCloudStore({ cacheDir: config.paths.cacheDir });
    await mediaCloudStore.init();
    const indexer = new TimelineIndexer(config);
    indexer.setMediaCloudStore(mediaCloudStore);
    await indexer.rebuild('test');
    const photo = Array.from(indexer.state.photosById.values())[0];
    if (cloudUploaded) {
      await mediaCloudStore.update(photo, {
        status: 'cloud',
        desired: true,
        cloudMediaId: 'cloud-media-1',
        storagePath: 'media/photo.jpg',
        localRetention
      });
    }
    return { config, indexer, filePath, photo };
  }

  it('preserves cloud-uploaded photos as risk warnings when externally deleted without local approval', async () => {
    const { indexer, filePath, photo } = await createIndexedPhoto({ cloudUploaded: true });
    fs.rmSync(filePath);

    await indexer.refreshFromFilesystem('test-delete');

    const preserved = indexer.getPhoto(photo.id);
    expect(preserved).toBeTruthy();
    expect(preserved.availability).toBe('missing-cloud-risk');
    expect(preserved.originalAvailable).toBe(false);
    expect(indexer.getRootAvailabilitySummary().warningCount).toBe(1);
    expect(indexer.getRootAvailabilitySummary().missingCloudRiskCount).toBe(1);
  });

  it('preserves approved cloud-only photos without counting them as warnings', async () => {
    const { indexer, filePath, photo } = await createIndexedPhoto({
      cloudUploaded: true,
      localRetention: LOCAL_RETENTION.CLOUD_ONLY_APPROVED
    });
    fs.rmSync(filePath);

    await indexer.refreshFromFilesystem('test-cloud-only');

    const preserved = indexer.getPhoto(photo.id);
    expect(preserved).toBeTruthy();
    expect(preserved.availability).toBe('cloud-only');
    expect(preserved.originalAvailable).toBe(false);
    const summary = indexer.getRootAvailabilitySummary();
    expect(summary.warningCount).toBe(0);
    expect(summary.cloudOnlyCount).toBe(1);
  });

  it('preserves local-only photos as unapproved warnings when externally deleted', async () => {
    const { indexer, filePath, photo } = await createIndexedPhoto({ cloudUploaded: false });
    fs.rmSync(filePath);

    await indexer.refreshFromFilesystem('test-delete');

    const preserved = indexer.getPhoto(photo.id);
    expect(preserved).toBeTruthy();
    expect(preserved.availability).toBe('missing-unapproved');
    const summary = indexer.getRootAvailabilitySummary();
    expect(summary.warningCount).toBe(1);
    expect(summary.missingUnapprovedCount).toBe(1);
  });

  it('removes media without creating warnings when Book of Life deletes it', async () => {
    const { indexer, filePath, photo } = await createIndexedPhoto({ cloudUploaded: false });
    fs.rmSync(filePath);

    await indexer.removeMediaFile(photo.id);

    expect(indexer.getPhoto(photo.id)).toBeNull();
    expect(indexer.getRootAvailabilitySummary().warningCount).toBe(0);
  });

  it('preserves all previous photos when a root is unavailable', async () => {
    const config = createConfig();
    fs.mkdirSync(path.join(config.paths.journalVault, config.paths.journalFolderName), { recursive: true });
    fs.mkdirSync(path.join(config.paths.journalVault, config.paths.journalImagesFolderName), { recursive: true });
    fs.mkdirSync(config.paths.photoFolders[0], { recursive: true });
    fs.mkdirSync(config.paths.cacheDir, { recursive: true });
    fs.writeFileSync(path.join(config.paths.photoFolders[0], 'cloud.jpg'), 'cloud');
    fs.writeFileSync(path.join(config.paths.photoFolders[0], 'local.jpg'), 'local');

    const mediaCloudStore = new MediaCloudStore({ cacheDir: config.paths.cacheDir });
    await mediaCloudStore.init();
    const indexer = new TimelineIndexer(config);
    indexer.setMediaCloudStore(mediaCloudStore);
    await indexer.rebuild('test');
    const photos = Array.from(indexer.state.photosById.values());
    const cloudPhoto = photos.find((item) => item.fileName === 'cloud.jpg');
    const localPhoto = photos.find((item) => item.fileName === 'local.jpg');
    await mediaCloudStore.update(cloudPhoto, {
      status: 'cloud',
      desired: true,
      cloudMediaId: 'cloud-media-1',
      storagePath: 'media/cloud.jpg'
    });

    fs.rmSync(config.paths.photoFolders[0], { recursive: true, force: true });
    await indexer.refreshFromFilesystem('test-root-missing');

    expect(indexer.getPhoto(cloudPhoto.id)?.availability).toBe('root-unavailable');
    expect(indexer.getPhoto(localPhoto.id)?.availability).toBe('root-unavailable');
    expect(indexer.getRootAvailabilitySummary().rootUnavailableCount).toBe(2);
    expect(indexer.getRootAvailabilitySummary().warningCount).toBe(2);
  });

  it('recovers unavailable photos when a root reconnects', async () => {
    const { config, indexer, filePath, photo } = await createIndexedPhoto();
    fs.rmSync(config.paths.photoFolders[0], { recursive: true, force: true });
    await indexer.refreshFromFilesystem('test-root-missing');
    expect(indexer.getPhoto(photo.id)?.availability).toBe('root-unavailable');

    fs.mkdirSync(config.paths.photoFolders[0], { recursive: true });
    fs.writeFileSync(filePath, 'first');
    fs.utimesSync(filePath, new Date('2024-01-01T00:00:00.000Z'), new Date('2024-01-01T00:00:00.000Z'));
    await indexer.refreshFromFilesystem('test-root-reconnected');

    const recovered = indexer.getPhoto(photo.id);
    expect(recovered).toBeTruthy();
    expect(recovered.availability).toBe('available');
    expect(recovered.originalAvailable).toBe(true);
    expect(indexer.getRootAvailabilitySummary().warningCount).toBe(0);
  });

  it('changes thumbnail versions when a file signature changes', async () => {
    const { indexer, filePath, photo } = await createIndexedPhoto();
    const before = indexer.thumbUrlForPhoto(photo);
    fs.writeFileSync(filePath, 'second-version');
    fs.utimesSync(filePath, new Date('2024-01-02T00:00:00.000Z'), new Date('2024-01-02T00:00:00.000Z'));

    await indexer.refreshFromFilesystem('test-edit');

    const updated = indexer.getPhoto(photo.id);
    expect(updated).toBeTruthy();
    expect(indexer.thumbUrlForPhoto(updated)).not.toBe(before);
  });

  it('serializes local media beneath the registered device root with locations', async () => {
    const { indexer, photo } = await createIndexedPhoto();
    indexer.setDeviceIdentity({ id: 'desktop-1', name: 'Rilo Desktop', type: 'desktop' });

    const serialized = indexer.serializePhoto(photo);

    expect(serialized.folderRootLabel).toBe('Rilo Desktop');
    expect(serialized.fileName).toBe('photo.jpg');
    expect(serialized.locations[0]).toMatchObject({
      deviceId: 'desktop-1',
      deviceName: 'Rilo Desktop',
      localMediaId: photo.id,
      availability: 'available'
    });
  });
});
