const path = require('path');
const { readJson, writeJson } = require('./utils');

function mediaSignature(photo = {}) {
  return `${photo.id || ''}:${photo.mtimeMs || 0}:${photo.size || 0}`;
}

const LOCAL_RETENTION = Object.freeze({
  UNKNOWN: 'unknown',
  KEEP_LOCAL: 'keep-local',
  CLOUD_ONLY_APPROVED: 'cloud-only-approved'
});

function normalizeLocalRetention(value) {
  return Object.values(LOCAL_RETENTION).includes(value) ? value : LOCAL_RETENTION.UNKNOWN;
}

function defaultRecord(photo = {}) {
  return {
    photoId: String(photo.id || ''),
    signature: mediaSignature(photo),
    desired: false,
    status: 'local',
    current: 0,
    total: Number(photo.size || 0),
    cloudMediaId: '',
    storagePath: '',
    localRetention: LOCAL_RETENTION.UNKNOWN,
    localRetentionUpdatedAt: '',
    localRetentionSource: '',
    lastError: '',
    updatedAt: ''
  };
}

function isUploadedOriginalRecord(record = {}) {
  return String(record.status || '') === 'cloud'
    && (Boolean(String(record.cloudMediaId || '').trim()) || Boolean(String(record.storagePath || '').trim()));
}

function isCloudOnlyApprovedRecord(record = {}) {
  return normalizeLocalRetention(record.localRetention) === LOCAL_RETENTION.CLOUD_ONLY_APPROVED
    && isUploadedOriginalRecord(record);
}

class MediaCloudStore {
  constructor({ cacheDir }) {
    this.storePath = path.join(cacheDir, 'media-cloud-state.json');
    this.state = { media: {} };
    this.loaded = false;
  }

  async init() {
    const cached = await readJson(this.storePath, null);
    this.state = {
      media: cached?.media && typeof cached.media === 'object' ? cached.media : {}
    };
    this.loaded = true;
    return this.state;
  }

  async ensureLoaded() {
    if (!this.loaded) await this.init();
  }

  async persist() {
    await writeJson(this.storePath, this.state);
  }

  keyForPhoto(photo = {}) {
    return String(photo.id || '');
  }

  async get(photo = {}) {
    await this.ensureLoaded();
    const key = this.keyForPhoto(photo);
    const stored = this.state.media[key] || {};
    return {
      ...defaultRecord(photo),
      ...stored,
      photoId: key,
      signature: mediaSignature(photo),
      localRetention: normalizeLocalRetention(stored.localRetention),
      total: Number(photo.size || stored.total || 0)
    };
  }

  async setDesired(photo = {}, desired) {
    await this.ensureLoaded();
    const record = await this.get(photo);
    const next = {
      ...record,
      desired: Boolean(desired),
      status: desired ? (record.status === 'cloud' ? 'cloud' : 'queued') : (record.status === 'cloud' ? 'removing' : 'local'),
      current: desired && record.status !== 'cloud' ? 0 : record.current,
      total: Number(photo.size || record.total || 0),
      lastError: '',
      updatedAt: new Date().toISOString()
    };
    this.state.media[next.photoId] = next;
    await this.persist();
    return next;
  }

  async update(photo = {}, updates = {}) {
    await this.ensureLoaded();
    const record = await this.get(photo);
    const next = {
      ...record,
      ...(updates || {}),
      localRetention: normalizeLocalRetention(updates.localRetention || record.localRetention),
      updatedAt: new Date().toISOString()
    };
    this.state.media[next.photoId] = next;
    await this.persist();
    return next;
  }

  async setLocalRetention(photo = {}, localRetention, source = 'user') {
    const normalized = normalizeLocalRetention(localRetention);
    return this.update(photo, {
      localRetention: normalized,
      localRetentionSource: String(source || 'user'),
      localRetentionUpdatedAt: new Date().toISOString()
    });
  }

  async listPending(indexer) {
    await this.ensureLoaded();
    const pending = [];
    for (const record of Object.values(this.state.media)) {
      const photo = indexer.getPhoto(record.photoId);
      if (!photo) continue;
      const current = await this.get(photo);
      if (current.desired && current.status !== 'cloud' && current.status !== 'uploading') pending.push({ photo, record: current });
      if (!current.desired && (current.status === 'cloud' || current.status === 'removing')) pending.push({ photo, record: current });
    }
    return pending;
  }
}

module.exports = {
  LOCAL_RETENTION,
  MediaCloudStore,
  isCloudOnlyApprovedRecord,
  mediaSignature,
  normalizeLocalRetention,
  isUploadedOriginalRecord
};
