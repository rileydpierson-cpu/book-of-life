import * as FileSystem from 'expo-file-system/legacy';
import { addDeviceFolder, listDeviceFolders } from '../storage/device-folders';
import { listLocalMediaAssets, upsertLocalMediaAsset } from '../storage/local-media-index';

const { StorageAccessFramework } = FileSystem;

const MEDIA_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif', '.heic', '.heif',
  '.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.3gp'
]);

function hashString(value: string) {
  let hash = 2166136261;
  const input = String(value || '');
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function normalizeFolderId(uri: string) {
  return `folder-${hashString(uri)}`;
}

function inferDisplayName(uri: string) {
  const cleaned = String(uri || '').replace(/\/+$/, '');
  const slashIndex = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf(':'));
  return slashIndex >= 0 ? cleaned.slice(slashIndex + 1) || 'Device Folder' : 'Device Folder';
}

function inferMediaType(uri: string) {
  const lower = String(uri || '').toLowerCase();
  const ext = [...MEDIA_EXTENSIONS].find((item) => lower.endsWith(item));
  if (!ext) return '';
  return ['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.3gp'].includes(ext) ? 'video' : 'photo';
}

function inferFileName(uri: string) {
  const cleaned = String(uri || '').replace(/\/+$/, '');
  const index = cleaned.lastIndexOf('/');
  return index >= 0 ? cleaned.slice(index + 1) : cleaned;
}

export async function registerDeviceFolder() {
  const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted || !permission.directoryUri) {
    return null;
  }
  const folderId = normalizeFolderId(permission.directoryUri);
  const displayName = inferDisplayName(permission.directoryUri);
  await addDeviceFolder({
    id: folderId,
    folderUri: permission.directoryUri,
    displayName,
    syncEnabled: true,
    localIndex: {
      assetCount: 0,
      lastScanAt: '',
      syncState: 'idle'
    }
  });
  return {
    id: folderId,
    folderUri: permission.directoryUri,
    displayName
  };
}

export async function scanDeviceFolder(folderId: string) {
  const folders = await listDeviceFolders();
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) throw new Error('Device folder not found.');
  const foundAssets = await scanDirectoryRecursive(folder.folder_uri);
  for (const asset of foundAssets) {
    await upsertLocalMediaAsset({
      id: asset.id,
      deviceFolderId: folderId,
      assetUri: asset.assetUri,
      fileName: asset.fileName,
      metadata: asset.metadata,
      syncState: 'local-only',
      preserveSyncState: true
    });
  }
  await addDeviceFolder({
    id: folder.id,
    folderUri: folder.folder_uri,
    displayName: folder.display_name,
    syncEnabled: Boolean(folder.sync_enabled),
    localIndex: {
      assetCount: foundAssets.length,
      lastScanAt: new Date().toISOString(),
      syncState: 'indexed'
    }
  });
  return {
    folderId,
    scannedAssets: foundAssets.length
  };
}

async function scanDirectoryRecursive(directoryUri: string, acc: Array<{
  id: string;
  assetUri: string;
  fileName: string;
  metadata: Record<string, unknown>;
}> = []) {
  const childUris = await StorageAccessFramework.readDirectoryAsync(directoryUri);
  for (const childUri of childUris) {
    const info = await FileSystem.getInfoAsync(childUri);
    if (!info.exists) continue;
    if (info.isDirectory) {
      await scanDirectoryRecursive(childUri, acc);
      continue;
    }
    const type = inferMediaType(childUri);
    if (!type) continue;
    acc.push({
      id: `asset-${hashString(childUri)}`,
      assetUri: childUri,
      fileName: inferFileName(childUri),
      metadata: {
        uri: childUri,
        size: typeof info.size === 'number' ? info.size : 0,
        modifiedAt: typeof info.modificationTime === 'number' ? new Date(info.modificationTime * 1000).toISOString() : '',
        type
      }
    });
  }
  return acc;
}

export async function getDeviceFolderSummary() {
  const folders = await listDeviceFolders();
  const assets = await listLocalMediaAssets();
  return {
    folders: folders.map((folder) => ({
      id: folder.id,
      displayName: folder.display_name,
      folderUri: folder.folder_uri,
      syncEnabled: Boolean(folder.sync_enabled),
      localIndex: JSON.parse(folder.local_index_json || '{}')
    })),
    assetCount: assets.length
  };
}
