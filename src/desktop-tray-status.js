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

function normalizeMediaAvailability(mediaAvailability = {}) {
  const roots = Array.isArray(mediaAvailability.roots) ? mediaAvailability.roots : [];
  const normalizedRoots = roots.map((root) => ({
    path: String(root.path || ''),
    rootLabel: String(root.rootLabel || root.path || ''),
    available: root.available !== false,
    error: String(root.error || ''),
    mediaCount: Math.max(0, Number(root.mediaCount || 0)),
    warningCount: Math.max(0, Number(root.warningCount || 0))
  }));
  return {
    roots: normalizedRoots,
    missingCloudCount: Math.max(0, Number(mediaAvailability.missingCloudCount || 0)),
    rootUnavailableCount: Math.max(0, Number(mediaAvailability.rootUnavailableCount || 0)),
    cloudOnlyCount: Math.max(0, Number(mediaAvailability.cloudOnlyCount || 0)),
    missingUnapprovedCount: Math.max(0, Number(mediaAvailability.missingUnapprovedCount || 0)),
    missingCloudRiskCount: Math.max(0, Number(mediaAvailability.missingCloudRiskCount || 0)),
    warningCount: Math.max(0, Number(mediaAvailability.warningCount || 0))
  };
}

function normalizeJournalMirrorStatus(journalMirror = {}) {
  return {
    configured: Boolean(journalMirror.configured),
    status: String(journalMirror.status || (journalMirror.configured ? 'unavailable' : 'idle')),
    localDir: String(journalMirror.localDir || ''),
    mirrorDir: String(journalMirror.mirrorDir || ''),
    available: Boolean(journalMirror.available),
    syncing: Boolean(journalMirror.syncing),
    conflictCount: Math.max(0, Number(journalMirror.conflictCount || 0)),
    lastSyncedAt: String(journalMirror.lastSyncedAt || ''),
    error: String(journalMirror.error || '')
  };
}

function desktopTrayStatus({
  localService = {},
  cloudStatus = {},
  indexStatus = {},
  mediaAvailability = {},
  journalMirror = {},
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
    mediaAvailability: normalizeMediaAvailability(mediaAvailability),
    journalMirror: normalizeJournalMirrorStatus(journalMirror),
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
  normalizeCloudStorageUsage,
  normalizeMediaAvailability,
  normalizeJournalMirrorStatus
};
