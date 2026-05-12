type EntryRow = {
  iso_date: string;
  raw: string;
  updated_at: string;
  server_version: number;
  deleted: number;
};

type SyncedMediaRow = {
  id: string;
  iso_date: string;
  file_name: string;
  metadata_json: string;
  server_version: number;
  deleted: number;
  cache_path: string;
  pin_state: string;
  cache_updated_at: string;
};

type LocalMediaRow = {
  id: string;
  device_folder_id: string;
  asset_uri: string;
  file_name: string;
  metadata_json: string;
  sync_state: string;
  remote_media_id: string;
  updated_at: string;
};

type PendingMutationRow = {
  id: string;
  type: string;
  entity_id: string;
  payload_json: string;
  base_sequence: number;
  created_at: string;
};

export type TimelineDayView = {
  isoDate: string;
  summary: string;
  journalStatus: 'local' | 'pending' | 'synced';
  syncedMediaCount: number;
  localMediaCount: number;
  remoteOnlyMediaCount: number;
  hasEntry: boolean;
};

export type MediaItemView = {
  key: string;
  id?: string;
  fileName: string;
  isoDate: string;
  mediaType: string;
  sourceStatus: 'local' | 'synced' | 'remote';
  syncState: string;
  cachePath: string;
  assetUri: string;
  remoteMediaId: string;
};

export type MobileLibrarySnapshot = {
  timelineDays: TimelineDayView[];
  mediaItems: MediaItemView[];
  pendingEntryDates: Set<string>;
};

function safeParseJson(raw: string) {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch (error) {
    return {};
  }
}

function summarizeEntry(raw: string) {
  const normalized = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Empty entry';
  return normalized.length > 96 ? `${normalized.slice(0, 96)}...` : normalized;
}

function isoDateFromTimestamp(value: unknown) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp)) return '';
  return new Date(timestamp).toISOString().slice(0, 10);
}

function incrementCount(map: Map<string, number>, key: string) {
  if (!key) return;
  map.set(key, Number(map.get(key) || 0) + 1);
}

export function buildMobileLibrarySnapshot(input: {
  entries: EntryRow[];
  syncedMedia: SyncedMediaRow[];
  localMedia: LocalMediaRow[];
  pendingMutations: PendingMutationRow[];
  hasConnection: boolean;
}) {
  const pendingEntryDates = new Set(
    (input.pendingMutations || [])
      .filter((mutation) => mutation.type === 'entry.save' && mutation.entity_id)
      .map((mutation) => mutation.entity_id)
  );

  const localByRemoteId = new Map<string, LocalMediaRow>();
  const localMediaItems: MediaItemView[] = [];
  const syncedMediaCountByDate = new Map<string, number>();
  const localMediaCountByDate = new Map<string, number>();
  const remoteOnlyMediaCountByDate = new Map<string, number>();

  for (const item of input.localMedia || []) {
    const metadata = safeParseJson(item.metadata_json);
    const isoDate = isoDateFromTimestamp(metadata.modifiedAt) || isoDateFromTimestamp(metadata.isoDate);
    if (item.remote_media_id) localByRemoteId.set(item.remote_media_id, item);
    incrementCount(localMediaCountByDate, isoDate);
    localMediaItems.push({
      key: `local:${item.id}`,
      fileName: item.file_name,
      isoDate,
      mediaType: String(metadata.type || 'media'),
      sourceStatus: item.remote_media_id ? 'synced' : 'local',
      syncState: item.sync_state,
      cachePath: '',
      assetUri: item.asset_uri,
      remoteMediaId: item.remote_media_id || ''
    });
  }

  const remoteMediaItems: MediaItemView[] = [];
  for (const item of input.syncedMedia || []) {
    const metadata = safeParseJson(item.metadata_json);
    const matchingLocal = item.id ? localByRemoteId.get(item.id) : null;
    incrementCount(syncedMediaCountByDate, item.iso_date);
    if (!matchingLocal) incrementCount(remoteOnlyMediaCountByDate, item.iso_date);
    remoteMediaItems.push({
      key: `remote:${item.id}`,
      id: item.id,
      fileName: item.file_name,
      isoDate: item.iso_date || '',
      mediaType: String(metadata.type || 'media'),
      sourceStatus: matchingLocal ? 'synced' : 'remote',
      syncState: matchingLocal?.sync_state || 'remote-only',
      cachePath: item.cache_path || '',
      assetUri: matchingLocal?.asset_uri || '',
      remoteMediaId: item.id
    });
  }

  const dayMap = new Map<string, TimelineDayView>();
  for (const entry of input.entries || []) {
    if (!entry.iso_date) continue;
    dayMap.set(entry.iso_date, {
      isoDate: entry.iso_date,
      summary: summarizeEntry(entry.raw),
      journalStatus: pendingEntryDates.has(entry.iso_date)
        ? 'pending'
        : (input.hasConnection ? 'synced' : 'local'),
      syncedMediaCount: Number(syncedMediaCountByDate.get(entry.iso_date) || 0),
      localMediaCount: Number(localMediaCountByDate.get(entry.iso_date) || 0),
      remoteOnlyMediaCount: Number(remoteOnlyMediaCountByDate.get(entry.iso_date) || 0),
      hasEntry: true
    });
  }

  for (const [isoDate, count] of syncedMediaCountByDate.entries()) {
    if (!isoDate) continue;
    const current = dayMap.get(isoDate);
    if (current) {
      current.syncedMediaCount = count;
      current.localMediaCount = Number(localMediaCountByDate.get(isoDate) || 0);
      current.remoteOnlyMediaCount = Number(remoteOnlyMediaCountByDate.get(isoDate) || 0);
      continue;
    }
    dayMap.set(isoDate, {
      isoDate,
      summary: 'Media activity',
      journalStatus: input.hasConnection ? 'synced' : 'local',
      syncedMediaCount: count,
      localMediaCount: Number(localMediaCountByDate.get(isoDate) || 0),
      remoteOnlyMediaCount: Number(remoteOnlyMediaCountByDate.get(isoDate) || 0),
      hasEntry: false
    });
  }

  for (const [isoDate, count] of localMediaCountByDate.entries()) {
    if (!isoDate || dayMap.has(isoDate)) continue;
    dayMap.set(isoDate, {
      isoDate,
      summary: 'Local media only',
      journalStatus: 'local',
      syncedMediaCount: Number(syncedMediaCountByDate.get(isoDate) || 0),
      localMediaCount: count,
      remoteOnlyMediaCount: Number(remoteOnlyMediaCountByDate.get(isoDate) || 0),
      hasEntry: false
    });
  }

  const timelineDays = Array.from(dayMap.values()).sort((left, right) => right.isoDate.localeCompare(left.isoDate));
  const mediaItems = [...localMediaItems, ...remoteMediaItems].sort(
    (left, right) => right.isoDate.localeCompare(left.isoDate) || left.fileName.localeCompare(right.fileName)
  );

  return {
    timelineDays,
    mediaItems,
    pendingEntryDates
  } satisfies MobileLibrarySnapshot;
}
