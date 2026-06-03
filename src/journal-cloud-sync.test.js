import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { JournalCloudSync, isoDateFromJournalFileName } from './journal-cloud-sync.js';

describe('journal cloud sync watcher', () => {
  it('parses ISO and written journal filenames', () => {
    expect(isoDateFromJournalFileName('2026-06-03.md')).toBe('2026-06-03');
    expect(isoDateFromJournalFileName('June 3, 2026.md')).toBe('2026-06-03');
  });

  it('suppresses cloud-pulled file writes with matching content', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bol-journal-sync-'));
    const filePath = path.join(dir, '2026-06-03.md');
    fs.writeFileSync(filePath, 'Remote copy');
    let saves = 0;
    const sync = new JournalCloudSync({
      journalDir: dir,
      cloudEntryStore: {
        async saveEntry() {
          saves += 1;
          return { entry: { isoDate: '2026-06-03', raw: 'Remote copy', dirty: true } };
        }
      },
      getScope: async () => ({ userId: 'user', libraryId: 'lib', deviceId: 'desktop' })
    });

    sync.suppressEntryWrite('2026-06-03', 'Remote copy');
    const suppressed = await sync.syncFileToCloud(filePath);
    expect(suppressed.suppressed).toBe(true);
    expect(saves).toBe(0);

    fs.writeFileSync(filePath, 'Local edit');
    const saved = await sync.syncFileToCloud(filePath);
    expect(saved.entry.dirty).toBe(true);
    expect(saves).toBe(1);
  });
});
