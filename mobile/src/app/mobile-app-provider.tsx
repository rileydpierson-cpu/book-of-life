import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { clearConnection, loadConnection } from '../auth/connection-store';
import { getDeviceFolderSummary, registerDeviceFolder, scanDeviceFolder } from '../device/device-indexer';
import { cacheRemoteMediaVariant } from '../media/media-cache';
import { getSyncStateValue, initializeDatabase, listLocalEntries, listSyncedMediaItems } from '../storage/database';
import { buildTodayIsoDate, saveLocalJournalEntry } from '../storage/local-journal';
import { listLocalMediaAssets } from '../storage/local-media-index';
import { createSyncEngine } from '../sync/sync-engine';
import { listPendingMutations } from '../sync/mutation-queue';
import type { SyncConnection, SyncServerSummary } from '../sync/types';
import {
  buildMobileLibrarySnapshot,
  buildEntryMap,
  type MobileLibrarySnapshot
} from './mobile-library';

type LocalEntryRow = {
  iso_date: string;
  raw: string;
  updated_at: string;
  server_version: number;
  deleted: number;
};

type SyncStatus = {
  lastCheckpoint: number;
  pendingMutations: number;
  localEntries: number;
  localMediaAssets: number;
  pendingMediaUploads: number;
  syncedMediaItems: number;
};

type DeviceFolderSummary = Awaited<ReturnType<typeof getDeviceFolderSummary>>;

type MobileAppContextValue = {
  ready: boolean;
  status: string;
  connection: SyncConnection | null;
  serverSummary: SyncServerSummary | null;
  syncStats: SyncStatus | null;
  deviceFolderSummary: DeviceFolderSummary;
  entryRows: LocalEntryRow[];
  entryMap: Map<string, LocalEntryRow>;
  library: MobileLibrarySnapshot;
  refreshDashboard: () => Promise<void>;
  signInAndSync: (serverUrl: string, username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  performConnectedSync: (options?: { includeBootstrap?: boolean; reason?: string }) => Promise<void>;
  saveJournal: (input: { isoDate: string; raw: string }) => Promise<void>;
  registerFolder: () => Promise<void>;
  scanAndUploadMedia: () => Promise<void>;
  cacheMediaVariant: (input: { photoId: string; fileName: string; variant: 'thumb' | 'preview' | 'full' }) => Promise<void>;
  buildTodayIsoDate: () => string;
};

const MobileAppContext = createContext<MobileAppContextValue | null>(null);

export function MobileAppProvider(props: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Starting local database...');
  const [connection, setConnection] = useState<SyncConnection | null>(null);
  const [serverSummary, setServerSummary] = useState<SyncServerSummary | null>(null);
  const [syncStats, setSyncStats] = useState<SyncStatus | null>(null);
  const [entryRows, setEntryRows] = useState<LocalEntryRow[]>([]);
  const [library, setLibrary] = useState<MobileLibrarySnapshot>({
    timelineDays: [],
    mediaItems: [],
    timelineItems: [],
    pendingEntryDates: new Set(),
    monthSummaries: [],
    yearSummaries: []
  });
  const [deviceFolderSummary, setDeviceFolderSummary] = useState<DeviceFolderSummary>({
    folders: [],
    assetCount: 0
  });

  const syncEngine = useMemo(() => createSyncEngine(), []);

  async function refreshDashboard() {
    const [
      savedConnection,
      savedSummary,
      folderSummary,
      localEntries,
      syncedMedia,
      localMediaAssets,
      pendingMutations,
      nextSyncStatus
    ] = await Promise.all([
      loadConnection(),
      getSyncStateValue('serverSummary'),
      getDeviceFolderSummary(),
      listLocalEntries(),
      listSyncedMediaItems(600),
      listLocalMediaAssets(),
      listPendingMutations(),
      syncEngine.getStatus()
    ]);

    setConnection(savedConnection);
    setServerSummary(parseServerSummary(savedSummary));
    setEntryRows(localEntries);
    setDeviceFolderSummary(folderSummary);
    setSyncStats(nextSyncStatus);
    setLibrary(buildMobileLibrarySnapshot({
      entries: localEntries,
      syncedMedia,
      localMedia: localMediaAssets,
      pendingMutations,
      hasConnection: Boolean(savedConnection?.authToken)
    }));
  }

  async function performConnectedSync(options: { includeBootstrap?: boolean; reason?: string } = {}) {
    const savedConnection = await loadConnection();
    if (!savedConnection) throw new Error('No saved sync connection.');

    const messages: string[] = [];
    if (options.includeBootstrap) {
      const payload = await syncEngine.bootstrap(savedConnection);
      messages.push(`bootstrap ${payload.entries.length} entries`);
    }

    const replay = await syncEngine.replayPendingMutations(savedConnection);
    const uploads = await syncEngine.uploadPendingMedia(savedConnection);
    const pulled = await syncEngine.pullChanges(savedConnection);
    await refreshDashboard();

    messages.push(`entries ${replay.accepted}/${replay.sent}`);
    messages.push(`media ${uploads.uploaded} uploaded`);
    messages.push(`changes ${pulled.changes.length}`);
    setStatus(`${options.reason || 'Sync complete'}: ${messages.join(' | ')}.`);
  }

  async function signInAndSync(serverUrl: string, username: string, password: string) {
    const nextConnection = await syncEngine.connect(serverUrl, username, password);
    setConnection(nextConnection);
    await refreshDashboard();
    await performConnectedSync({ includeBootstrap: true, reason: 'Signed in and synced' });
  }

  async function signOut() {
    await clearConnection();
    setConnection(null);
    await refreshDashboard();
    setStatus('Signed out. The mobile app is running in local-only mode.');
  }

  async function saveJournal(input: { isoDate: string; raw: string }) {
    const saved = await saveLocalJournalEntry({
      isoDate: input.isoDate,
      raw: input.raw
    });
    await syncEngine.queueMutation({
      id: `entry-save-${saved.isoDate}-${Date.now()}`,
      type: 'entry.save',
      entityId: saved.isoDate,
      payload: {
        isoDate: saved.isoDate,
        raw: saved.raw
      }
    });
    await refreshDashboard();
    setStatus(`Saved ${saved.isoDate} locally and queued journal sync.`);

    if (connection?.authToken) {
      try {
        await performConnectedSync({ reason: `Journal synced for ${saved.isoDate}` });
      } catch (error) {
        setStatus(`Saved ${saved.isoDate} locally. Sync is pending: ${(error as Error).message}`);
      }
    }
  }

  async function registerFolderAction() {
    const folder = await registerDeviceFolder();
    await refreshDashboard();
    setStatus(folder ? `Registered folder ${folder.displayName}.` : 'Folder registration cancelled.');
  }

  async function scanAndUploadMedia() {
    const summary = await getDeviceFolderSummary();
    if (!summary.folders.length) throw new Error('No device folder registered yet.');
    for (const folder of summary.folders) {
      await scanDeviceFolder(folder.id);
    }
    await refreshDashboard();
    setStatus(`Indexed local device media. ${summary.folders.length} folder(s), ${summary.assetCount} known asset(s).`);
    if (connection?.authToken) {
      await performConnectedSync({ reason: 'Uploaded device media' });
    }
  }

  async function cacheMediaVariant(input: { photoId: string; fileName: string; variant: 'thumb' | 'preview' | 'full' }) {
    await cacheRemoteMediaVariant(input);
    await refreshDashboard();
    setStatus(`Cached ${input.variant} for ${input.fileName}.`);
  }

  useEffect(() => {
    let cancelled = false;
    initializeDatabase()
      .then(() => refreshDashboard())
      .then(() => {
        if (cancelled) return;
        setReady(true);
        setStatus('Ready. The mobile app now mirrors the web structure while keeping local-first storage intact.');
      })
      .catch((error: Error) => {
        if (!cancelled) setStatus(`Startup failed: ${error.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => ({
    ready,
    status,
    connection,
    serverSummary,
    syncStats,
    deviceFolderSummary,
    entryRows,
    entryMap: buildEntryMap(entryRows),
    library,
    refreshDashboard,
    signInAndSync,
    signOut,
    performConnectedSync,
    saveJournal,
    registerFolder: registerFolderAction,
    scanAndUploadMedia,
    cacheMediaVariant,
    buildTodayIsoDate
  }), [ready, status, connection, serverSummary, syncStats, deviceFolderSummary, entryRows, library]);

  return (
    <MobileAppContext.Provider value={value}>
      {props.children}
    </MobileAppContext.Provider>
  );
}

export function useMobileApp() {
  const context = useContext(MobileAppContext);
  if (!context) throw new Error('useMobileApp must be used inside MobileAppProvider.');
  return context;
}

function parseServerSummary(raw: string | null): SyncServerSummary | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      entries: Number(parsed.entries || 0),
      words: Number(parsed.words || 0),
      syncedMedia: Number(parsed.syncedMedia || 0),
      generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : ''
    };
  } catch (error) {
    return null;
  }
}
