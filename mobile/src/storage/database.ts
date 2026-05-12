import * as SQLite from 'expo-sqlite';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export type EntryRecord = {
  isoDate: string;
  raw: string;
  updatedAt?: string;
  serverVersion?: number;
  deleted?: boolean;
};

export type MediaRecord = {
  id: string;
  isoDate?: string;
  fileName?: string;
  serverVersion?: number;
  deleted?: boolean;
  [key: string]: unknown;
};

export type FolderRecord = {
  id: string;
  rootId: string;
  relativePath: string;
  label: string;
  serverVersion?: number;
  deleted?: boolean;
  [key: string]: unknown;
};

export async function getDatabase() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync('lifeserver-mobile.db');
  }
  return databasePromise;
}

export async function initializeDatabase() {
  const db = await getDatabase();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS entries (
      iso_date TEXT PRIMARY KEY NOT NULL,
      raw TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      server_version INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS media_items (
      id TEXT PRIMARY KEY NOT NULL,
      iso_date TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      server_version INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY NOT NULL,
      root_id TEXT NOT NULL DEFAULT '',
      relative_path TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      server_version INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sync_mutations (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      entity_id TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL,
      base_sequence INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media_cache (
      id TEXT PRIMARY KEY NOT NULL,
      cache_path TEXT NOT NULL DEFAULT '',
      pin_state TEXT NOT NULL DEFAULT 'none',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS device_folders (
      id TEXT PRIMARY KEY NOT NULL,
      folder_uri TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      sync_enabled INTEGER NOT NULL DEFAULT 1,
      local_index_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS local_media_assets (
      id TEXT PRIMARY KEY NOT NULL,
      device_folder_id TEXT NOT NULL DEFAULT '',
      asset_uri TEXT NOT NULL,
      file_name TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      sync_state TEXT NOT NULL DEFAULT 'local-only',
      remote_media_id TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
  `);
}

export async function getSyncStateValue(key: string) {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(`SELECT value FROM sync_state WHERE key = ?`, [key]);
  return row?.value ?? null;
}

export async function setSyncStateValue(key: string, value: string) {
  const db = await getDatabase();
  await db.runAsync(`INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)`, [key, value]);
}

export async function upsertEntryRecords(entries: EntryRecord[]) {
  if (!entries.length) return;
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (const entry of entries) {
      await db.runAsync(
        `INSERT OR REPLACE INTO entries (iso_date, raw, updated_at, server_version, deleted)
         VALUES (?, ?, ?, ?, ?)`,
        [
          entry.isoDate,
          entry.raw || '',
          entry.updatedAt || '',
          Number(entry.serverVersion || 0),
          entry.deleted ? 1 : 0
        ]
      );
    }
  });
}

export async function upsertMediaRecords(media: MediaRecord[]) {
  if (!media.length) return;
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (const item of media) {
      await db.runAsync(
        `INSERT OR REPLACE INTO media_items (id, iso_date, file_name, metadata_json, server_version, deleted)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          item.id,
          String(item.isoDate || ''),
          String(item.fileName || ''),
          JSON.stringify(item),
          Number(item.serverVersion || 0),
          item.deleted ? 1 : 0
        ]
      );
    }
  });
}

export async function upsertFolderRecords(folders: FolderRecord[]) {
  if (!folders.length) return;
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (const folder of folders) {
      await db.runAsync(
        `INSERT OR REPLACE INTO folders (id, root_id, relative_path, label, metadata_json, server_version, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          folder.id,
          folder.rootId,
          folder.relativePath,
          folder.label,
          JSON.stringify(folder),
          Number(folder.serverVersion || 0),
          folder.deleted ? 1 : 0
        ]
      );
    }
  });
}

export async function listLocalEntries() {
  const db = await getDatabase();
  return db.getAllAsync<{ iso_date: string; raw: string; updated_at: string; server_version: number; deleted: number }>(
    `SELECT iso_date, raw, updated_at, server_version, deleted FROM entries ORDER BY iso_date DESC`
  );
}

export async function listSyncedMediaItems(limit = 24) {
  const db = await getDatabase();
  return db.getAllAsync<{
    id: string;
    iso_date: string;
    file_name: string;
    metadata_json: string;
    server_version: number;
    deleted: number;
    cache_path: string;
    pin_state: string;
    cache_updated_at: string;
  }>(
    `SELECT
      media.id,
      media.iso_date,
      media.file_name,
      media.metadata_json,
      media.server_version,
      media.deleted,
      COALESCE(cache.cache_path, '') AS cache_path,
      COALESCE(cache.pin_state, 'none') AS pin_state,
      COALESCE(cache.updated_at, '') AS cache_updated_at
     FROM media_items media
     LEFT JOIN media_cache cache ON cache.id = media.id
     WHERE media.deleted = 0
     ORDER BY media.iso_date DESC, media.file_name ASC
     LIMIT ?`,
    [Math.max(1, Number(limit || 24))]
  );
}

export async function upsertMediaCacheRecord(record: {
  id: string;
  cachePath: string;
  pinState?: string;
}) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO media_cache (id, cache_path, pin_state, updated_at)
     VALUES (?, ?, ?, ?)`,
    [
      record.id,
      record.cachePath,
      record.pinState || 'cached',
      new Date().toISOString()
    ]
  );
}
