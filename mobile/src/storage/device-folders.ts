import { getDatabase } from './database';

export async function addDeviceFolder(folder: {
  id: string;
  folderUri: string;
  displayName: string;
  syncEnabled?: boolean;
  localIndex?: Record<string, unknown>;
}) {
  const db = await getDatabase();
  const timestamp = new Date().toISOString();
  await db.runAsync(
    `INSERT OR REPLACE INTO device_folders (id, folder_uri, display_name, sync_enabled, local_index_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM device_folders WHERE id = ?), ?), ?)`,
    [
      folder.id,
      folder.folderUri,
      folder.displayName,
      folder.syncEnabled === false ? 0 : 1,
      JSON.stringify(folder.localIndex || {}),
      folder.id,
      timestamp,
      timestamp
    ]
  );
}

export async function listDeviceFolders() {
  const db = await getDatabase();
  return db.getAllAsync<{
    id: string;
    folder_uri: string;
    display_name: string;
    sync_enabled: number;
    local_index_json: string;
    updated_at: string;
  }>(`SELECT id, folder_uri, display_name, sync_enabled, local_index_json, updated_at FROM device_folders ORDER BY display_name ASC`);
}
