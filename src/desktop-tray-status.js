const CLOUD_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;

function normalizeCloudStorageUsage(usage = {}) {
  const usedBytes = Math.max(0, Number(usage.usedBytes || 0));
  const limitBytes = Math.max(1, Number(usage.limitBytes || CLOUD_STORAGE_LIMIT_BYTES));
  return {
    available: usage.available !== false,
    usedBytes,
    limitBytes,
    percent: Math.max(0, Math.min(100, Math.round((usedBytes / limitBytes) * 100))),
    error: String(usage.error || '')
  };
}

function normalizeSyncStatus(syncStatus = {}) {
  return {
    running: Boolean(syncStatus.running),
    queued: Boolean(syncStatus.queued),
    reason: String(syncStatus.reason || ''),
    startedAt: syncStatus.startedAt || '',
    completedAt: syncStatus.completedAt || '',
    lastSyncedAt: syncStatus.lastSyncedAt || syncStatus.syncedAt || '',
    pushed: Math.max(0, Number(syncStatus.pushed || 0)),
    pulled: Math.max(0, Number(syncStatus.pulled || 0)),
    phase: String(syncStatus.phase || ''),
    current: Math.max(0, Number(syncStatus.current || 0)),
    total: Math.max(0, Number(syncStatus.total || 0)),
    percent: Math.max(0, Math.min(100, Number(syncStatus.percent || 0))),
    message: String(syncStatus.message || ''),
    error: String(syncStatus.error || '')
  };
}

function desktopTrayStatus({
  localService = {},
  cloudStatus = {},
  indexStatus = {},
  storageUsage = {},
  syncStatus = {}
} = {}) {
  const signedIn = Boolean(cloudStatus.signedIn);
  return {
    ok: true,
    localService: {
      running: localService.running !== false,
      port: Number(localService.port || 0),
      url: String(localService.url || '')
    },
    cloud: {
      configured: Boolean(cloudStatus.configured),
      signedIn,
      email: cloudStatus.email || '',
      userId: cloudStatus.userId || '',
      libraryId: cloudStatus.libraryId || '',
      deviceId: cloudStatus.deviceId || '',
      lastCloudSyncAt: cloudStatus.lastCloudSyncAt || '',
      error: cloudStatus.error || ''
    },
    index: indexStatus || {},
    sync: normalizeSyncStatus({
      ...syncStatus,
      lastSyncedAt: syncStatus.lastSyncedAt || cloudStatus.lastCloudSyncAt || ''
    }),
    storage: normalizeCloudStorageUsage(signedIn
      ? storageUsage
      : { available: false, usedBytes: 0, limitBytes: CLOUD_STORAGE_LIMIT_BYTES })
  };
}

module.exports = {
  CLOUD_STORAGE_LIMIT_BYTES,
  desktopTrayStatus,
  normalizeSyncStatus,
  normalizeCloudStorageUsage
};
