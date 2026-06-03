import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { CloudEntryStore, entryContentHash } from './cloud-entry-store.js';

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

  it('tracks dirty entries and can mark pulled entries clean', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bol-cloud-entries-'));
    const scope = { userId: 'user-a', libraryId: 'lib', deviceId: 'desktop' };
    const store = new CloudEntryStore({ cacheDir });
    await store.init();
    await store.saveEntry(scope, {
      isoDate: '2026-05-12',
      raw: 'Local edit'
    });
    await store.saveEntry(scope, {
      isoDate: '2026-05-13',
      raw: 'Pulled edit',
      cloudVersion: 7,
      markClean: true
    });
    expect(store.listDirtyEntries(scope).map((entry) => entry.isoDate)).toEqual(['2026-05-12']);
    await store.markEntryClean(scope, '2026-05-12', { cloudVersion: 3 });
    expect(store.listDirtyEntries(scope)).toHaveLength(0);
    expect(store.getEntry(scope, '2026-05-13').cloudVersion).toBe(7);
  });

  it('does not treat legacy entries without dirty flags as changed', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bol-cloud-entries-'));
    const scope = { userId: 'user-a', libraryId: 'lib', deviceId: 'desktop' };
    const store = new CloudEntryStore({ cacheDir });
    await store.init();
    await store.saveEntry(scope, {
      isoDate: '2026-05-14',
      raw: 'Already cached',
      markClean: true
    });
    const key = 'user-a:lib:2026-05-14';
    delete store.state.entries[key].dirty;
    expect(store.listDirtyEntries(scope)).toHaveLength(0);
  });

  it('marks entries dirty only when content differs from the synced hash', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bol-cloud-entries-'));
    const scope = { userId: 'user-a', libraryId: 'lib', deviceId: 'desktop' };
    const store = new CloudEntryStore({ cacheDir });
    await store.init();
    await store.saveEntry(scope, {
      isoDate: '2026-05-15',
      raw: 'Clean copy',
      markClean: true
    });
    await store.saveEntry(scope, {
      isoDate: '2026-05-15',
      raw: 'Clean copy'
    });
    expect(store.listDirtyEntries(scope)).toHaveLength(0);
    await store.saveEntry(scope, {
      isoDate: '2026-05-15',
      raw: 'Real local edit'
    });
    expect(store.listDirtyEntries(scope)).toHaveLength(1);
    expect(store.getEntry(scope, '2026-05-15').contentHash).toBe(entryContentHash('Real local edit'));
  });
});
