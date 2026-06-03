import { describe, expect, it } from 'vitest';
import {
  CLOUD_STORAGE_LIMIT_BYTES,
  desktopTrayStatus,
  normalizeCloudStorageUsage
} from './desktop-tray-status.js';

describe('desktop tray status', () => {
  it('returns a local-only shape when signed out', () => {
    const status = desktopTrayStatus({
      localService: { running: true, port: 3131, url: 'http://127.0.0.1:3131' },
      cloudStatus: { configured: true, signedIn: false },
      indexStatus: { running: false, percent: 100 }
    });
    expect(status.localService.running).toBe(true);
    expect(status.cloud.signedIn).toBe(false);
    expect(status.storage.available).toBe(false);
    expect(status.storage.usedBytes).toBe(0);
    expect(status.storage.limitBytes).toBe(CLOUD_STORAGE_LIMIT_BYTES);
  });

  it('normalizes zero cloud storage usage', () => {
    expect(normalizeCloudStorageUsage({ usedBytes: 0 })).toEqual({
      available: true,
      usedBytes: 0,
      limitBytes: CLOUD_STORAGE_LIMIT_BYTES,
      percent: 0,
      error: ''
    });
  });

  it('calculates storage percent against the 1 GB basic plan', () => {
    const usage = normalizeCloudStorageUsage({ usedBytes: CLOUD_STORAGE_LIMIT_BYTES / 2 });
    expect(usage.percent).toBe(50);
    expect(usage.limitBytes).toBe(CLOUD_STORAGE_LIMIT_BYTES);
  });
});
