const MUTATION_TYPES = Object.freeze({
  ENTRY_SAVE: 'entry.save',
  ENTRY_DELETE: 'entry.delete',
  ENTRY_CLOUD_PULL: 'entry.cloud.pull',
  FOLDER_CREATE: 'folder.create',
  MEDIA_TAGS_SET: 'media.tags.set',
  MEDIA_DESCRIPTION_SET: 'media.description.set',
  MEDIA_LIKE_SET: 'media.like.set',
  MEDIA_DATE_TIME_SET: 'media.date-time.set',
  MEDIA_RENAME: 'media.rename',
  MEDIA_MOVE: 'media.move',
  MEDIA_DELETE: 'media.delete'
});

const CHANGE_TYPES = Object.freeze({
  SNAPSHOT: 'snapshot',
  ENTRY_UPSERT: 'entry.upsert',
  ENTRY_DELETE: 'entry.delete',
  ENTRY_REVISION: 'entry.revision',
  DEVICE_UPSERT: 'device.upsert',
  SYNC_SETTINGS_UPSERT: 'sync-settings.upsert',
  MEDIA_UPSERT: 'media.upsert',
  MEDIA_DELETE: 'media.delete',
  FOLDER_UPSERT: 'folder.upsert'
});

const MEDIA_CLOUD_POLICIES = Object.freeze({
  METADATA_ONLY: 'metadata-only',
  DERIVATIVES: 'derivatives',
  SELECTED_ORIGINALS: 'selected-originals',
  ALL_ORIGINALS: 'all-originals'
});

const HOST_AVAILABILITY_MODES = Object.freeze({
  LOCAL_ONLY: 'local-only',
  LAN: 'lan',
  CLOUD_RELAY: 'cloud-relay'
});

const DESKTOP_STORAGE_MODES = Object.freeze({
  DEVICE_ONLY: 'device-only',
  CLOUD_ORIGINALS: 'cloud-originals'
});

const ENTRY_IMPORT_MODES = Object.freeze({
  NONE: 'none',
  COPY: 'copy',
  MIRROR: 'mirror'
});

const DEVICE_PERMISSION_KEYS = Object.freeze([
  'canUploadMedia',
  'canEditEntries',
  'canRequestOriginals',
  'canUseDesktopHost'
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function isValidTime(value) {
  return /^\d{2}:\d{2}$/.test(String(value || ''));
}

function normalizeScope(value) {
  if (!isObject(value)) return {};
  return {
    userId: String(value.userId || '').trim(),
    libraryId: String(value.libraryId || '').trim(),
    deviceId: String(value.deviceId || '').trim()
  };
}

function hasValidOptionalScope(value) {
  if (!value || !isObject(value)) return true;
  const scope = normalizeScope(value);
  return (!('userId' in value) || Boolean(scope.userId)) &&
    (!('libraryId' in value) || Boolean(scope.libraryId)) &&
    (!('deviceId' in value) || Boolean(scope.deviceId));
}

function normalizeDevicePermissions(value = {}) {
  const permissions = {};
  for (const key of DEVICE_PERMISSION_KEYS) {
    permissions[key] = Boolean(value?.[key]);
  }
  return permissions;
}

function normalizeMediaFolderSetting(value) {
  if (!isObject(value)) return null;
  const id = String(value.id || '').trim();
  const path = String(value.path || '').trim();
  const cloudPolicy = Object.values(MEDIA_CLOUD_POLICIES).includes(value.cloudPolicy)
    ? value.cloudPolicy
    : MEDIA_CLOUD_POLICIES.DERIVATIVES;
  if (!id || !path) return null;
  return {
    id,
    path,
    label: String(value.label || '').trim() || path,
    enabled: value.enabled !== false,
    cloudPolicy
  };
}

function normalizeDesktopSyncSettings(value = {}) {
  const settings = isObject(value) ? value : {};
  const scope = normalizeScope(settings);
  const hostAvailability = Object.values(HOST_AVAILABILITY_MODES).includes(settings.hostAvailability)
    ? settings.hostAvailability
    : HOST_AVAILABILITY_MODES.LOCAL_ONLY;
  const storageMode = Object.values(DESKTOP_STORAGE_MODES).includes(settings.storageMode)
    ? settings.storageMode
    : DESKTOP_STORAGE_MODES.DEVICE_ONLY;
  const entryImportMode = Object.values(ENTRY_IMPORT_MODES).includes(settings.entryImportMode)
    ? settings.entryImportMode
    : ENTRY_IMPORT_MODES.NONE;
  const mediaFolders = Array.isArray(settings.mediaFolders)
    ? settings.mediaFolders.map(normalizeMediaFolderSetting).filter(Boolean)
    : [];
  return {
    ...scope,
    libraryName: String(settings.libraryName || '').trim(),
    deviceName: String(settings.deviceName || '').trim(),
    cloudApiBaseUrl: String(settings.cloudApiBaseUrl || '').trim(),
    supabaseUrl: String(settings.supabaseUrl || '').trim(),
    supabasePublishableKey: String(settings.supabasePublishableKey || '').trim(),
    cloudSession: isObject(settings.cloudSession) ? {
      accessToken: String(settings.cloudSession.accessToken || '').trim(),
      refreshToken: String(settings.cloudSession.refreshToken || '').trim(),
      expiresAt: Number(settings.cloudSession.expiresAt || 0),
      email: String(settings.cloudSession.email || '').trim()
    } : null,
    localJournalMirrorPath: String(settings.localJournalMirrorPath || '').trim(),
    markdownDateFormat: String(settings.markdownDateFormat || 'MMMM D, YYYY').trim() || 'MMMM D, YYYY',
    externalEditConflictBehavior: String(settings.externalEditConflictBehavior || 'cloud-version-with-revision').trim(),
    deviceUploadDestinationPath: String(settings.deviceUploadDestinationPath || '').trim(),
    mediaFolders,
    hostAvailability,
    storageMode,
    entryImportMode,
    onboardingCompletedAt: String(settings.onboardingCompletedAt || '').trim(),
    importedEntriesAt: String(settings.importedEntriesAt || '').trim(),
    lastCloudSyncAt: String(settings.lastCloudSyncAt || '').trim(),
    entryInitialSyncCompletedAt: String(settings.entryInitialSyncCompletedAt || '').trim(),
    entryLastFullSyncAt: String(settings.entryLastFullSyncAt || '').trim(),
    entryChangeCursor: Math.max(0, Number(settings.entryChangeCursor || 0)),
    thumbnail: {
      uploadDerivatives: settings.thumbnail?.uploadDerivatives !== false,
      imageMaxEdge: Number(settings.thumbnail?.imageMaxEdge || 1600),
      previewMaxEdge: Number(settings.thumbnail?.previewMaxEdge || 2560)
    },
    devicePermissions: isObject(settings.devicePermissions)
      ? Object.fromEntries(Object.entries(settings.devicePermissions).map(([deviceId, permissions]) => [
          deviceId,
          normalizeDevicePermissions(permissions)
        ]))
      : {}
  };
}

function normalizeMutationEnvelope(value) {
  if (!isObject(value)) return null;
  const id = String(value.id || '').trim();
  const type = String(value.type || '').trim();
  const clientTimestamp = String(value.clientTimestamp || '').trim();
  const payload = isObject(value.payload) ? value.payload : {};
  const scope = normalizeScope(value);
  if (!id || !type) return null;
  return {
    id,
    type,
    ...scope,
    entityId: String(value.entityId || '').trim(),
    baseSequence: Number.isFinite(Number(value.baseSequence)) ? Number(value.baseSequence) : 0,
    baseCloudVersion: Number.isFinite(Number(value.baseCloudVersion)) ? Number(value.baseCloudVersion) : 0,
    clientTimestamp,
    payload
  };
}

function validateMutationEnvelope(envelope) {
  const normalized = normalizeMutationEnvelope(envelope);
  if (!normalized) return { ok: false, error: 'Invalid mutation envelope.' };
  const { type, payload } = normalized;
  if (!hasValidOptionalScope(envelope)) return { ok: false, error: 'Invalid mutation scope.' };
  switch (type) {
    case MUTATION_TYPES.ENTRY_SAVE:
      if (!isValidIsoDate(payload.isoDate) || typeof payload.raw !== 'string') return { ok: false, error: 'Invalid entry.save payload.' };
      if (payload.scope && !hasValidOptionalScope(payload.scope)) return { ok: false, error: 'Invalid entry.save scope.' };
      return { ok: true, mutation: normalized };
    case MUTATION_TYPES.ENTRY_DELETE:
      if (!isValidIsoDate(payload.isoDate)) return { ok: false, error: 'Invalid entry.delete payload.' };
      return { ok: true, mutation: normalized };
    case MUTATION_TYPES.FOLDER_CREATE:
      if (typeof payload.rootId !== 'string' || typeof payload.relativePath !== 'string' || typeof payload.folderName !== 'string') return { ok: false, error: 'Invalid folder.create payload.' };
      return { ok: true, mutation: normalized };
    case MUTATION_TYPES.MEDIA_TAGS_SET:
      if (typeof payload.photoId !== 'string' || !Array.isArray(payload.tags)) return { ok: false, error: 'Invalid media.tags.set payload.' };
      return { ok: true, mutation: normalized };
    case MUTATION_TYPES.MEDIA_DESCRIPTION_SET:
      if (typeof payload.photoId !== 'string' || typeof payload.description !== 'string') return { ok: false, error: 'Invalid media.description.set payload.' };
      return { ok: true, mutation: normalized };
    case MUTATION_TYPES.MEDIA_LIKE_SET:
      if (typeof payload.photoId !== 'string' || typeof payload.liked !== 'boolean') return { ok: false, error: 'Invalid media.like.set payload.' };
      return { ok: true, mutation: normalized };
    case MUTATION_TYPES.MEDIA_DATE_TIME_SET:
      if (typeof payload.photoId !== 'string') return { ok: false, error: 'Invalid media.date-time.set payload.' };
      if (payload.isoDate && !isValidIsoDate(payload.isoDate)) return { ok: false, error: 'Invalid media.date-time.set date.' };
      if (payload.time && !isValidTime(payload.time)) return { ok: false, error: 'Invalid media.date-time.set time.' };
      return { ok: true, mutation: normalized };
    case MUTATION_TYPES.MEDIA_RENAME:
      if (typeof payload.photoId !== 'string' || typeof payload.baseName !== 'string') return { ok: false, error: 'Invalid media.rename payload.' };
      return { ok: true, mutation: normalized };
    case MUTATION_TYPES.MEDIA_MOVE:
      if (typeof payload.photoId !== 'string' || typeof payload.rootId !== 'string' || typeof payload.relativePath !== 'string') return { ok: false, error: 'Invalid media.move payload.' };
      return { ok: true, mutation: normalized };
    case MUTATION_TYPES.MEDIA_DELETE:
      if (typeof payload.photoId !== 'string') return { ok: false, error: 'Invalid media.delete payload.' };
      return { ok: true, mutation: normalized };
    default:
      return { ok: false, error: `Unsupported mutation type: ${type}` };
  }
}

module.exports = {
  MUTATION_TYPES,
  CHANGE_TYPES,
  MEDIA_CLOUD_POLICIES,
  HOST_AVAILABILITY_MODES,
  DESKTOP_STORAGE_MODES,
  ENTRY_IMPORT_MODES,
  DEVICE_PERMISSION_KEYS,
  normalizeMutationEnvelope,
  normalizeDesktopSyncSettings,
  normalizeDevicePermissions,
  normalizeMediaFolderSetting,
  validateMutationEnvelope,
  isValidIsoDate,
  isValidTime
};
