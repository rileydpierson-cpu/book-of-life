function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function requireCloudSettings(settings) {
  const supabaseUrl = String(settings.supabaseUrl || '').replace(/\/+$/, '');
  const supabasePublishableKey = String(settings.supabasePublishableKey || '');
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error('Book of Life Cloud is not configured for this desktop build.');
  }
  return { supabaseUrl, supabasePublishableKey };
}

function authHeaders(settings, session = settings.cloudSession) {
  const { supabasePublishableKey } = requireCloudSettings(settings);
  const accessToken = String(session?.accessToken || '');
  if (!accessToken) throw new Error('Desktop is not signed in to Supabase.');
  return {
    apikey: supabasePublishableKey,
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

async function supabaseFetch(settings, pathname, options = {}) {
  const { supabaseUrl } = requireCloudSettings(settings);
  const response = await cloudFetch(`${supabaseUrl}${pathname}`, {
    ...options,
    headers: {
      ...authHeaders(settings),
      Prefer: 'return=representation',
      ...(options.headers || {})
    }
  });
  return readJsonResponse(response);
}

class SupabaseDesktopSync {
  constructor({ settingsStore, cloudEntryStore, indexer }) {
    this.settingsStore = settingsStore;
    this.cloudEntryStore = cloudEntryStore;
    this.indexer = indexer;
  }

  async signIn({ email, password }) {
    const settings = await this.settingsStore.getSettings();
    const { supabaseUrl, supabasePublishableKey } = requireCloudSettings(settings);
    const response = await cloudFetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: supabasePublishableKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });
    const payload = await readJsonResponse(response);
    const expiresAt = Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600);
    const nextSettings = await this.settingsStore.saveSettings({
      userId: payload.user?.id || settings.userId,
      cloudSession: {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
        expiresAt,
        email
      }
    });
    return this.ensureCloudRegistration(nextSettings);
  }

  async signUp({ email, password }) {
    const settings = await this.settingsStore.getSettings();
    const { supabaseUrl, supabasePublishableKey } = requireCloudSettings(settings);
    const response = await cloudFetch(`${supabaseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        apikey: supabasePublishableKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });
    await readJsonResponse(response);
    return this.signIn({ email, password });
  }

  async refreshSession(settings) {
    if (!settings.cloudSession?.refreshToken) return settings;
    if (settings.cloudSession.expiresAt && settings.cloudSession.expiresAt - 90 > Math.floor(Date.now() / 1000)) {
      return settings;
    }
    const { supabaseUrl, supabasePublishableKey } = requireCloudSettings(settings);
    const response = await cloudFetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: supabasePublishableKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refresh_token: settings.cloudSession.refreshToken })
    });
    const payload = await readJsonResponse(response);
    const expiresAt = Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600);
    return this.settingsStore.saveSettings({
      userId: payload.user?.id || settings.userId,
      cloudSession: {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token || settings.cloudSession.refreshToken,
        expiresAt,
        email: settings.cloudSession.email || payload.user?.email || ''
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
    const existing = await supabaseFetch(settings, `/rest/v1/libraries?select=*&owner_user_id=eq.${encodeURIComponent(settings.userId)}&limit=1`);
    if (existing[0]?.id) {
      return this.settingsStore.saveSettings({
        libraryId: existing[0].id,
        libraryName: existing[0].name || name
      });
    }
    const created = await supabaseFetch(settings, '/rest/v1/libraries', {
      method: 'POST',
      body: JSON.stringify({
        owner_user_id: settings.userId,
        name
      })
    });
    return this.settingsStore.saveSettings({
      libraryId: created[0].id,
      libraryName: created[0].name || name
    });
  }

  async ensureDevice(settings) {
    if (isUuid(settings.deviceId)) {
      await supabaseFetch(settings, `/rest/v1/devices?id=eq.${encodeURIComponent(settings.deviceId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          device_name: settings.deviceName || 'Book of Life Desktop',
          can_upload_media: true,
          can_edit_entries: true,
          can_request_originals: true,
          can_use_desktop_host: true,
          last_seen_at: new Date().toISOString()
        })
      }).catch(() => null);
      return settings;
    }
    const created = await supabaseFetch(settings, '/rest/v1/devices', {
      method: 'POST',
      body: JSON.stringify({
        library_id: settings.libraryId,
        owner_user_id: settings.userId,
        device_name: settings.deviceName || 'Book of Life Desktop',
        device_type: 'desktop',
        can_upload_media: true,
        can_edit_entries: true,
        can_request_originals: true,
        can_use_desktop_host: true,
        last_seen_at: new Date().toISOString()
      })
    });
    return this.settingsStore.saveSettings({ deviceId: created[0].id });
  }

  async listRemoteEntries(settings) {
    return supabaseFetch(settings, `/rest/v1/entries?select=*&library_id=eq.${encodeURIComponent(settings.libraryId)}&order=iso_date.desc`);
  }

  async saveRemoteEntry(settings, localEntry, previousRemote = null) {
    const nextVersion = Number(previousRemote?.cloud_version || 0) + 1;
    if (previousRemote) {
      await supabaseFetch(settings, '/rest/v1/entry_revisions', {
        method: 'POST',
        body: JSON.stringify({
          library_id: settings.libraryId,
          iso_date: localEntry.isoDate,
          raw: previousRemote.raw || '',
          cloud_version: previousRemote.cloud_version || 0,
          updated_by_device_id: previousRemote.updated_by_device_id || null,
          updated_at: previousRemote.updated_at || new Date().toISOString(),
          conflict: false
        })
      });
    }
    const saved = await supabaseFetch(settings, '/rest/v1/entries?on_conflict=library_id,iso_date', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        library_id: settings.libraryId,
        iso_date: localEntry.isoDate,
        raw: localEntry.raw || '',
        cloud_version: nextVersion,
        updated_by_device_id: isUuid(settings.deviceId) ? settings.deviceId : null,
        updated_at: new Date().toISOString()
      })
    });
    await supabaseFetch(settings, '/rest/v1/sync_changes', {
      method: 'POST',
      body: JSON.stringify({
        library_id: settings.libraryId,
        change_type: String(localEntry.raw || '').trim() ? 'entry.upsert' : 'entry.delete',
        entity_id: localEntry.isoDate,
        payload: { entry: saved[0] }
      })
    }).catch(() => null);
    return saved[0];
  }

  async syncEntries() {
    const settings = await this.ensureReadySettings();
    const scope = {
      userId: settings.userId,
      libraryId: settings.libraryId,
      deviceId: settings.deviceId
    };
    const remoteEntries = await this.listRemoteEntries(settings);
    const remoteByDate = new Map(remoteEntries.map((entry) => [entry.iso_date, entry]));
    const localEntries = this.cloudEntryStore.listEntries(scope);
    let pushed = 0;
    let pulled = 0;

    for (const localEntry of localEntries) {
      const remote = remoteByDate.get(localEntry.isoDate);
      if (!remote || new Date(localEntry.updatedAt || 0).getTime() > new Date(remote.updated_at || 0).getTime()) {
        const saved = await this.saveRemoteEntry(settings, localEntry, remote);
        remoteByDate.set(localEntry.isoDate, saved);
        pushed += 1;
      }
    }

    for (const remote of remoteByDate.values()) {
      const local = this.cloudEntryStore.getEntry(scope, remote.iso_date);
      if (!local || new Date(remote.updated_at || 0).getTime() >= new Date(local.updatedAt || 0).getTime()) {
        await this.cloudEntryStore.saveEntry(scope, {
          isoDate: remote.iso_date,
          raw: remote.raw || '',
          baseCloudVersion: local?.cloudVersion || 0
        });
        await this.indexer.saveEntry(remote.iso_date, remote.raw || '');
        pulled += 1;
      }
    }

    await this.settingsStore.saveSettings({
      lastCloudSyncAt: new Date().toISOString()
    });
    return {
      ok: true,
      libraryId: settings.libraryId,
      deviceId: settings.deviceId,
      pushed,
      pulled,
      remoteEntries: remoteByDate.size
    };
  }

  async uploadOriginalMedia(photo) {
    const settings = await this.ensureReadySettings();
    if (!photo?.filePath) throw new Error('Media file is missing.');
    const fileName = photo.fileName || photo.baseName || 'media';
    const safeFileName = encodeURIComponent(fileName).replace(/%20/g, '-');
    const objectPath = `libraries/${settings.libraryId}/media/${photo.id}/${safeFileName}`;
    const { supabaseUrl, supabasePublishableKey } = requireCloudSettings(settings);
    const fileBuffer = await require('fs').promises.readFile(photo.filePath);
    const uploadResponse = await cloudFetch(`${supabaseUrl}/storage/v1/object/media-originals/${objectPath}`, {
      method: 'POST',
      headers: {
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${settings.cloudSession.accessToken}`,
        'Content-Type': photo.mimeType || 'application/octet-stream',
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
      type: photo.type || ''
    };
    const created = await supabaseFetch(settings, '/rest/v1/media_items', {
      method: 'POST',
      body: JSON.stringify({
        library_id: settings.libraryId,
        host_device_id: isUuid(settings.deviceId) ? settings.deviceId : null,
        iso_date: photo.isoDate || null,
        file_name: fileName,
        metadata: {
          ...metadata,
          original_storage_path: objectPath
        },
        original_in_cloud: true,
        original_on_host: true,
        original_storage_path: objectPath,
        original_size: Number(photo.size || fileBuffer.length || 0),
        original_content_type: photo.mimeType || 'application/octet-stream',
        updated_at: new Date().toISOString()
      })
    });
    await supabaseFetch(settings, '/rest/v1/sync_changes', {
      method: 'POST',
      body: JSON.stringify({
        library_id: settings.libraryId,
        change_type: 'media.upsert',
        entity_id: photo.id,
        payload: { media: created[0] || null, localMediaId: photo.id }
      })
    }).catch(() => null);
    return created[0] || null;
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

  async status() {
    const settings = await this.settingsStore.getSettings();
    return {
      configured: Boolean(settings.supabaseUrl && settings.supabasePublishableKey),
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
