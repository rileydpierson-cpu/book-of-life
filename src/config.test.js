import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

function withCleanConfigEnv(fn) {
  const keys = [
    'LIFESERVER_JOURNAL_VAULT',
    'LIFESERVER_PHOTO_FOLDERS',
    'LIFESERVER_PHOTO_ROOT',
    'LIFESERVER_DEVICE_SYNC_ROOT',
    'LIFESERVER_INCLUDE_DEVICE_SYNC_ROOT',
    'LIFESERVER_CACHE_DIR',
    'LIFESERVER_AUTH_USER_STORE'
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
}

describe('loadConfig', () => {
  it('does not create configured media roots during startup', async () => {
    await withCleanConfigEnv(() => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bol-config-'));
      fs.writeFileSync(path.join(projectRoot, 'blocked'), 'not a directory');
      fs.writeFileSync(path.join(projectRoot, 'config.json'), JSON.stringify({
        paths: {
          journalVault: './vault',
          photoFolders: ['./blocked/Photos'],
          deviceSyncRoot: './device-sync',
          cacheDir: './cache'
        }
      }));

      const config = loadConfig(projectRoot);

      expect(config.paths.photoFolders).toContain(path.join(projectRoot, 'blocked', 'Photos'));
      expect(fs.existsSync(path.join(projectRoot, 'vault', 'Journal'))).toBe(true);
      expect(fs.existsSync(path.join(projectRoot, 'vault', 'Images'))).toBe(true);
      expect(fs.existsSync(path.join(projectRoot, 'device-sync'))).toBe(true);
      expect(fs.existsSync(path.join(projectRoot, 'cache', 'thumbs'))).toBe(true);
    });
  });
});
