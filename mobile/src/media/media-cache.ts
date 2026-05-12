import * as FileSystem from 'expo-file-system/legacy';
import { loadConnection } from '../auth/connection-store';
import { upsertMediaCacheRecord } from '../storage/database';
import type { SyncConnection } from '../sync/types';

const CACHE_DIR = `${FileSystem.cacheDirectory || ''}lifeserver-media/`;

function extensionForVariant(variant: 'thumb' | 'preview' | 'full', fileName: string) {
  if (variant === 'thumb') return '.jpg';
  if (variant === 'preview') return '.webm';
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
  return ext || '.bin';
}

async function ensureCacheDirectory() {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

function buildDownloadUrl(connection: SyncConnection, photoId: string, variant: 'thumb' | 'preview' | 'full') {
  return new URL(`/api/sync/media/${variant}/${photoId}`, connection.serverUrl).toString();
}

export async function cacheRemoteMediaVariant(input: {
  photoId: string;
  fileName: string;
  variant: 'thumb' | 'preview' | 'full';
  connection?: SyncConnection;
}) {
  const activeConnection = input.connection || await loadConnection();
  if (!activeConnection) throw new Error('No saved sync connection.');
  await ensureCacheDirectory();
  const destination = `${CACHE_DIR}${input.photoId}-${input.variant}${extensionForVariant(input.variant, input.fileName)}`;
  const result = await FileSystem.downloadAsync(
    buildDownloadUrl(activeConnection, input.photoId, input.variant),
    destination,
    {
      headers: activeConnection.authToken ? { Authorization: `Bearer ${activeConnection.authToken}` } : {}
    }
  );
  await upsertMediaCacheRecord({
    id: input.photoId,
    cachePath: result.uri,
    pinState: input.variant === 'full' ? 'full' : 'thumb'
  });
  return result.uri;
}
