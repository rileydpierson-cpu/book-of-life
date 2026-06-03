import { describe, expect, it } from 'vitest';
import { SupabaseDesktopSync } from './supabase-desktop-sync.js';

function createHarness({ settings: initialSettings, dirtyEntries = [] } = {}) {
  let settings = {
    userId: 'user',
    libraryId: 'lib',
    deviceId: 'device',
    cloudSession: { accessToken: 'token' },
    ...initialSettings
  };
  const cleanMarks = [];
  const savedEntries = [];
  const writtenEntries = [];
  const sync = new SupabaseDesktopSync({
    settingsStore: {
      async getSettings() {
        return settings;
      },
      async saveSettings(next) {
        settings = { ...settings, ...(next || {}) };
        return settings;
      }
    },
    cloudEntryStore: {
      listEntries: () => dirtyEntries,
      listDirtyEntries: () => dirtyEntries,
      getEntry: (_scope, isoDate) => savedEntries.find((entry) => entry.isoDate === isoDate) || null,
      async saveEntry(_scope, input) {
        savedEntries.push(input);
        return { entry: input };
      },
      async markEntryClean(_scope, isoDate, updates) {
        cleanMarks.push({ isoDate, updates });
      }
    },
    indexer: {
      async saveEntry(isoDate, raw) {
        writtenEntries.push({ isoDate, raw });
      }
    }
  });
  sync.ensureReadySettings = async () => settings;
  return {
    sync,
    getSettings: () => settings,
    cleanMarks,
    savedEntries,
    writtenEntries
  };
}

describe('supabase desktop entry sync', () => {
  it('baselines the cloud cursor on first run without fetching historical entries', async () => {
    const harness = createHarness();
    let changeFetches = 0;
    harness.sync.entrySummary = async () => ({ cursor: 12, latestChangedAt: '2026-06-03T12:00:00Z', changeCount: 12 });
    harness.sync.listRemoteChanges = async () => {
      changeFetches += 1;
      return { cursor: 12, changes: [] };
    };

    const result = await harness.sync.syncEntries();
    expect(result.noop).toBe(true);
    expect(result.cursor).toBe(12);
    expect(harness.getSettings().entryChangeCursor).toBe(12);
    expect(changeFetches).toBe(0);
  });

  it('does not fetch changes when the cloud cursor is unchanged and no local entries are dirty', async () => {
    const harness = createHarness({
      settings: {
        entryInitialSyncCompletedAt: '2026-06-03T12:00:00Z',
        entryChangeCursor: 9
      }
    });
    harness.sync.entrySummary = async () => ({ cursor: 9, latestChangedAt: '2026-06-03T12:00:00Z', changeCount: 9 });
    harness.sync.listRemoteChanges = async () => {
      throw new Error('changes should not be fetched');
    };

    const result = await harness.sync.syncEntries();
    expect(result.noop).toBe(true);
    expect(result.pushed).toBe(0);
    expect(result.pulled).toBe(0);
  });

  it('fetches and writes only cloud changes after the saved cursor', async () => {
    const harness = createHarness({
      settings: {
        entryInitialSyncCompletedAt: '2026-06-03T12:00:00Z',
        entryChangeCursor: 4
      }
    });
    let sinceValue = 0;
    let suppressions = 0;
    harness.sync.entrySummary = async () => ({ cursor: 5, latestChangedAt: '2026-06-03T13:00:00Z', changeCount: 5 });
    harness.sync.listRemoteChanges = async (_settings, since) => {
      sinceValue = since;
      return {
        cursor: 5,
        changes: [{
          id: 5,
          change_type: 'entry.upsert',
          entity_id: '2026-06-03',
          changed_at: '2026-06-03T13:00:00Z',
          payload: {
            entry: {
              isoDate: '2026-06-03',
              raw: 'Remote change',
              cloudVersion: 2,
              updatedAt: '2026-06-03T13:00:00Z'
            }
          }
        }]
      };
    };
    harness.sync.onBeforeLocalEntryWrite = async () => {
      suppressions += 1;
    };

    const result = await harness.sync.syncEntries();
    expect(sinceValue).toBe(4);
    expect(result.pulled).toBe(1);
    expect(harness.writtenEntries).toEqual([{ isoDate: '2026-06-03', raw: 'Remote change' }]);
    expect(suppressions).toBe(1);
  });

  it('pushes local dirty entries once and advances to the latest cloud cursor', async () => {
    const dirtyEntry = {
      isoDate: '2026-06-04',
      raw: 'Local change',
      cloudVersion: 1,
      updatedAt: '2026-06-04T10:00:00Z',
      dirty: true
    };
    const harness = createHarness({
      settings: {
        entryInitialSyncCompletedAt: '2026-06-03T12:00:00Z',
        entryChangeCursor: 8
      },
      dirtyEntries: [dirtyEntry]
    });
    const cursors = [8, 11];
    harness.sync.entrySummary = async () => ({ cursor: cursors.shift() || 11, latestChangedAt: '2026-06-04T10:00:00Z', changeCount: 11 });
    harness.sync.saveRemoteEntry = async () => ({
      iso_date: dirtyEntry.isoDate,
      raw: dirtyEntry.raw,
      cloud_version: 2,
      updated_at: '2026-06-04T10:01:00Z'
    });

    const result = await harness.sync.syncEntries();
    expect(result.pushed).toBe(1);
    expect(result.cursor).toBe(11);
    expect(harness.cleanMarks[0].isoDate).toBe('2026-06-04');
    expect(harness.getSettings().entryChangeCursor).toBe(11);
  });
});
