const crypto = require('crypto');
const path = require('path');
const { readJson, writeJson } = require('./utils');
const { CHANGE_TYPES, MUTATION_TYPES, validateMutationEnvelope } = require('../shared/sync-contracts');

class SyncService {
  constructor({
    cacheDir,
    indexer,
    authenticate,
    getFolderTree,
    createFolder,
    deletePhoto,
    resolveDeviceSyncRoot,
    entryStore,
    defaultScope,
    onEntryWrite
  }) {
    this.cachePath = path.join(cacheDir, 'sync-state.json');
    this.indexer = indexer;
    this.authenticate = authenticate;
    this.getFolderTree = getFolderTree;
    this.createFolder = createFolder;
    this.deletePhoto = deletePhoto;
    this.resolveDeviceSyncRoot = resolveDeviceSyncRoot;
    this.entryStore = entryStore || null;
    this.defaultScope = defaultScope || {};
    this.onEntryWrite = typeof onEntryWrite === 'function' ? onEntryWrite : null;
    this.state = {
      nextSequence: 1,
      changes: [],
      appliedMutations: {},
      devices: {}
    };
    this.loaded = false;
  }

  async init() {
    const cached = await readJson(this.cachePath, null);
    if (cached && typeof cached === 'object') {
      this.state = {
        nextSequence: Number(cached.nextSequence || 1),
        changes: Array.isArray(cached.changes) ? cached.changes : [],
        appliedMutations: cached.appliedMutations && typeof cached.appliedMutations === 'object' ? cached.appliedMutations : {},
        devices: cached.devices && typeof cached.devices === 'object' ? cached.devices : {}
      };
    }
    this.loaded = true;
    return this.state;
  }

  async persist() {
    await writeJson(this.cachePath, this.state);
  }

  async ensureLoaded() {
    if (!this.loaded) await this.init();
  }

  issueToken() {
    return crypto.randomBytes(24).toString('hex');
  }

  sanitizeDeviceSegment(value, fallbackValue = 'device') {
    return String(value || '')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || fallbackValue;
  }

  async connect({ username = '', password = '', deviceName = '', platform = '' }) {
    await this.ensureLoaded();
    const authResult = await this.authenticate({
      username,
      password,
      platform,
      deviceName
    });
    if (!authResult || authResult.ok === false) {
      throw new Error(authResult?.error || 'That account was not accepted.');
    }
    const token = this.issueToken();
    const deviceId = crypto.randomBytes(12).toString('hex');
    const safeDeviceName = this.sanitizeDeviceSegment(deviceName, `device-${deviceId.slice(0, 6)}`);
    const syncRoot = typeof this.resolveDeviceSyncRoot === 'function'
      ? await this.resolveDeviceSyncRoot({ deviceId, deviceName: safeDeviceName, platform })
      : null;
    this.state.devices[token] = {
      deviceId,
      deviceName: safeDeviceName,
      username: authResult.username || '',
      platform: String(platform || '').trim() || 'unknown',
      syncRoot,
      connectedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };
    await this.persist();
    return {
      ok: true,
      deviceId,
      authToken: token,
      username: authResult.username || '',
      syncRoot
    };
  }

  async authenticateToken(token) {
    await this.ensureLoaded();
    const record = this.state.devices[String(token || '')];
    if (!record) return null;
    record.lastSeenAt = new Date().toISOString();
    await this.persist();
    return record;
  }

  currentSequence() {
    return Math.max(0, this.state.nextSequence - 1);
  }

  async appendChange(type, entityId, payload) {
    await this.ensureLoaded();
    const sequence = this.state.nextSequence++;
    this.state.changes.push({
      sequence,
      type,
      entityId: String(entityId || ''),
      payload,
      changedAt: new Date().toISOString()
    });
    if (this.state.changes.length > 5000) {
      this.state.changes = this.state.changes.slice(-5000);
    }
    await this.persist();
    return sequence;
  }

  serializeEntryRecord(isoDate) {
    if (this.entryStore) {
      const cloudEntry = this.entryStore.getEntry(this.defaultScope, isoDate);
      if (cloudEntry) {
        return {
          ...cloudEntry,
          serverVersion: this.currentSequence(),
          hasJournal: Boolean(String(cloudEntry.raw || '').trim())
        };
      }
    }
    const day = this.indexer.state.days.get(isoDate);
    if (!day) {
      return {
        isoDate,
        deleted: true
      };
    }
    const entry = this.indexer.serializeDay(isoDate);
    return {
      isoDate,
      deleted: false,
      serverVersion: this.currentSequence(),
      title: entry.journal?.title || '',
      raw: day.journal?.raw || '',
      wordCount: entry.journal?.wordCount || 0,
      updatedAt: this.indexer.state.generatedAt || '',
      hasJournal: Boolean(day.journal)
    };
  }

  serializeMediaRecord(photo) {
    const serialized = this.indexer.serializePhoto(photo);
    return {
      ...serialized,
      deleted: false,
      serverVersion: this.currentSequence(),
      updatedAt: this.indexer.state.generatedAt || ''
    };
  }

  buildServerSummary() {
    const days = Array.from(this.indexer.state.days.values() || []);
    const journalDays = days.filter((day) => String(day?.journal?.raw || '').trim());
    const words = journalDays.reduce((sum, day) => {
      const raw = String(day?.journal?.raw || '');
      return sum + this.countWords(raw);
    }, 0);
    return {
      entries: journalDays.length,
      words,
      syncedMedia: this.indexer.state.photosById.size,
      generatedAt: this.indexer.state.generatedAt || new Date().toISOString()
    };
  }

  countWords(raw) {
    return String(raw || '')
      .replace(/!\[\[[^\]]+\]\]/g, ' ')
      .replace(/[`*_>#-]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .length;
  }

  buildBootstrapPayload() {
    const entries = this.entryStore
      ? this.entryStore.listEntries(this.defaultScope).map((entry) => ({
          ...entry,
          serverVersion: this.currentSequence(),
          hasJournal: Boolean(String(entry.raw || '').trim())
        }))
      : this.indexer.state.dayKeys.map((isoDate) => this.serializeEntryRecord(isoDate));
    const media = Array.from(this.indexer.state.photosById.values()).map((photo) => this.serializeMediaRecord(photo));
    const roots = this.getFolderTree();
    return {
      checkpoint: this.currentSequence(),
      bootstrap: this.indexer.getBootstrap(),
      serverSummary: this.buildServerSummary(),
      entries,
      media,
      folders: roots.map(({ rootId, rootLabel, tree }) => ({ rootId, rootLabel, tree }))
    };
  }

  async listChangesSince(sequence) {
    await this.ensureLoaded();
    const since = Math.max(0, Number(sequence || 0));
    return {
      checkpoint: this.currentSequence(),
      serverSummary: this.buildServerSummary(),
      changes: this.state.changes.filter((change) => Number(change.sequence || 0) > since)
    };
  }

  async applyMutationEnvelope(envelope) {
    await this.ensureLoaded();
    if (this.state.appliedMutations[envelope.id]) {
      return {
        accepted: true,
        mutationId: envelope.id,
        duplicate: true,
        sequence: this.state.appliedMutations[envelope.id]
      };
    }

    let sequence = 0;
    let result = null;
    switch (envelope.type) {
      case MUTATION_TYPES.ENTRY_SAVE: {
        if (this.entryStore) {
          const scope = {
            ...this.defaultScope,
            userId: envelope.userId || envelope.payload.scope?.userId || this.defaultScope.userId,
            libraryId: envelope.libraryId || envelope.payload.scope?.libraryId || this.defaultScope.libraryId,
            deviceId: envelope.deviceId || envelope.payload.scope?.deviceId || this.defaultScope.deviceId
          };
          result = await this.entryStore.saveEntry(scope, {
            isoDate: envelope.payload.isoDate,
            raw: envelope.payload.raw,
            baseCloudVersion: envelope.baseCloudVersion || envelope.payload.baseCloudVersion || 0
          });
          await this.indexer.saveEntry(envelope.payload.isoDate, envelope.payload.raw);
        } else {
          result = await this.indexer.saveEntry(envelope.payload.isoDate, envelope.payload.raw);
        }
        if (this.onEntryWrite) await this.onEntryWrite(envelope.payload.isoDate, envelope.payload.raw);
        sequence = await this.appendChange(CHANGE_TYPES.ENTRY_UPSERT, envelope.payload.isoDate, {
          entry: this.serializeEntryRecord(envelope.payload.isoDate),
          day: result?.entry ? { isoDate: envelope.payload.isoDate } : result,
          conflict: Boolean(result?.conflict)
        });
        break;
      }
      case MUTATION_TYPES.ENTRY_DELETE: {
        if (this.entryStore) {
          result = await this.entryStore.saveEntry(this.defaultScope, {
            isoDate: envelope.payload.isoDate,
            raw: '',
            deleted: true,
            baseCloudVersion: envelope.baseCloudVersion || 0
          });
        }
        await this.indexer.saveEntry(envelope.payload.isoDate, '');
        if (this.onEntryWrite) await this.onEntryWrite(envelope.payload.isoDate, '');
        sequence = await this.appendChange(CHANGE_TYPES.ENTRY_DELETE, envelope.payload.isoDate, {
          isoDate: envelope.payload.isoDate,
          deleted: true
        });
        break;
      }
      case MUTATION_TYPES.FOLDER_CREATE: {
        result = await this.createFolder(envelope.payload.rootId, envelope.payload.relativePath, envelope.payload.folderName);
        sequence = await this.appendChange(CHANGE_TYPES.FOLDER_UPSERT, `${envelope.payload.rootId}:${result.relativePath}`, {
          rootId: envelope.payload.rootId,
          relativePath: result.relativePath
        });
        break;
      }
      case MUTATION_TYPES.MEDIA_TAGS_SET: {
        const photo = await this.indexer.setPhotoTags(envelope.payload.photoId, envelope.payload.tags);
        result = photo;
        sequence = await this.appendChange(CHANGE_TYPES.MEDIA_UPSERT, envelope.payload.photoId, {
          media: this.serializeMediaRecord(photo)
        });
        break;
      }
      case MUTATION_TYPES.MEDIA_DESCRIPTION_SET: {
        const photo = await this.indexer.setPhotoDescription(envelope.payload.photoId, envelope.payload.description);
        result = photo;
        sequence = await this.appendChange(CHANGE_TYPES.MEDIA_UPSERT, envelope.payload.photoId, {
          media: this.serializeMediaRecord(photo)
        });
        break;
      }
      case MUTATION_TYPES.MEDIA_LIKE_SET: {
        const photo = await this.indexer.setPhotoLiked(envelope.payload.photoId, envelope.payload.liked);
        result = photo;
        sequence = await this.appendChange(CHANGE_TYPES.MEDIA_UPSERT, envelope.payload.photoId, {
          media: this.serializeMediaRecord(photo)
        });
        break;
      }
      case MUTATION_TYPES.MEDIA_DATE_TIME_SET: {
        const photo = await this.indexer.setPhotoDateTime(envelope.payload.photoId, {
          isoDate: envelope.payload.isoDate || null,
          time: envelope.payload.time || null
        });
        result = photo;
        sequence = await this.appendChange(CHANGE_TYPES.MEDIA_UPSERT, envelope.payload.photoId, {
          media: this.serializeMediaRecord(photo)
        });
        break;
      }
      case MUTATION_TYPES.MEDIA_RENAME: {
        const renamed = await this.indexer.renamePhoto(envelope.payload.photoId, envelope.payload.baseName);
        result = renamed;
        sequence = await this.appendChange(CHANGE_TYPES.MEDIA_UPSERT, envelope.payload.photoId, {
          media: this.serializeMediaRecord(renamed)
        });
        break;
      }
      case MUTATION_TYPES.MEDIA_MOVE: {
        const moved = await this.indexer.movePhoto(envelope.payload.photoId, envelope.payload.rootId, envelope.payload.relativePath);
        result = moved;
        sequence = await this.appendChange(CHANGE_TYPES.MEDIA_UPSERT, envelope.payload.photoId, {
          media: this.serializeMediaRecord(moved)
        });
        break;
      }
      case MUTATION_TYPES.MEDIA_DELETE: {
        const deleted = await this.deletePhoto(envelope.payload.photoId);
        result = deleted;
        sequence = await this.appendChange(CHANGE_TYPES.MEDIA_DELETE, envelope.payload.photoId, {
          photoId: envelope.payload.photoId,
          deleted: true,
          isoDate: deleted?.isoDate || null
        });
        break;
      }
      default:
        throw new Error(`Unsupported mutation type: ${envelope.type}`);
    }

    this.state.appliedMutations[envelope.id] = sequence;
    await this.persist();
    return {
      accepted: true,
      mutationId: envelope.id,
      sequence,
      result
    };
  }

  async applyMutations(batch) {
    await this.ensureLoaded();
    const mutations = Array.isArray(batch) ? batch : [];
    const results = [];
    for (const raw of mutations) {
      const validated = validateMutationEnvelope(raw);
      if (!validated.ok) {
        results.push({
          accepted: false,
          mutationId: raw?.id || '',
          error: validated.error
        });
        continue;
      }
      try {
        results.push(await this.applyMutationEnvelope(validated.mutation));
      } catch (error) {
        results.push({
          accepted: false,
          mutationId: validated.mutation.id,
          error: error.message || 'Mutation failed.'
        });
      }
    }
    return {
      checkpoint: this.currentSequence(),
      results
    };
  }
}

module.exports = {
  SyncService
};
