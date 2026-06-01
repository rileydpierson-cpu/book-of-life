const path = require('path');
const { readJson, writeJson } = require('./utils');

function normalizeScope(scope = {}) {
  return {
    userId: String(scope.userId || 'local-user').trim() || 'local-user',
    libraryId: String(scope.libraryId || 'default-library').trim() || 'default-library',
    deviceId: String(scope.deviceId || 'local-desktop').trim() || 'local-desktop'
  };
}

function entryKey(scope, isoDate) {
  const normalized = normalizeScope(scope);
  return `${normalized.userId}:${normalized.libraryId}:${isoDate}`;
}

class CloudEntryStore {
  constructor({ cacheDir }) {
    this.storePath = path.join(cacheDir, 'cloud-entry-store.json');
    this.state = {
      entries: {},
      revisions: {}
    };
    this.loaded = false;
  }

  async init() {
    const cached = await readJson(this.storePath, null);
    if (cached && typeof cached === 'object') {
      this.state = {
        entries: cached.entries && typeof cached.entries === 'object' ? cached.entries : {},
        revisions: cached.revisions && typeof cached.revisions === 'object' ? cached.revisions : {}
      };
    }
    this.loaded = true;
    return this.state;
  }

  async ensureLoaded() {
    if (!this.loaded) await this.init();
  }

  async persist() {
    await writeJson(this.storePath, this.state);
  }

  listEntries(scope = {}) {
    const normalized = normalizeScope(scope);
    return Object.values(this.state.entries)
      .filter((entry) => entry.userId === normalized.userId && entry.libraryId === normalized.libraryId)
      .sort((a, b) => b.isoDate.localeCompare(a.isoDate));
  }

  getEntry(scope, isoDate) {
    return this.state.entries[entryKey(scope, isoDate)] || null;
  }

  getRevisions(scope, isoDate) {
    return this.state.revisions[entryKey(scope, isoDate)] || [];
  }

  async saveEntry(scope, input) {
    await this.ensureLoaded();
    const normalized = normalizeScope(scope);
    const isoDate = String(input.isoDate || '').trim();
    const raw = typeof input.raw === 'string' ? input.raw : '';
    const key = entryKey(normalized, isoDate);
    const previous = this.state.entries[key] || null;
    const now = new Date().toISOString();
    const nextVersion = Number(previous?.cloudVersion || 0) + 1;
    const baseCloudVersion = Number(input.baseCloudVersion || 0);
    const hasConflict = Boolean(previous && baseCloudVersion && baseCloudVersion !== previous.cloudVersion);

    if (previous) {
      const revisions = this.state.revisions[key] || [];
      revisions.push({
        ...previous,
        supersededAt: now,
        supersededByDeviceId: normalized.deviceId,
        conflict: hasConflict
      });
      this.state.revisions[key] = revisions.slice(-100);
    }

    const entry = {
      userId: normalized.userId,
      libraryId: normalized.libraryId,
      isoDate,
      raw,
      title: String(input.title || '').trim(),
      cloudVersion: nextVersion,
      updatedAt: now,
      updatedByDeviceId: normalized.deviceId,
      deleted: raw.trim() ? false : Boolean(input.deleted)
    };
    this.state.entries[key] = entry;
    await this.persist();
    return {
      entry,
      previous,
      conflict: hasConflict,
      revisions: this.getRevisions(normalized, isoDate)
    };
  }
}

module.exports = {
  CloudEntryStore,
  normalizeScope
};
