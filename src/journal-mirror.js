const fs = require('fs');
const path = require('path');
const {
  formatJournalFilename,
  hash,
  parseJournalFilenameDate,
  readJson,
  writeJson,
  walkFiles
} = require('./utils');

const JOURNAL_MIRROR_STATUS = Object.freeze({
  IDLE: 'idle',
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  SYNCING: 'syncing',
  CONFLICT: 'conflict'
});

function isoDateFromJournalFileName(fileName) {
  const name = String(fileName || '');
  const isoMatch = name.match(/^(\d{4}-\d{2}-\d{2})\.md$/i);
  if (isoMatch) return isoMatch[1];
  return parseJournalFilenameDate(name);
}

async function readEntryFile(filePath) {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return {
      exists: true,
      raw,
      signature: hash(raw)
    };
  } catch (error) {
    return {
      exists: false,
      raw: '',
      signature: ''
    };
  }
}

async function writeEntryFile(filePath, raw) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.promises.writeFile(tempPath, String(raw || ''), 'utf8');
  await fs.promises.rename(tempPath, filePath);
}

function conflictFileName(isoDate, source = 'External') {
  const baseName = path.basename(formatJournalFilename(isoDate) || `${isoDate}.md`, '.md');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', ' ').slice(0, 13);
  return `${baseName} (${source} Conflict ${stamp}).md`;
}

class JournalMirrorManager {
  constructor({ localDir, cacheDir, onExternalChange = null } = {}) {
    this.localDir = localDir;
    this.cacheDir = cacheDir;
    this.statePath = path.join(cacheDir, 'journal-mirror-state.json');
    this.onExternalChange = onExternalChange;
    this.state = {
      mirrorDir: '',
      entries: {},
      conflicts: []
    };
    this.status = {
      configured: false,
      status: JOURNAL_MIRROR_STATUS.IDLE,
      localDir: this.localDir || '',
      mirrorDir: '',
      available: false,
      syncing: false,
      conflictCount: 0,
      lastSyncedAt: '',
      error: ''
    };
    this.watcher = null;
    this.syncRunning = false;
    this.syncQueued = false;
  }

  async init(mirrorDir = '') {
    const cached = await readJson(this.statePath, null);
    if (cached && typeof cached === 'object') {
      this.state = {
        mirrorDir: String(cached.mirrorDir || ''),
        entries: cached.entries && typeof cached.entries === 'object' ? cached.entries : {},
        conflicts: Array.isArray(cached.conflicts) ? cached.conflicts : []
      };
    }
    await fs.promises.mkdir(this.localDir, { recursive: true });
    await fs.promises.mkdir(this.cacheDir, { recursive: true });
    await this.setMirrorDir(mirrorDir || this.state.mirrorDir || '', { sync: false });
    return this.getStatus();
  }

  async persist() {
    await writeJson(this.statePath, this.state);
  }

  normalizeMirrorDir(mirrorDir = '') {
    return String(mirrorDir || '').trim() ? path.resolve(String(mirrorDir).trim()) : '';
  }

  async setMirrorDir(mirrorDir = '', { sync = true } = {}) {
    const nextDir = this.normalizeMirrorDir(mirrorDir);
    if (nextDir !== this.state.mirrorDir) {
      this.state.mirrorDir = nextDir;
      this.state.entries = {};
      this.state.conflicts = [];
      await this.persist();
    }
    await this.refreshAvailability();
    if (sync && nextDir) return this.sync({ reason: 'settings' });
    return this.getStatus();
  }

  async refreshAvailability() {
    this.stopWatcher();
    const mirrorDir = this.state.mirrorDir || '';
    this.status = {
      ...this.status,
      configured: Boolean(mirrorDir),
      localDir: this.localDir || '',
      mirrorDir,
      conflictCount: this.state.conflicts.length,
      error: ''
    };
    if (!mirrorDir) {
      this.status.status = JOURNAL_MIRROR_STATUS.IDLE;
      this.status.available = false;
      return this.status;
    }

    try {
      const stat = await fs.promises.stat(mirrorDir);
      if (!stat.isDirectory()) throw new Error('Journal mirror path is not a folder.');
      await fs.promises.readdir(mirrorDir);
      this.status.available = true;
      this.status.status = this.state.conflicts.length ? JOURNAL_MIRROR_STATUS.CONFLICT : JOURNAL_MIRROR_STATUS.AVAILABLE;
      this.startWatcher();
    } catch (error) {
      this.status.available = false;
      this.status.status = JOURNAL_MIRROR_STATUS.UNAVAILABLE;
      this.status.error = error.message || 'Journal mirror unavailable.';
    }
    return this.status;
  }

  startWatcher() {
    if (this.watcher || !this.status.available || !this.state.mirrorDir) return;
    try {
      this.watcher = fs.watch(this.state.mirrorDir, { persistent: false }, (_eventType, fileName) => {
        if (!fileName || !String(fileName).toLowerCase().endsWith('.md')) return;
        this.queueSync('external-watch');
      });
    } catch (error) {
      this.status.available = false;
      this.status.status = JOURNAL_MIRROR_STATUS.UNAVAILABLE;
      this.status.error = error.message || 'Journal mirror watcher unavailable.';
      this.watcher = null;
    }
  }

  stopWatcher() {
    if (this.watcher) this.watcher.close();
    this.watcher = null;
  }

  queueSync(reason = 'background') {
    if (this.syncRunning) {
      this.syncQueued = true;
      return;
    }
    setImmediate(async () => {
      const result = await this.sync({ reason }).catch((error) => {
        this.status.error = error.message || 'Journal mirror sync failed.';
        return null;
      });
      if (result && typeof this.onExternalChange === 'function' && result.localChanged) {
        await this.onExternalChange(result);
      }
      if (this.syncQueued) {
        this.syncQueued = false;
        this.queueSync('queued');
      }
    });
  }

  async recordLocalWrite(isoDate, raw, { sync = true } = {}) {
    const key = String(isoDate || '').trim();
    if (!key) return this.getStatus();
    const trimmed = String(raw || '').trim();
    const entry = this.state.entries[key] || {};
    this.state.entries[key] = {
      ...entry,
      localSignature: trimmed ? hash(String(raw || '')) : '',
      localDeletedByApp: !trimmed
    };
    await this.persist();
    if (sync) return this.sync({ reason: 'local-write' });
    return this.getStatus();
  }

  async listJournalFiles(rootDir) {
    const files = await walkFiles(rootDir);
    const byDate = new Map();
    for (const filePath of files) {
      if (path.extname(filePath).toLowerCase() !== '.md') continue;
      const isoDate = isoDateFromJournalFileName(path.basename(filePath));
      if (!isoDate) continue;
      if (!byDate.has(isoDate)) byDate.set(isoDate, filePath);
    }
    return byDate;
  }

  async createConflict(isoDate, externalRaw) {
    const destination = path.join(this.localDir, conflictFileName(isoDate, 'External'));
    await writeEntryFile(destination, externalRaw);
    const conflict = {
      isoDate,
      filePath: destination,
      source: 'external',
      createdAt: new Date().toISOString()
    };
    this.state.conflicts.push(conflict);
    return conflict;
  }

  async sync({ reason = 'manual' } = {}) {
    if (this.syncRunning) {
      this.syncQueued = true;
      return { ok: true, queued: true, localChanged: false, status: this.getStatus() };
    }
    this.syncRunning = true;
    this.status.syncing = true;
    this.status.status = JOURNAL_MIRROR_STATUS.SYNCING;
    try {
      await this.refreshAvailability();
      if (!this.status.available) return { ok: false, skipped: true, reason: 'unavailable', localChanged: false, status: this.getStatus() };

      const localFiles = await this.listJournalFiles(this.localDir);
      const externalFiles = await this.listJournalFiles(this.state.mirrorDir);
      const isoDates = new Set([
        ...localFiles.keys(),
        ...externalFiles.keys(),
        ...Object.keys(this.state.entries || {})
      ]);
      let localChanged = false;
      let externalChangedCount = 0;
      let conflictCount = 0;

      for (const isoDate of isoDates) {
        const localPath = localFiles.get(isoDate) || path.join(this.localDir, formatJournalFilename(isoDate) || `${isoDate}.md`);
        const externalPath = externalFiles.get(isoDate) || path.join(this.state.mirrorDir, formatJournalFilename(isoDate) || `${isoDate}.md`);
        const [local, external] = await Promise.all([
          readEntryFile(localPath),
          readEntryFile(externalPath)
        ]);
        const previous = this.state.entries[isoDate] || {};
        const localChangedSinceSync = local.signature !== String(previous.localSignature || '');
        const externalChangedSinceSync = external.signature !== String(previous.externalSignature || '');

        if (local.exists && external.exists && local.signature !== external.signature) {
          if (localChangedSinceSync && externalChangedSinceSync) {
            await this.createConflict(isoDate, external.raw);
            conflictCount += 1;
            await writeEntryFile(externalPath, local.raw);
            externalChangedCount += 1;
          } else if (localChangedSinceSync) {
            await writeEntryFile(externalPath, local.raw);
            externalChangedCount += 1;
          } else if (externalChangedSinceSync) {
            await writeEntryFile(localPath, external.raw);
            localChanged = true;
          }
        } else if (local.exists && !external.exists) {
          await writeEntryFile(externalPath, local.raw);
          externalChangedCount += 1;
        } else if (!local.exists && external.exists) {
          if (previous.localDeletedByApp && !externalChangedSinceSync) {
            await fs.promises.rm(externalPath, { force: true }).catch(() => {});
            externalChangedCount += 1;
          } else if (previous.localDeletedByApp && externalChangedSinceSync) {
            await this.createConflict(isoDate, external.raw);
            conflictCount += 1;
          } else {
            await writeEntryFile(localPath, external.raw);
            localChanged = true;
          }
        }

        const [nextLocal, nextExternal] = await Promise.all([
          readEntryFile(localPath),
          readEntryFile(externalPath)
        ]);
        this.state.entries[isoDate] = {
          localSignature: nextLocal.signature,
          externalSignature: nextExternal.signature,
          localDeletedByApp: previous.localDeletedByApp && !nextLocal.exists
        };
      }

      this.status.lastSyncedAt = new Date().toISOString();
      this.status.error = '';
      this.status.available = true;
      this.status.status = this.state.conflicts.length ? JOURNAL_MIRROR_STATUS.CONFLICT : JOURNAL_MIRROR_STATUS.AVAILABLE;
      this.status.conflictCount = this.state.conflicts.length;
      await this.persist();
      return {
        ok: true,
        reason,
        localChanged,
        externalChanged: externalChangedCount,
        conflicts: conflictCount,
        status: this.getStatus()
      };
    } finally {
      this.syncRunning = false;
      this.status.syncing = false;
      if (this.status.status === JOURNAL_MIRROR_STATUS.SYNCING) {
        this.status.status = this.state.conflicts.length ? JOURNAL_MIRROR_STATUS.CONFLICT : JOURNAL_MIRROR_STATUS.AVAILABLE;
      }
    }
  }

  getStatus() {
    return {
      ...this.status,
      configured: Boolean(this.state.mirrorDir),
      mirrorDir: this.state.mirrorDir || '',
      localDir: this.localDir || '',
      syncing: this.syncRunning || this.status.syncing,
      conflictCount: this.state.conflicts.length
    };
  }
}

module.exports = {
  JOURNAL_MIRROR_STATUS,
  JournalMirrorManager,
  isoDateFromJournalFileName
};
