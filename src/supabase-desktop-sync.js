const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function requireCloudSettings(settings) {
  const cloudApiBaseUrl = String(settings.cloudApiBaseUrl || '').replace(/\/+$/, '');
  if (!cloudApiBaseUrl) {
    throw new Error('Book of Life Cloud is not configured for this desktop build. Set BOOK_OF_LIFE_CLOUD_API_BASE_URL.');
  }
  return { cloudApiBaseUrl };
}

function authHeaders(settings, session = settings.cloudSession) {
  const accessToken = String(session?.accessToken || '');
  if (!accessToken) throw new Error('Desktop is not signed in to Book of Life Cloud.');
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };
}

async function readJsonResponse(response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || payload?.error_description || payload?.error || `Supabase request failed (${response.status})`);
  }
  return payload;
}

async function cloudFetch(url, options = {}) {
  try {
    return await fetch(url, options);
  } catch (error) {
    throw new Error(`Could not reach Book of Life Cloud: ${error.message || 'network request failed'}`);
  }
}

async function cloudApiFetch(settings, pathname, options = {}) {
  const { cloudApiBaseUrl } = requireCloudSettings(settings);
  const response = await cloudFetch(`${cloudApiBaseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.auth === false ? { 'Content-Type': 'application/json' } : authHeaders(settings)),
      ...(options.headers || {})
    }
  });
  return readJsonResponse(response);
}

function normalizeCloudSession(payload, fallbackEmail = '') {
  const session = payload?.session || {};
  return {
    accessToken: String(session.accessToken || session.access_token || ''),
    refreshToken: String(session.refreshToken || session.refresh_token || ''),
    expiresAt: Number(session.expiresAt || session.expires_at || 0),
    email: String(session.email || payload?.user?.email || fallbackEmail || '').trim()
  };
}

function apiEntryToRemote(entry) {
  return {
    library_id: entry.libraryId,
    iso_date: entry.isoDate,
    raw: entry.raw || '',
    cloud_version: Number(entry.cloudVersion || 0),
    updated_at: entry.updatedAt,
    updated_by_device_id: entry.updatedByDeviceId || null
  };
}

function changePayloadEntry(change) {
  const payload = change?.payload || {};
  return payload.entry || payload.day || null;
}

class SupabaseDesktopSync {
  constructor({ settingsStore, cloudEntryStore, indexer, imageService = null, onBeforeLocalEntryWrite = null }) {
    this.settingsStore = settingsStore;
    this.cloudEntryStore = cloudEntryStore;
    this.indexer = indexer;
    this.imageService = imageService;
    this.onBeforeLocalEntryWrite = onBeforeLocalEntryWrite;
  }

  async signIn({ email, password }) {
    const settings = await this.settingsStore.getSettings();
    const { cloudApiBaseUrl } = requireCloudSettings(settings);
    const response = await cloudFetch(`${cloudApiBaseUrl}/api/auth/signin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });
    const payload = await readJsonResponse(response);
    const cloudSession = normalizeCloudSession(payload, email);
    const nextSettings = await this.settingsStore.saveSettings({
      userId: payload.user?.id || settings.userId,
      cloudSession
    });
    return this.ensureCloudRegistration(nextSettings);
  }

  async signUp({ email, password }) {
    const settings = await this.settingsStore.getSettings();
    const { cloudApiBaseUrl } = requireCloudSettings(settings);
    const response = await cloudFetch(`${cloudApiBaseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });
    const payload = await readJsonResponse(response);
    const cloudSession = normalizeCloudSession(payload, email);
    const nextSettings = await this.settingsStore.saveSettings({
      userId: payload.user?.id || settings.userId,
      cloudSession
    });
    return this.ensureCloudRegistration(nextSettings);
  }

  async refreshSession(settings) {
    if (!settings.cloudSession?.refreshToken) return settings;
    if (settings.cloudSession.expiresAt && settings.cloudSession.expiresAt - 90 > Math.floor(Date.now() / 1000)) {
      return settings;
    }
    const { cloudApiBaseUrl } = requireCloudSettings(settings);
    const response = await cloudFetch(`${cloudApiBaseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refreshToken: settings.cloudSession.refreshToken })
    });
    const payload = await readJsonResponse(response);
    const cloudSession = normalizeCloudSession(payload, settings.cloudSession.email);
    return this.settingsStore.saveSettings({
      userId: payload.user?.id || settings.userId,
      cloudSession: {
        ...cloudSession,
        refreshToken: cloudSession.refreshToken || settings.cloudSession.refreshToken,
        email: cloudSession.email || settings.cloudSession.email || ''
      }
    });
  }

  async ensureReadySettings() {
    const current = await this.settingsStore.getSettings();
    const refreshed = await this.refreshSession(current);
    if (!refreshed.cloudSession?.accessToken) throw new Error('Sign in to Book of Life Cloud before syncing.');
    return this.ensureCloudRegistration(refreshed);
  }

  async ensureCloudRegistration(settings) {
    const nextSettings = await this.ensureLibrary(settings);
    return this.ensureDevice(nextSettings);
  }

  async ensureLibrary(settings) {
    if (isUuid(settings.libraryId)) return settings;
    const name = settings.libraryName || 'Book of Life';
    const existing = await cloudApiFetch(settings, '/api/libraries');
    if (existing.libraries?.[0]?.id) {
      return this.settingsStore.saveSettings({
        libraryId: existing.libraries[0].id,
        libraryName: existing.libraries[0].name || name
      });
    }
    const created = await cloudApiFetch(settings, '/api/libraries', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    return this.settingsStore.saveSettings({
      libraryId: created.library.id,
      libraryName: created.library.name || name
    });
  }

  async ensureDevice(settings) {
    const heartbeat = this.desktopHostHeartbeatPayload(settings);
    if (isUuid(settings.deviceId)) {
      await cloudApiFetch(settings, '/api/devices', {
        method: 'POST',
        body: JSON.stringify({
          libraryId: settings.libraryId,
          deviceId: settings.deviceId,
          deviceName: settings.deviceName || 'Book of Life Desktop',
          deviceType: 'desktop',
          canUploadMedia: true,
          canEditEntries: true,
          canRequestOriginals: true,
          canUseDesktopHost: true,
          ...heartbeat
        })
      }).catch(() => null);
      return settings;
    }
    const created = await cloudApiFetch(settings, '/api/devices', {
      method: 'POST',
      body: JSON.stringify({
        libraryId: settings.libraryId,
        deviceName: settings.deviceName || 'Book of Life Desktop',
        deviceType: 'desktop',
        canUploadMedia: true,
        canEditEntries: true,
        canRequestOriginals: true,
        canUseDesktopHost: true,
        ...heartbeat
      })
    });
    return this.settingsStore.saveSettings({ deviceId: created.device.id });
  }

  desktopHostHeartbeatPayload(settings) {
    const hostUrl = String(
      process.env.BOOK_OF_LIFE_DESKTOP_HOST_URL ||
      settings.desktopHostUrl ||
      ''
    ).replace(/\/+$/, '');
    const hostRelayToken = String(settings.hostRelayToken || '');
    const canRelay = settings.hostAvailability === 'cloud-relay' && hostUrl && hostRelayToken;
    return {
      hostUrl: canRelay ? hostUrl : '',
      hostRelayToken: canRelay ? hostRelayToken : '',
      hostRelayExpiresAt: canRelay ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null
    };
  }

  async ensureRelayToken(settings) {
    if (settings.hostRelayToken) return settings;
    return this.settingsStore.saveSettings({
      hostRelayToken: crypto.randomBytes(32).toString('hex')
    });
  }

  async listRemoteEntries(settings) {
    const payload = await cloudApiFetch(settings, `/api/entries?libraryId=${encodeURIComponent(settings.libraryId)}`);
    return (payload.entries || []).map(apiEntryToRemote);
  }

  async listRemoteChanges(settings, since = 0) {
    const payload = await cloudApiFetch(settings, `/api/sync/changes?libraryId=${encodeURIComponent(settings.libraryId)}&since=${encodeURIComponent(String(since || 0))}`);
    return {
      cursor: Number(payload.cursor || since || 0),
      changes: Array.isArray(payload.changes) ? payload.changes : []
    };
  }

  async entrySummary(settings) {
    const payload = await cloudApiFetch(settings, `/api/sync/entry-summary?libraryId=${encodeURIComponent(settings.libraryId)}`);
    return {
      cursor: Math.max(0, Number(payload.cursor || 0)),
      latestChangedAt: String(payload.latestChangedAt || ''),
      changeCount: Math.max(0, Number(payload.changeCount || 0))
    };
  }

  async saveRemoteEntry(settings, localEntry, previousRemote = null) {
    const saved = await cloudApiFetch(settings, '/api/entries', {
      method: 'POST',
      body: JSON.stringify({
        libraryId: settings.libraryId,
        isoDate: localEntry.isoDate,
        raw: localEntry.raw || '',
        deviceId: isUuid(settings.deviceId) ? settings.deviceId : null,
        baseCloudVersion: previousRemote?.cloud_version || localEntry.cloudVersion || 0
      })
    });
    return apiEntryToRemote(saved.entry);
  }

  async syncEntries({ full = false, onProgress = null } = {}) {
    const settings = await this.ensureReadySettings();
    const scope = {
      userId: settings.userId,
      libraryId: settings.libraryId,
      deviceId: settings.deviceId
    };
    const mode = full ? 'full' : 'delta';
    const localEntries = full
      ? this.cloudEntryStore.listEntries(scope)
      : this.cloudEntryStore.listDirtyEntries(scope);
    let pushed = 0;
    let pulled = 0;
    let remoteEntries = [];
    let remoteByDate = new Map();
    let nextCursor = Number(settings.entryChangeCursor || 0);
    const pushedDates = new Set();
    const pulledEntries = [];

    onProgress?.({
      phase: full ? 'full-fetch' : 'checking',
      current: 0,
      total: full ? 0 : 1,
      pushed,
      pulled,
      message: full ? 'Fetching journal entries from cloud.' : 'Checking cloud for journal changes.'
    });

    if (full) {
      remoteEntries = await this.listRemoteEntries(settings);
      remoteByDate = new Map(remoteEntries.map((entry) => [entry.iso_date, entry]));
    } else {
      const summary = await this.entrySummary(settings);
      const currentCursor = Number(settings.entryChangeCursor || 0);
      const firstBaseline = !currentCursor && !settings.entryInitialSyncCompletedAt;
      const cloudChanged = !firstBaseline && summary.cursor > currentCursor;
      nextCursor = firstBaseline ? summary.cursor : currentCursor;

      if (!cloudChanged && !localEntries.length) {
        const syncedAt = new Date().toISOString();
        await this.settingsStore.saveSettings({
          lastCloudSyncAt: syncedAt,
          entryInitialSyncCompletedAt: settings.entryInitialSyncCompletedAt || syncedAt,
          entryChangeCursor: nextCursor
        });
        onProgress?.({
          phase: 'up-to-date',
          current: 1,
          total: 1,
          pushed,
          pulled,
          message: 'Up to date.'
        });
        return {
          ok: true,
          libraryId: settings.libraryId,
          deviceId: settings.deviceId,
          mode,
          noop: true,
          pushed,
          pulled,
          remoteEntries: 0,
          cursor: nextCursor,
          syncedAt
        };
      }

      if (cloudChanged) {
        const delta = await this.listRemoteChanges(settings, currentCursor);
        nextCursor = delta.cursor;
        for (const change of delta.changes) {
          if (change.change_type !== 'entry.upsert' && change.change_type !== 'entry.delete') continue;
          const entry = changePayloadEntry(change);
          const isoDate = entry?.isoDate || change.entity_id || '';
          if (!isoDate) continue;
          remoteByDate.set(isoDate, {
            library_id: settings.libraryId,
            iso_date: isoDate,
            raw: entry?.raw || '',
            cloud_version: Number(entry?.cloudVersion || 0),
            updated_at: entry?.updatedAt || change.changed_at,
            updated_by_device_id: entry?.updatedByDeviceId || null
          });
        }
        remoteEntries = [...remoteByDate.values()];
      }
    }

    const total = Math.max(1, localEntries.length + remoteEntries.length);
    let current = 0;

    for (const localEntry of localEntries) {
      const remote = remoteByDate.get(localEntry.isoDate);
      if (!remote || new Date(localEntry.updatedAt || 0).getTime() > new Date(remote.updated_at || 0).getTime()) {
        const saved = await this.saveRemoteEntry(settings, localEntry, remote);
        remoteByDate.set(localEntry.isoDate, saved);
        await this.cloudEntryStore.markEntryClean(scope, localEntry.isoDate, {
          cloudVersion: saved.cloud_version || localEntry.cloudVersion,
          updatedAt: saved.updated_at || localEntry.updatedAt
        });
        pushed += 1;
        pushedDates.add(localEntry.isoDate);
      }
      current += 1;
      onProgress?.({
        phase: full ? 'full-push' : 'delta-push',
        current,
        total,
        pushed,
        pulled,
        message: full ? 'Uploading local journal entries.' : 'Uploading changed journal entries.'
      });
    }

    for (const remote of remoteEntries) {
      if (pushedDates.has(remote.iso_date)) {
        current += 1;
        continue;
      }
      const local = this.cloudEntryStore.getEntry(scope, remote.iso_date);
      if (!local || !local.dirty || new Date(remote.updated_at || 0).getTime() >= new Date(local.updatedAt || 0).getTime()) {
        await this.cloudEntryStore.saveEntry(scope, {
          isoDate: remote.iso_date,
          raw: remote.raw || '',
          baseCloudVersion: local?.cloudVersion || 0,
          cloudVersion: remote.cloud_version || local?.cloudVersion || 0,
          updatedAt: remote.updated_at || '',
          markClean: true
        });
        if (typeof this.onBeforeLocalEntryWrite === 'function') {
          await this.onBeforeLocalEntryWrite({ isoDate: remote.iso_date, raw: remote.raw || '' });
        }
        await this.indexer.saveEntry(remote.iso_date, remote.raw || '');
        pulledEntries.push({
          isoDate: remote.iso_date,
          raw: remote.raw || '',
          cloudVersion: remote.cloud_version || 0
        });
        pulled += 1;
      }
      current += 1;
      onProgress?.({
        phase: full ? 'full-pull' : 'delta-pull',
        current,
        total,
        pushed,
        pulled,
        message: full ? 'Writing cloud journal entries locally.' : 'Applying changed journal entries.'
      });
    }

    const syncedAt = new Date().toISOString();
    if (full || pushed) {
      nextCursor = (await this.entrySummary(settings).catch(() => ({ cursor: nextCursor }))).cursor || nextCursor;
    }
    await this.settingsStore.saveSettings({
      lastCloudSyncAt: syncedAt,
      entryInitialSyncCompletedAt: settings.entryInitialSyncCompletedAt || syncedAt,
      entryLastFullSyncAt: full ? syncedAt : settings.entryLastFullSyncAt,
      entryChangeCursor: nextCursor
    });
    return {
      ok: true,
      libraryId: settings.libraryId,
      deviceId: settings.deviceId,
      mode,
      pushed,
      pulled,
      pulledEntries,
      remoteEntries: remoteByDate.size,
      cursor: nextCursor,
      syncedAt
    };
  }

  async uploadOriginalMedia(photo) {
    const settings = await this.ensureReadySettings();
    if (!photo?.filePath) throw new Error('Media file is missing.');
    const fileName = photo.fileName || photo.baseName || 'media';
    const fileBuffer = await fs.promises.readFile(photo.filePath);
    const uploadTicket = await cloudApiFetch(settings, '/api/media/original-upload-url', {
      method: 'POST',
      body: JSON.stringify({
        libraryId: settings.libraryId,
        mediaId: photo.id,
        fileName
      })
    });
    if (!uploadTicket.signedUrl || !uploadTicket.objectPath) {
      throw new Error('Book of Life Cloud did not return a media upload URL.');
    }
    const uploadResponse = await cloudFetch(uploadTicket.signedUrl, {
      method: 'PUT',
      headers: {
        'cache-control': 'max-age=3600',
        'content-type': photo.mimeType || 'application/octet-stream',
        'x-upsert': 'true'
      },
      body: fileBuffer
    });
    await readJsonResponse(uploadResponse);

    const metadata = {
      local_media_id: photo.id,
      file_path: photo.filePath,
      relative_path: photo.relativePath || '',
      folder: photo.folder || '',
      folder_root_id: photo.folderRootId || '',
      width: photo.width || 0,
      height: photo.height || 0,
      type: photo.type || '',
      original_storage_path: uploadTicket.objectPath
    };
    const created = await cloudApiFetch(settings, '/api/media', {
      method: 'POST',
      body: JSON.stringify({
        libraryId: settings.libraryId,
        hostDeviceId: isUuid(settings.deviceId) ? settings.deviceId : null,
        isoDate: photo.isoDate || null,
        fileName,
        metadata,
        originalInCloud: true,
        originalOnHost: true,
        originalStoragePath: uploadTicket.objectPath,
        originalSize: Number(photo.size || fileBuffer.length || 0),
        originalContentType: photo.mimeType || 'application/octet-stream',
        localMediaId: photo.id,
        fileSignature: `${photo.id || ''}:${photo.mtimeMs || 0}:${photo.size || 0}`
      })
    });
    return created.media || null;
  }

  async uploadDerivative(settings, photo, variant) {
    if (!this.imageService) return null;
    const cachePath = variant === 'thumb'
      ? await this.imageService.ensureThumb(photo)
      : photo.type === 'video'
        ? await this.imageService.ensureVideoPreview(photo)
        : '';
    if (!cachePath) return null;
    const contentType = variant === 'thumb' ? 'image/webp' : 'video/webm';
    const fileName = path.basename(cachePath);
    const uploadTicket = await cloudApiFetch(settings, '/api/media/derivative-upload-url', {
      method: 'POST',
      body: JSON.stringify({
        libraryId: settings.libraryId,
        mediaId: photo.id,
        variant,
        fileName
      })
    });
    if (!uploadTicket.signedUrl || !uploadTicket.objectPath) {
      throw new Error('Book of Life Cloud did not return a derivative upload URL.');
    }
    const buffer = await fs.promises.readFile(cachePath);
    const uploadResponse = await cloudFetch(uploadTicket.signedUrl, {
      method: 'PUT',
      headers: {
        'cache-control': 'max-age=31536000',
        'content-type': contentType,
        'x-upsert': 'true'
      },
      body: buffer
    });
    await readJsonResponse(uploadResponse);
    return {
      storagePath: uploadTicket.objectPath,
      contentType
    };
  }

  async upsertMediaMetadata(photo, { uploadDerivatives = true } = {}) {
    let settings = await this.ensureReadySettings();
    settings = await this.ensureRelayToken(settings);
    await this.ensureDevice(settings);

    let thumb = null;
    let preview = null;
    if (uploadDerivatives && photo.originalAvailable !== false) {
      thumb = await this.uploadDerivative(settings, photo, 'thumb').catch((error) => {
        console.warn(`Cloud thumb upload skipped for ${photo.filePath || photo.id}: ${error.message}`);
        return null;
      });
      if (photo.type === 'video') {
        preview = await this.uploadDerivative(settings, photo, 'preview').catch((error) => {
          console.warn(`Cloud preview upload skipped for ${photo.filePath || photo.id}: ${error.message}`);
          return null;
        });
      }
    }

    const metadata = {
      local_media_id: photo.id,
      file_path: photo.filePath || '',
      relative_path: photo.relativePath || '',
      folder: photo.folder || '',
      folder_root_id: photo.folderRootId || '',
      width: photo.width || 0,
      height: photo.height || 0,
      type: photo.type || '',
      size: photo.size || 0,
      mtime_ms: photo.mtimeMs || 0,
      captured_at: photo.capturedAt || '',
      date_source: photo.dateSource || '',
      tags: Array.isArray(photo.tags) ? photo.tags : [],
      description: photo.description || '',
      liked: Boolean(photo.liked)
    };
    const payload = await cloudApiFetch(settings, '/api/media', {
      method: 'POST',
      body: JSON.stringify({
        libraryId: settings.libraryId,
        hostDeviceId: isUuid(settings.deviceId) ? settings.deviceId : null,
        isoDate: photo.isoDate || null,
        fileName: photo.fileName || photo.baseName || 'media',
        metadata,
        ...(uploadDerivatives ? {
          hasThumb: Boolean(thumb),
          hasPreview: Boolean(preview),
          thumbStoragePath: thumb?.storagePath || '',
          thumbContentType: thumb?.contentType || '',
          previewStoragePath: preview?.storagePath || '',
          previewContentType: preview?.contentType || ''
        } : {}),
        originalOnHost: photo.originalAvailable !== false,
        originalSize: Number(photo.size || 0),
        originalContentType: photo.mimeType || 'application/octet-stream',
        localMediaId: photo.id,
        fileSignature: `${photo.id || ''}:${photo.mtimeMs || 0}:${photo.size || 0}`
      })
    });
    return payload.media || null;
  }

  async syncMediaMetadata({ uploadDerivatives = true, limit = Infinity } = {}) {
    const settings = await this.ensureReadySettings();
    await this.ensureRelayToken(settings);
    let synced = 0;
    let failed = 0;
    for (const photo of this.indexer.state.photosById.values()) {
      if (synced >= limit) break;
      try {
        await this.upsertMediaMetadata(photo, { uploadDerivatives });
        synced += 1;
      } catch (error) {
        failed += 1;
        console.warn(`Cloud media metadata sync skipped for ${photo.filePath || photo.id}: ${error.message}`);
      }
    }
    return { ok: true, synced, failed };
  }

  async registerDesktopHostHeartbeat() {
    let settings = await this.ensureReadySettings();
    settings = await this.ensureRelayToken(settings);
    await this.ensureDevice(settings);
    return { ok: true, libraryId: settings.libraryId, deviceId: settings.deviceId };
  }

  async listPendingMediaActions() {
    const settings = await this.ensureReadySettings();
    const payload = await cloudApiFetch(
      settings,
      `/api/media/actions?libraryId=${encodeURIComponent(settings.libraryId)}&hostDeviceId=${encodeURIComponent(settings.deviceId)}&status=pending`
    );
    return Array.isArray(payload.actions) ? payload.actions : [];
  }

  async markMediaAction(actionId, { status, result = {} }) {
    const settings = await this.ensureReadySettings();
    return cloudApiFetch(settings, `/api/media/actions/${encodeURIComponent(actionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        libraryId: settings.libraryId,
        status,
        result
      })
    });
  }

  async deleteOriginalMedia({ cloudMediaId = '', storagePath = '' } = {}) {
    const settings = await this.ensureReadySettings();
    if (!cloudMediaId && !storagePath) return { ok: true, deleted: false };
    return cloudApiFetch(settings, `/api/media/${encodeURIComponent(cloudMediaId || storagePath)}/original`, {
      method: 'DELETE',
      body: JSON.stringify({
        libraryId: settings.libraryId,
        storagePath
      })
    });
  }

  async deleteMediaMetadata(photoId) {
    const settings = await this.ensureReadySettings();
    if (!photoId) return { ok: true, deleted: false };
    return cloudApiFetch(settings, `/api/media/${encodeURIComponent(photoId)}`, {
      method: 'DELETE',
      body: JSON.stringify({
        libraryId: settings.libraryId
      })
    });
  }

  async uploadOriginalsForPolicy({ limit = Infinity } = {}) {
    const settings = await this.ensureReadySettings();
    const folders = Array.isArray(settings.mediaFolders) ? settings.mediaFolders : [];
    const uploadRoots = folders
      .filter((folder) => folder.enabled !== false && folder.cloudPolicy === 'all-originals')
      .map((folder) => String(folder.path || ''))
      .filter(Boolean);
    if (!uploadRoots.length) return { ok: true, uploaded: 0, failed: 0, skipped: 0 };

    let uploaded = 0;
    let failed = 0;
    let skipped = 0;
    for (const photo of this.indexer.state.photosById.values()) {
      if (uploaded >= limit) break;
      const filePath = String(photo.filePath || '');
      const inSelectedRoot = uploadRoots.some((root) => filePath === root || filePath.startsWith(`${root.replace(/[\\/]+$/, '')}${require('path').sep}`));
      if (!inSelectedRoot) {
        skipped += 1;
        continue;
      }
      try {
        await this.uploadOriginalMedia(photo);
        uploaded += 1;
      } catch (error) {
        failed += 1;
        console.warn(`Cloud original upload skipped for ${filePath}: ${error.message}`);
      }
    }
    return { ok: true, uploaded, failed, skipped };
  }

  async storageUsage(settings = null) {
    const current = settings || await this.settingsStore.getSettings();
    if (!current.cloudSession?.accessToken || !current.libraryId) {
      return { available: false, usedBytes: 0 };
    }
    try {
      const payload = await cloudApiFetch(current, `/api/media/storage-usage?libraryId=${encodeURIComponent(current.libraryId)}`);
      return {
        available: true,
        usedBytes: Number(payload.storage?.usedBytes || 0),
        limitBytes: Number(payload.storage?.limitBytes || 0) || undefined,
        percent: Number(payload.storage?.percent || 0)
      };
    } catch (error) {
      if (/404|not found/i.test(String(error.message || ''))) {
        console.warn('Cloud storage usage endpoint is unavailable. Confirm the cloud web app deployment includes /api/media/storage-usage.');
        return {
          available: false,
          usedBytes: 0
        };
      }
      console.warn(`Cloud storage usage unavailable: ${error.message || 'unknown error'}`);
      return {
        available: false,
        usedBytes: 0,
        error: error.message || 'Cloud storage usage unavailable.'
      };
    }
  }

  async status() {
    const settings = await this.settingsStore.getSettings();
    return {
      configured: Boolean(settings.cloudApiBaseUrl),
      signedIn: Boolean(settings.cloudSession?.accessToken),
      email: settings.cloudSession?.email || '',
      userId: settings.userId || '',
      libraryId: settings.libraryId || '',
      deviceId: settings.deviceId || '',
      lastCloudSyncAt: settings.lastCloudSyncAt || ''
    };
  }
}

module.exports = {
  SupabaseDesktopSync
};
