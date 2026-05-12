const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('./utils');

const STORE_DIR_NAME = '.BookOfLife';
const LEGACY_STORE_DIR_NAMES = ['.LifeServer'];
const STORE_FILE_NAME = 'media-metadata.json';

function isValidIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function normalizeDateOverride(value) {
  if (!value || typeof value !== 'object') return null;
  const isoDate = String(value.isoDate || '').trim();
  if (!isValidIsoDate(isoDate)) return null;
  const capturedAt = typeof value.capturedAt === 'string' && value.capturedAt.includes('T')
    ? value.capturedAt
    : `${isoDate}T12:00:00.000Z`;
  return {
    isoDate,
    capturedAt,
    source: String(value.source || 'manual')
  };
}

function normalizeEntry(value) {
  if (!value || typeof value !== 'object') return {};
  const tags = Array.isArray(value.tags)
    ? Array.from(new Set(value.tags.map((tag) => String(tag || '').trim()).filter(Boolean))).slice(0, 40)
    : [];
  const description = typeof value.description === 'string'
    ? value.description.replace(/\r\n/g, '\n').trim().slice(0, 4000)
    : '';
  const liked = Boolean(value.liked);
  const dateOverride = normalizeDateOverride(value.dateOverride);
  const normalized = {};
  if (tags.length) normalized.tags = tags;
  if (description) normalized.description = description;
  if (liked) normalized.liked = true;
  if (dateOverride) normalized.dateOverride = dateOverride;
  return normalized;
}

function isEmptyEntry(entry) {
  return !entry
    || (!Array.isArray(entry.tags) || !entry.tags.length)
    && !entry.description
    && !entry.liked
    && !entry.dateOverride;
}

class PortableMediaStore {
  constructor(roots = []) {
    this.roots = Array.isArray(roots) ? roots : [];
  }

  storeDir(rootPath) {
    return path.join(rootPath, STORE_DIR_NAME);
  }

  legacyStorePaths(rootPath) {
    return LEGACY_STORE_DIR_NAMES.map((dirName) => path.join(rootPath, dirName, STORE_FILE_NAME));
  }

  storePath(rootPath) {
    return path.join(this.storeDir(rootPath), STORE_FILE_NAME);
  }

  getRootInfo(filePath) {
    for (let index = 0; index < this.roots.length; index += 1) {
      const rootPath = this.roots[index];
      const relative = path.relative(rootPath, filePath);
      if ((!relative || (!relative.startsWith('..') && !path.isAbsolute(relative)))) {
        return {
          rootId: String(index),
          rootPath,
          relativePath: (relative || path.basename(filePath)).replace(/\\/g, '/')
        };
      }
    }
    return null;
  }

  async loadRoot(rootPath) {
    let payload = await readJson(this.storePath(rootPath), null);
    if (!payload) {
      for (const legacyPath of this.legacyStorePaths(rootPath)) {
        payload = await readJson(legacyPath, null);
        if (payload) break;
      }
    }
    const entries = {};
    if (payload && typeof payload.entries === 'object') {
      for (const [relativePath, entry] of Object.entries(payload.entries)) {
        const normalized = normalizeEntry(entry);
        if (!isEmptyEntry(normalized)) entries[String(relativePath || '').replace(/\\/g, '/')] = normalized;
      }
    }
    return {
      version: 1,
      entries
    };
  }

  async saveRoot(rootPath, data) {
    await fs.promises.mkdir(this.storeDir(rootPath), { recursive: true });
    await writeJson(this.storePath(rootPath), {
      version: 1,
      entries: data.entries || {}
    });
  }

  async loadAll() {
    const stores = {};
    for (const rootPath of this.roots) {
      stores[rootPath] = await this.loadRoot(rootPath);
    }
    return stores;
  }

  getEntry(stores, filePath) {
    const rootInfo = this.getRootInfo(filePath);
    if (!rootInfo) return null;
    return stores?.[rootInfo.rootPath]?.entries?.[rootInfo.relativePath] || null;
  }

  async updateEntry(filePath, updater) {
    const rootInfo = this.getRootInfo(filePath);
    if (!rootInfo) return null;
    const store = await this.loadRoot(rootInfo.rootPath);
    const current = store.entries[rootInfo.relativePath] || {};
    const next = normalizeEntry(typeof updater === 'function' ? updater(current) : updater);
    if (isEmptyEntry(next)) delete store.entries[rootInfo.relativePath];
    else store.entries[rootInfo.relativePath] = next;
    await this.saveRoot(rootInfo.rootPath, store);
    return next;
  }

  async moveEntry(oldFilePath, newFilePath) {
    const oldRootInfo = this.getRootInfo(oldFilePath);
    const newRootInfo = this.getRootInfo(newFilePath);
    if (!oldRootInfo || !newRootInfo) return;

    const oldStore = await this.loadRoot(oldRootInfo.rootPath);
    const entry = oldStore.entries[oldRootInfo.relativePath];
    if (!entry) return;

    delete oldStore.entries[oldRootInfo.relativePath];
    await this.saveRoot(oldRootInfo.rootPath, oldStore);

    const newStore = oldRootInfo.rootPath === newRootInfo.rootPath
      ? oldStore
      : await this.loadRoot(newRootInfo.rootPath);
    newStore.entries[newRootInfo.relativePath] = normalizeEntry(entry);
    await this.saveRoot(newRootInfo.rootPath, newStore);
  }
}

module.exports = {
  PortableMediaStore,
  STORE_DIR_NAME,
  STORE_FILE_NAME,
  normalizeEntry,
  normalizeDateOverride
};
