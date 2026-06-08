import { describe, expect, it } from 'vitest';
import {
  CLOUD_STORAGE_LIMIT_BYTES,
  desktopTrayStatus,
  normalizeSyncStatus,
  normalizeCloudStorageUsage,
  normalizeMediaAvailability,
  normalizeJournalMirrorStatus,
  normalizeThumbnailStatus
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

  it('includes tracked cloud sync state for the tray', () => {
    const status = desktopTrayStatus({
      cloudStatus: {
        configured: true,
        signedIn: true,
        email: 'rilo@example.com',
        lastCloudSyncAt: '2026-06-03T16:00:00.000Z'
      },
      syncStatus: {
        running: true,
        queued: true,
        reason: 'manual',
        startedAt: '2026-06-03T16:01:00.000Z',
        pushed: 2,
        pulled: 3
      }
    });
    expect(status.cloud.signedIn).toBe(true);
    expect(status.sync.running).toBe(true);
    expect(status.sync.queued).toBe(true);
    expect(status.sync.reason).toBe('manual');
    expect(status.sync.lastSyncedAt).toBe('2026-06-03T16:00:00.000Z');
    expect(status.sync.pushed).toBe(2);
    expect(status.sync.pulled).toBe(3);
  });

  it('normalizes empty sync state', () => {
    expect(normalizeSyncStatus()).toEqual({
      running: false,
      queued: false,
      reason: '',
      startedAt: '',
      completedAt: '',
      lastSyncedAt: '',
      pushed: 0,
      pulled: 0,
      phase: '',
      current: 0,
      total: 0,
      percent: 0,
      message: '',
      error: ''
    });
  });

  it('includes media availability warnings for the tray', () => {
    const mediaAvailability = normalizeMediaAvailability({
      warningCount: 2,
      missingCloudCount: 2,
      rootUnavailableCount: 1,
      cloudOnlyCount: 3,
      missingUnapprovedCount: 1,
      missingCloudRiskCount: 1,
      roots: [{ path: '/Photos', rootLabel: 'Photos', available: false, warningCount: 2, error: 'missing' }]
    });
    expect(mediaAvailability.warningCount).toBe(2);
    expect(mediaAvailability.cloudOnlyCount).toBe(3);
    expect(mediaAvailability.missingUnapprovedCount).toBe(1);
    expect(mediaAvailability.missingCloudRiskCount).toBe(1);
    expect(mediaAvailability.roots[0].available).toBe(false);

    const status = desktopTrayStatus({ mediaAvailability });
    expect(status.mediaAvailability.warningCount).toBe(2);
    expect(status.mediaAvailability.roots[0].warningCount).toBe(2);
  });

  it('includes journal mirror status for the tray', () => {
    const journalMirror = normalizeJournalMirrorStatus({
      configured: true,
      status: 'unavailable',
      localDir: '/App/Journal',
      mirrorDir: '/External/Journal',
      available: false,
      conflictCount: 2,
      error: 'missing'
    });
    expect(journalMirror.configured).toBe(true);
    expect(journalMirror.status).toBe('unavailable');
    expect(journalMirror.conflictCount).toBe(2);

    const status = desktopTrayStatus({ journalMirror });
    expect(status.journalMirror.mirrorDir).toBe('/External/Journal');
    expect(status.journalMirror.available).toBe(false);
  });

  it('includes normalized thumbnail generation progress', () => {
    const thumbnails = normalizeThumbnailStatus({
      running: true,
      queued: true,
      current: 3,
      total: 8,
      percent: 38,
      generated: 2,
      failed: 1,
      startedAt: '2026-06-07T12:00:00.000Z',
      error: 'one file failed'
    });
    const status = desktopTrayStatus({ thumbnailStatus: thumbnails });

    expect(status.thumbnails).toEqual({
      ...thumbnails,
      completedAt: ''
    });
  });
});
