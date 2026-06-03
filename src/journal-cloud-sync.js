const fs = require('fs');
const path = require('path');
const { hash } = require('./utils');

function isoDateFromJournalFileName(fileName) {
  const isoMatch = String(fileName || '').match(/^(\d{4}-\d{2}-\d{2})\.md$/);
  if (isoMatch) return isoMatch[1];
  const parsed = new Date(String(fileName || '').replace(/\.md$/i, ''));
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return '';
}

class JournalCloudSync {
  constructor({ journalDir, cloudEntryStore, getScope, onSynced }) {
    this.journalDir = journalDir;
    this.cloudEntryStore = cloudEntryStore;
    this.getScope = getScope;
    this.onSynced = onSynced;
    this.watcher = null;
    this.pending = new Map();
    this.suppressedWrites = new Map();
  }

  start() {
    if (this.watcher || !this.journalDir) return false;
    fs.mkdirSync(this.journalDir, { recursive: true });
    this.watcher = fs.watch(this.journalDir, { persistent: false }, (_eventType, fileName) => {
      if (!fileName || !String(fileName).toLowerCase().endsWith('.md')) return;
      this.queueFileSync(path.join(this.journalDir, String(fileName)));
    });
    return true;
  }

  setJournalDir(journalDir) {
    const nextDir = String(journalDir || '').trim();
    if (!nextDir || path.resolve(nextDir) === path.resolve(this.journalDir || '')) return;
    this.stop();
    this.journalDir = nextDir;
    this.start();
  }

  stop() {
    if (this.watcher) this.watcher.close();
    this.watcher = null;
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  queueFileSync(filePath) {
    const key = path.resolve(filePath);
    if (this.pending.has(key)) clearTimeout(this.pending.get(key));
    this.pending.set(key, setTimeout(() => {
      this.pending.delete(key);
      this.syncFileToCloud(key).catch((error) => {
        console.warn(`Cloud entry sync skipped for ${key}: ${error.message}`);
      });
    }, 250));
  }

  suppressEntryWrite(isoDate, raw, ttlMs = 5000) {
    const key = String(isoDate || '').trim();
    if (!key) return;
    this.suppressedWrites.set(key, {
      contentHash: hash(String(raw || '')),
      expiresAt: Date.now() + Math.max(500, Number(ttlMs || 0))
    });
  }

  consumeSuppressedWrite(isoDate, raw) {
    const key = String(isoDate || '').trim();
    const suppressed = this.suppressedWrites.get(key);
    if (!suppressed) return false;
    if (suppressed.expiresAt < Date.now()) {
      this.suppressedWrites.delete(key);
      return false;
    }
    if (suppressed.contentHash !== hash(String(raw || ''))) return false;
    this.suppressedWrites.delete(key);
    return true;
  }

  async syncFileToCloud(filePath) {
    const fileName = path.basename(filePath);
    const isoDate = isoDateFromJournalFileName(fileName);
    if (!isoDate) return null;
    const raw = await fs.promises.readFile(filePath, 'utf8');
    if (this.consumeSuppressedWrite(isoDate, raw)) {
      return { ok: true, suppressed: true, isoDate };
    }
    const scope = typeof this.getScope === 'function' ? await this.getScope() : {};
    const result = await this.cloudEntryStore.saveEntry(scope, {
      isoDate,
      raw,
      title: '',
      baseCloudVersion: 0,
      contentHash: hash(raw)
    });
    if (typeof this.onSynced === 'function') await this.onSynced(result);
    return result;
  }
}

module.exports = {
  JournalCloudSync,
  isoDateFromJournalFileName
};
