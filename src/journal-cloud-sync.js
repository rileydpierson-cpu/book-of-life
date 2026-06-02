const fs = require('fs');
const path = require('path');

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

  async syncFileToCloud(filePath) {
    const fileName = path.basename(filePath);
    const isoDate = isoDateFromJournalFileName(fileName);
    if (!isoDate) return null;
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const scope = typeof this.getScope === 'function' ? await this.getScope() : {};
    const result = await this.cloudEntryStore.saveEntry(scope, {
      isoDate,
      raw,
      title: '',
      baseCloudVersion: 0
    });
    if (typeof this.onSynced === 'function') await this.onSynced(result);
    return result;
  }
}

module.exports = {
  JournalCloudSync,
  isoDateFromJournalFileName
};
