import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { TimelineIndexer, selectImageExifDateInfo } from './indexer.js';

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
