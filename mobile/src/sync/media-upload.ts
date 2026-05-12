import { loadConnection } from '../auth/connection-store';
import { listUploadableLocalMediaAssets, updateLocalMediaAssetSyncState } from '../storage/local-media-index';
import { mobileUploadJson } from '../api/client';
import type { SyncConnection } from './types';

function sanitizeSegment(value: string, fallbackValue: string) {
  const normalized = String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || fallbackValue;
}

function buildRelativePath(connection: SyncConnection, folderDisplayName: string) {
  const base = String(connection.syncRoot?.baseRelativePath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const folderName = sanitizeSegment(folderDisplayName, 'Device Uploads');
  return [base, folderName].filter(Boolean).join('/');
}

export async function uploadPendingLocalMedia(connection?: SyncConnection) {
  const activeConnection = connection || await loadConnection();
  if (!activeConnection) throw new Error('No saved sync connection.');
  if (!activeConnection.syncRoot?.rootId) throw new Error('This connection does not include a device sync root.');

  const assets = await listUploadableLocalMediaAssets();
  if (!assets.length) {
    return { uploaded: 0, failed: 0, skipped: 0 };
  }

  let uploaded = 0;
  let failed = 0;
  for (const asset of assets) {
    await updateLocalMediaAssetSyncState(asset.id, 'upload-pending');
    try {
      const payload = await mobileUploadJson<{
        ok: boolean;
        photo?: { id?: string };
      }>(activeConnection, '/api/sync/media/upload', {
        assetUri: asset.asset_uri,
        fileName: asset.file_name,
        rootId: activeConnection.syncRoot.rootId,
        relativePath: buildRelativePath(activeConnection, asset.folder_display_name),
        localAssetId: asset.id
      });
      await updateLocalMediaAssetSyncState(asset.id, 'synced', {
        remoteMediaId: String(payload.photo?.id || '')
      });
      uploaded += 1;
    } catch (error) {
      failed += 1;
      await updateLocalMediaAssetSyncState(asset.id, 'upload-failed');
    }
  }

  return {
    uploaded,
    failed,
    skipped: 0
  };
}
