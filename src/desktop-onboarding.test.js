import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  copyImportedEntries,
  desktopOnboardingStatus,
  hasOnboardingSource,
  normalizeOnboardingMediaFolders
} from './desktop-onboarding.js';

describe('desktop onboarding', () => {
  it('treats any configured source as completion', () => {
    expect(hasOnboardingSource({})).toBe(false);
    expect(hasOnboardingSource({ importedEntriesAt: '2026-06-02T00:00:00.000Z' })).toBe(true);
    expect(hasOnboardingSource({ localJournalMirrorPath: '/Journal' })).toBe(true);
    expect(hasOnboardingSource({ mediaFolders: [{ id: 'photos', path: '/Photos', enabled: true }] })).toBe(true);
  });

  it('reports source counts with index status', () => {
    const status = desktopOnboardingStatus({
      settings: {
        onboardingCompletedAt: '2026-06-02T00:00:00.000Z',
        mediaFolders: [{ id: 'photos', path: '/Photos', enabled: true }]
      },
      indexer: { state: { dayKeys: ['2026-06-02'], photosById: new Map([['photo', {}]]) } },
      indexStatus: { running: false }
    });
    expect(status.complete).toBe(true);
    expect(status.sourceCounts.mediaFolders).toBe(1);
    expect(status.sourceCounts.indexedEntries).toBe(1);
    expect(status.sourceCounts.indexedMedia).toBe(1);
  });

  it('does not mark onboarding complete before the user finishes setup', () => {
    const status = desktopOnboardingStatus({
      settings: { mediaFolders: [{ id: 'photos', path: '/Photos', enabled: true }] }
    });
    expect(status.complete).toBe(false);
    expect(status.sourceCounts.mediaFolders).toBe(1);
  });

  it('sets all-originals policy when cloud originals are selected', () => {
    const folders = normalizeOnboardingMediaFolders([{ path: '/Photos' }], 'cloud-originals');
    expect(folders[0].cloudPolicy).toBe('all-originals');
  });

  it('copies markdown entries into app journal filenames', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bol-onboarding-'));
    const source = path.join(root, 'source');
    const destination = path.join(root, 'destination');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, '2026-06-02.md'), 'Today');
    fs.writeFileSync(path.join(source, 'June 3, 2026.md'), 'Tomorrow');

    const result = await copyImportedEntries({ sourceDir: source, destinationJournalDir: destination });

    expect(result.copied).toBe(2);
    expect(fs.readFileSync(path.join(destination, 'June 2, 2026.md'), 'utf8')).toBe('Today');
    expect(fs.readFileSync(path.join(destination, 'June 3, 2026.md'), 'utf8')).toBe('Tomorrow');
  });
});
