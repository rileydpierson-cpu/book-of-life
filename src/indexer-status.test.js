import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { TimelineIndexer } from './indexer.js';

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
