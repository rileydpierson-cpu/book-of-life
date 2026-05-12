import { getDatabase } from './database';

export async function upsertLocalMediaAsset(asset: {
  id: string;
  deviceFolderId: string;
  assetUri: string;
  fileName: string;
  metadata: Record<string, unknown>;
  syncState?: string;
  remoteMediaId?: string;
  preserveSyncState?: boolean;
}) {
  const db = await getDatabase();
  const timestamp = new Date().toISOString();
  if (asset.preserveSyncState) {
    await db.runAsync(
      `INSERT OR REPLACE INTO local_media_assets (id, device_folder_id, asset_uri, file_name, metadata_json, sync_state, remote_media_id, updated_at)
       VALUES (
         ?, ?, ?, ?, ?,
         COALESCE((SELECT sync_state FROM local_media_assets WHERE id = ?), ?),
         COALESCE((SELECT remote_media_id FROM local_media_assets WHERE id = ?), ?),
         ?
       )`,
      [
        asset.id,
        asset.deviceFolderId,
        asset.assetUri,
        asset.fileName,
        JSON.stringify(asset.metadata || {}),
        asset.id,
        asset.syncState || 'local-only',
        asset.id,
        asset.remoteMediaId || '',
        timestamp
      ]
    );
    return;
  }
  await db.runAsync(
    `INSERT OR REPLACE INTO local_media_assets (id, device_folder_id, asset_uri, file_name, metadata_json, sync_state, remote_media_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      asset.id,
      asset.deviceFolderId,
      asset.assetUri,
      asset.fileName,
      JSON.stringify(asset.metadata || {}),
      asset.syncState || 'local-only',
      asset.remoteMediaId || '',
      timestamp
    ]
  );
}

export async function listLocalMediaAssets(deviceFolderId?: string) {
  const db = await getDatabase();
  if (deviceFolderId) {
    return db.getAllAsync<{
      id: string;
      device_folder_id: string;
      asset_uri: string;
      file_name: string;
      metadata_json: string;
      sync_state: string;
      remote_media_id: string;
      updated_at: string;
    }>(`SELECT id, device_folder_id, asset_uri, file_name, metadata_json, sync_state, remote_media_id, updated_at FROM local_media_assets WHERE device_folder_id = ? ORDER BY updated_at DESC`, [deviceFolderId]);
  }
  return db.getAllAsync<{
    id: string;
    device_folder_id: string;
    asset_uri: string;
    file_name: string;
    metadata_json: string;
    sync_state: string;
    remote_media_id: string;
    updated_at: string;
  }>(`SELECT id, device_folder_id, asset_uri, file_name, metadata_json, sync_state, remote_media_id, updated_at FROM local_media_assets ORDER BY updated_at DESC`);
}

export async function listUploadableLocalMediaAssets() {
  const db = await getDatabase();
  return db.getAllAsync<{
    id: string;
    device_folder_id: string;
    asset_uri: string;
    file_name: string;
    metadata_json: string;
    sync_state: string;
    remote_media_id: string;
    folder_display_name: string;
    folder_uri: string;
  }>(
    `SELECT
      asset.id,
      asset.device_folder_id,
      asset.asset_uri,
      asset.file_name,
      asset.metadata_json,
      asset.sync_state,
      asset.remote_media_id,
      folder.display_name AS folder_display_name,
      folder.folder_uri AS folder_uri
     FROM local_media_assets asset
     JOIN device_folders folder ON folder.id = asset.device_folder_id
     WHERE folder.sync_enabled = 1
       AND asset.sync_state IN ('local-only', 'upload-failed', 'upload-pending')
     ORDER BY asset.updated_at ASC`
  );
}

export async function updateLocalMediaAssetSyncState(
  id: string,
  syncState: string,
  options: { remoteMediaId?: string } = {}
) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE local_media_assets
     SET sync_state = ?, remote_media_id = COALESCE(?, remote_media_id), updated_at = ?
     WHERE id = ?`,
    [
      syncState,
      options.remoteMediaId || null,
      new Date().toISOString(),
      id
    ]
  );
}
