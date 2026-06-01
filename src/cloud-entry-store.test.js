import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { CloudEntryStore } from './cloud-entry-store.js';

describe('cloud entry store', () => {
  it('keeps canonical entries scoped by user and library', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bol-cloud-entries-'));
    const store = new CloudEntryStore({ cacheDir });
    await store.init();
    await store.saveEntry({ userId: 'user-a', libraryId: 'lib', deviceId: 'desktop' }, {
      isoDate: '2026-05-11',
      raw: 'A'
    });
    await store.saveEntry({ userId: 'user-b', libraryId: 'lib', deviceId: 'desktop' }, {
      isoDate: '2026-05-11',
      raw: 'B'
    });
    expect(store.listEntries({ userId: 'user-a', libraryId: 'lib' })[0].raw).toBe('A');
    expect(store.listEntries({ userId: 'user-b', libraryId: 'lib' })[0].raw).toBe('B');
  });

  it('records revisions and reports version conflicts', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bol-cloud-entries-'));
    const store = new CloudEntryStore({ cacheDir });
    await store.init();
    const first = await store.saveEntry({ userId: 'user-a', libraryId: 'lib', deviceId: 'desktop' }, {
      isoDate: '2026-05-11',
      raw: 'First'
    });
    const second = await store.saveEntry({ userId: 'user-a', libraryId: 'lib', deviceId: 'phone' }, {
      isoDate: '2026-05-11',
      raw: 'Second',
      baseCloudVersion: first.entry.cloudVersion
    });
    const conflicted = await store.saveEntry({ userId: 'user-a', libraryId: 'lib', deviceId: 'web' }, {
      isoDate: '2026-05-11',
      raw: 'Third',
      baseCloudVersion: first.entry.cloudVersion
    });
    expect(second.conflict).toBe(false);
    expect(conflicted.conflict).toBe(true);
    expect(store.getRevisions({ userId: 'user-a', libraryId: 'lib' }, '2026-05-11')).toHaveLength(2);
  });
});
