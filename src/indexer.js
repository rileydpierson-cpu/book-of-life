const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');
const exifr = require('exifr');
const {
  readVideoCreatedDate,
  readMediaDimensions,
  isExifWritableImage,
  isVideoMetadataWritable,
  writeImageExifCreatedDate,
  writeVideoCreatedDateInPlace
} = require('./media-metadata');
const { PortableMediaStore } = require('./portable-media-store');
const {
  walkFiles,
  isImageFile,
  isMediaFile,
  isVideoFile,
  readJson,
  writeJson,
  mapLimit,
  parseJournalFilenameDate,
  formatJournalFilename,
  dateToIsoLocal,
  hash,
  monthLabelFromIso,
  longDateLabel,
  shortDateLabel,
  slugMonth
} = require('./utils');
const { LOCAL_RETENTION, isUploadedOriginalRecord } = require('./media-cloud-store');

const MEDIA_AVAILABILITY = Object.freeze({
  AVAILABLE: 'available',
  MISSING_CLOUD: 'missing-cloud',
  ROOT_UNAVAILABLE: 'root-unavailable',
  CLOUD_ONLY: 'cloud-only',
  MISSING_UNAPPROVED: 'missing-unapproved',
  MISSING_CLOUD_RISK: 'missing-cloud-risk'
});

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});

function validDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
}

function selectImageExifDateInfo(exif) {
  const modifiedDate = validDate(exif?.ModifyDate);
  if (modifiedDate) {
    return {
      capturedAtDate: modifiedDate,
      modifiedAtDate: modifiedDate,
      source: 'exif-modified'
    };
  }

  const capturedDate = validDate(exif?.DateTimeOriginal) || validDate(exif?.CreateDate);
  if (capturedDate) {
    return {
      capturedAtDate: capturedDate,
      modifiedAtDate: null,
      source: 'exif-captured'
    };
  }

  return {
    capturedAtDate: null,
    modifiedAtDate: null,
    source: null
  };
}

class TimelineIndexer {
  constructor(config) {
    this.config = config;
    this.cacheDir = config.paths.cacheDir;
    this.photoRoots = config.paths.photoFolders || [];
    this.portableMediaStore = new PortableMediaStore(this.photoRoots);
    this.indexCachePath = path.join(this.cacheDir, 'index.json');
    this.mediaMetaCachePath = path.join(this.cacheDir, 'photo-meta.json');
    this.mediaTagsCachePath = path.join(this.cacheDir, 'media-tags.json');
    this.mediaDescriptionsCachePath = path.join(this.cacheDir, 'media-descriptions.json');
    this.mediaLikesCachePath = path.join(this.cacheDir, 'media-likes.json');
    this.mediaDateOverridesCachePath = path.join(this.cacheDir, 'media-date-overrides.json');
    this.mediaInventoryCachePath = path.join(this.cacheDir, 'media-inventory.json');

    this.state = {
      generatedAt: null,
      journalImages: {},
      days: new Map(),
      dayKeys: [],
      railDates: [],
      years: [],
      monthsByYear: [],
      photosById: new Map(),
      dayIndexByDate: {},
      mediaTags: {},
      mediaDescriptions: {},
      mediaLikes: {},
      mediaDateOverrides: {}
    };

    this.isBuilding = false;
    this.rebuildQueued = false;
    this.mediaInventory = {};
    this.mediaInventorySignature = '';
    this.mediaRootStatus = {};
    this.mediaCloudStore = null;
    this.localDevice = { id: '', name: 'Desktop', type: 'desktop' };
    this.onIndexChanged = null;
    this.rebuildProgress = createIdleRebuildProgress();
  }

  setMediaCloudStore(mediaCloudStore) {
    this.mediaCloudStore = mediaCloudStore || null;
  }

  setDeviceIdentity({ id = '', name = '', type = 'desktop' } = {}) {
    this.localDevice = {
      id: String(id || ''),
      name: String(name || '').trim() || 'Desktop',
      type: String(type || 'desktop')
    };
  }

  setIndexChangedHandler(handler) {
    this.onIndexChanged = typeof handler === 'function' ? handler : null;
  }

  notifyIndexChanged(reason, photos = null) {
    if (!this.onIndexChanged) return;
    try {
      this.onIndexChanged({
        reason,
        photos: Array.isArray(photos) ? photos : Array.from(this.state.photosById.values())
      });
    } catch (error) {
      console.warn(`Index change handler skipped (${reason}): ${error.message}`);
    }
  }

  setPhotoRoots(photoRoots = []) {
    this.photoRoots = Array.isArray(photoRoots) ? photoRoots.filter(Boolean) : [];
    this.config.paths.photoFolders = this.photoRoots;
    this.portableMediaStore = new PortableMediaStore(this.photoRoots);
  }

  setJournalFolderPath(journalFolderPath) {
    const nextPath = String(journalFolderPath || '').trim();
    if (!nextPath) return;
    this.config.paths.journalVault = path.dirname(nextPath);
    this.config.paths.journalFolderName = path.basename(nextPath);
    fs.mkdirSync(nextPath, { recursive: true });
  }

  async loadCache() {
    const cachedIndex = await readJson(this.indexCachePath, null);
    if (cachedIndex) this.state = this.inflateState(cachedIndex);
    const cachedInventory = await readJson(this.mediaInventoryCachePath, null);
    if (cachedInventory?.entries && typeof cachedInventory.entries === 'object') {
      this.mediaInventory = cachedInventory.entries;
      this.mediaInventorySignature = String(cachedInventory.signature || '');
      this.mediaRootStatus = cachedInventory.rootStatus && typeof cachedInventory.rootStatus === 'object'
        ? cachedInventory.rootStatus
        : {};
    }
  }

  async init() {
    await this.loadCache();
    return this.rebuild('startup');
  }

  scheduleRebuild(reason = 'scheduled') {
    if (this.isBuilding) {
      this.rebuildQueued = true;
      return;
    }
    this.rebuild(reason).catch((error) => {
      console.error(`Index rebuild failed (${reason})`, error);
    });
  }

  scheduleRefresh(reason = 'scheduled-refresh') {
    if (this.isBuilding) return;
    this.refreshFromFilesystem(reason).catch((error) => {
      console.error(`Index refresh failed (${reason})`, error);
    });
  }

  async rebuild(reason = 'manual') {
    if (this.isBuilding) {
      this.rebuildQueued = true;
      return;
    }

    this.isBuilding = true;
    const progress = this.createRebuildProgress(reason);
    const startedAt = Date.now();
    try {
      progress?.setStage('Scanning media folders', Math.max(this.photoRoots.length, 1));
      const inventory = await this.scanMediaInventory({ progress });
      const nextState = await this.buildState({ inventory, progress });
      progress?.setStage('Writing cache files', 2);
      this.state = nextState;
      await writeJson(this.indexCachePath, this.serializeState(nextState));
      progress?.increment();
      await this.persistMediaInventory(inventory);
      progress?.increment();
      progress?.complete();
      this.notifyIndexChanged(reason);
      const durationMs = Date.now() - startedAt;
      console.log(`Book of Life index rebuilt (${reason}) with ${nextState.dayKeys.length} days in ${formatDuration(durationMs)}.`);
      return {
        reason,
        dayCount: nextState.dayKeys.length,
        durationMs
      };
    } catch (error) {
      this.rebuildProgress = {
        ...this.getRebuildStatus(),
        running: false,
        completedAt: new Date().toISOString(),
        error: error.message || 'Index rebuild failed.'
      };
      throw error;
    } finally {
      progress?.clear();
      this.isBuilding = false;
      if (this.rebuildQueued) {
        this.rebuildQueued = false;
        queueMicrotask(() => this.rebuild('queued'));
      }
    }
  }

  thumbUrlForPhoto(photo) {
    if (!photo?.id) return '';
    const version = hash(`${photo.id}|${photo.mtimeMs || 0}|${photo.size || 0}|thumb-v6`);
    return `/media/thumb/${photo.id}?v=${version}`;
  }

  previewUrlForPhoto(photo) {
    if (!photo?.id || photo.type !== 'video') return '';
    const version = hash(`${photo.id}|${photo.mtimeMs || 0}|${photo.size || 0}|preview-v1`);
    return `/media/preview/${photo.id}?v=${version}`;
  }

  displayUrlForPhoto(photo) {
    if (!photo?.id) return '';
    const settings = this.config.mediaOptimization || {};
    const version = hash([
      photo.id,
      photo.mtimeMs || 0,
      photo.size || 0,
      'display-v1',
      settings.enabled ? 'on' : 'off',
      settings.imageMaxEdge || 2560,
      settings.imageQuality || 86,
      settings.videoMaxHeight || 1080,
      settings.videoCrf || 22,
      settings.videoPreset || 'medium'
    ].join('|'));
    return `/media/display/${photo.id}?v=${version}`;
  }

  downloadUrlForPhoto(photo) {
    return photo?.id ? `/media/download/${photo.id}` : '';
  }

  thumbUrlForPhotoId(photoId) {
    const photo = this.state.photosById.get(photoId);
    return photo ? this.thumbUrlForPhoto(photo) : `/media/thumb/${photoId}`;
  }

  async buildState({ inventory = null, progress = null } = {}) {
    const dayMap = new Map();
    const photosById = new Map();
    const journalImages = await this.indexJournalImages();
    const mediaMetaCache = await readJson(this.mediaMetaCachePath, {});
    const mediaTags = await readJson(this.mediaTagsCachePath, {});
    const mediaDescriptions = await readJson(this.mediaDescriptionsCachePath, {});
    const mediaLikes = await readJson(this.mediaLikesCachePath, {});
    const mediaDateOverrides = await readJson(this.mediaDateOverridesCachePath, {});
    const portableMetadata = await this.portableMediaStore.loadAll();
    await this.migrateLegacyPortableMetadata({
      mediaTags,
      mediaDescriptions,
      mediaLikes,
      mediaDateOverrides,
      portableMetadata
    });
    const nextMediaMetaCache = {};

    await this.indexJournals(dayMap, journalImages, progress);
    await this.indexMedia(
      dayMap,
      photosById,
      mediaMetaCache,
      nextMediaMetaCache,
      mediaTags,
      mediaDescriptions,
      mediaLikes,
      mediaDateOverrides,
      portableMetadata,
      inventory?.records || null,
      progress
    );
    await this.preserveUnavailableMedia({
      dayMap,
      photosById,
      inventory
    });

    const derivedTags = {};
    const derivedDescriptions = {};
    const derivedLikes = {};
    const derivedDateOverrides = {};
    for (const photo of photosById.values()) {
      if (Array.isArray(photo.tags) && photo.tags.length) derivedTags[photo.filePath] = photo.tags;
      if (photo.description) derivedDescriptions[photo.filePath] = photo.description;
      if (photo.liked) derivedLikes[photo.filePath] = true;
      const portableEntry = this.portableMediaStore.getEntry(portableMetadata, photo.filePath);
      if (portableEntry?.dateOverride) derivedDateOverrides[photo.filePath] = portableEntry.dateOverride;
    }

    await writeJson(this.mediaMetaCachePath, nextMediaMetaCache);
    await writeJson(this.mediaTagsCachePath, derivedTags);
    await writeJson(this.mediaDescriptionsCachePath, derivedDescriptions);
    await writeJson(this.mediaLikesCachePath, derivedLikes);
    await writeJson(this.mediaDateOverridesCachePath, derivedDateOverrides);

    const nextState = {
      generatedAt: new Date().toISOString(),
      journalImages,
      days: dayMap,
      dayKeys: [],
      railDates: [],
      years: [],
      monthsByYear: [],
      photosById,
      dayIndexByDate: {},
      mediaTags: derivedTags,
      mediaDescriptions: derivedDescriptions,
      mediaLikes: derivedLikes,
      mediaDateOverrides: derivedDateOverrides
    };
    const previousState = this.state;
    this.state = nextState;
    this.recomputeDerivedState();
    const built = this.state;
    this.state = previousState;
    return built;
  }

  async scanMediaInventory({ progress = null } = {}) {
    const records = [];
    const entries = {};
    const rootStatus = {};
    const availableRoots = [];
    const unavailableRoots = [];

    for (const folder of this.photoRoots) {
      let rootAvailable = true;
      let rootError = '';
      try {
        await fs.promises.readdir(folder, { withFileTypes: true });
      } catch (error) {
        rootAvailable = false;
        rootError = error.message || 'Folder is unavailable.';
      }
      rootStatus[folder] = {
        path: folder,
        available: rootAvailable,
        error: rootError,
        mediaCount: 0
      };
      if (!rootAvailable) {
        unavailableRoots.push(folder);
        progress?.increment();
        continue;
      }
      availableRoots.push(folder);
      const files = await walkFiles(folder);
      for (const filePath of files) {
        if (!isMediaFile(filePath)) continue;
        try {
          const stat = await fs.promises.stat(filePath);
          const entrySignature = `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
          records.push({ filePath, stat, signature: hash(`${filePath}|${stat.size}|${stat.mtimeMs}`) });
          entries[filePath] = entrySignature;
          rootStatus[folder].mediaCount += 1;
        } catch (error) {
          // Ignore files that disappear during scan.
        }
      }
      progress?.increment();
    }

    return {
      records,
      entries,
      signature: this.computeInventorySignature(entries),
      rootStatus,
      availableRoots,
      unavailableRoots
    };
  }

  computeInventorySignature(entries = {}) {
    return hash(
      Object.keys(entries)
        .sort((a, b) => a.localeCompare(b))
        .map((filePath) => `${filePath}|${entries[filePath]}`)
        .join('\n')
    );
  }

  async persistMediaInventory(inventory) {
    this.mediaInventory = inventory?.entries || {};
    this.mediaInventorySignature = String(inventory?.signature || '');
    this.mediaRootStatus = inventory?.rootStatus || {};
    await writeJson(this.mediaInventoryCachePath, {
      signature: this.mediaInventorySignature,
      entries: this.mediaInventory,
      rootStatus: this.mediaRootStatus
    });
  }

  getRootAvailabilitySummary() {
    const rootStatus = this.mediaRootStatus || {};
    const roots = this.photoRoots.map((rootPath) => {
      const status = rootStatus[rootPath] || { path: rootPath, available: true, mediaCount: 0, error: '' };
      return {
        path: rootPath,
        rootLabel: path.basename(rootPath) || rootPath,
        available: status.available !== false,
        error: String(status.error || ''),
        mediaCount: Math.max(0, Number(status.mediaCount || 0)),
        warningCount: 0
      };
    });
    const byPath = new Map(roots.map((root) => [root.path, root]));
    let missingCloudCount = 0;
    let rootUnavailableCount = 0;
    let cloudOnlyCount = 0;
    let missingUnapprovedCount = 0;
    let missingCloudRiskCount = 0;
    for (const photo of this.state.photosById.values()) {
      const availability = photo.availability || MEDIA_AVAILABILITY.AVAILABLE;
      if (availability === MEDIA_AVAILABILITY.AVAILABLE) continue;
      if (availability === MEDIA_AVAILABILITY.CLOUD_ONLY) {
        cloudOnlyCount += 1;
        continue;
      }
      missingCloudCount += 1;
      if (photo.availability === MEDIA_AVAILABILITY.ROOT_UNAVAILABLE) rootUnavailableCount += 1;
      if (photo.availability === MEDIA_AVAILABILITY.MISSING_UNAPPROVED) missingUnapprovedCount += 1;
      if (photo.availability === MEDIA_AVAILABILITY.MISSING_CLOUD_RISK || photo.availability === MEDIA_AVAILABILITY.MISSING_CLOUD) missingCloudRiskCount += 1;
      const root = byPath.get(photo.rootPath);
      if (root) root.warningCount += 1;
    }
    return {
      roots,
      missingCloudCount,
      rootUnavailableCount,
      cloudOnlyCount,
      missingUnapprovedCount,
      missingCloudRiskCount,
      warningCount: missingCloudCount
    };
  }

  async getCloudOriginalRecord(photo) {
    if (!this.mediaCloudStore || !photo?.id) return false;
    try {
      return await this.mediaCloudStore.get(photo);
    } catch (error) {
      return false;
    }
  }

  async isCloudUploadedOriginal(photo) {
    return isUploadedOriginalRecord(await this.getCloudOriginalRecord(photo));
  }

  async classifyUnavailablePhoto(photo, rootPath, { availableRoots = new Set(), unavailableRoots = new Set() } = {}) {
    if (unavailableRoots.has(rootPath)) return MEDIA_AVAILABILITY.ROOT_UNAVAILABLE;
    if (!availableRoots.has(rootPath)) return null;

    const cloudRecord = await this.getCloudOriginalRecord(photo);
    if (isUploadedOriginalRecord(cloudRecord)) {
      return cloudRecord.localRetention === LOCAL_RETENTION.CLOUD_ONLY_APPROVED
        ? MEDIA_AVAILABILITY.CLOUD_ONLY
        : MEDIA_AVAILABILITY.MISSING_CLOUD_RISK;
    }
    return MEDIA_AVAILABILITY.MISSING_UNAPPROVED;
  }

  cloneUnavailablePhoto(photo, availability) {
    return {
      ...photo,
      availability,
      originalAvailable: false,
      unavailableSince: photo.unavailableSince || new Date().toISOString()
    };
  }

  async preserveUnavailableMedia({ dayMap, photosById, inventory = null } = {}) {
    const previousPhotos = Array.from(this.state?.photosById?.values?.() || []);
    if (!previousPhotos.length) return;

    const entries = inventory?.entries || {};
    const availableRoots = new Set(inventory?.availableRoots || this.photoRoots);
    const unavailableRoots = new Set(inventory?.unavailableRoots || []);
    const inventoryHasPath = (filePath) => Object.prototype.hasOwnProperty.call(entries, filePath);

    for (const previousPhoto of previousPhotos) {
      if (!previousPhoto?.id || photosById.has(previousPhoto.id) || inventoryHasPath(previousPhoto.filePath)) continue;
      const rootPath = previousPhoto.rootPath || this.getPhotoRootInfo(previousPhoto.filePath).rootPath;
      const availability = await this.classifyUnavailablePhoto(previousPhoto, rootPath, { availableRoots, unavailableRoots });
      if (!availability) continue;

      const preserved = this.cloneUnavailablePhoto(previousPhoto, availability);
      photosById.set(preserved.id, preserved);
      this.getOrCreateDay(dayMap, preserved.isoDate).photos.push(preserved);
    }
  }

  async indexJournalImages() {
    const imageRoot = path.join(this.config.paths.journalVault, this.config.paths.journalImagesFolderName);
    const files = await walkFiles(imageRoot);
    const imageMap = {};
    for (const filePath of files) {
      if (!isImageFile(filePath)) continue;
      const baseName = path.basename(filePath);
      if (!imageMap[baseName]) imageMap[baseName] = filePath;
    }
    return imageMap;
  }

  async indexJournals(dayMap, journalImages, progress = null) {
    const journalRoot = path.join(this.config.paths.journalVault, this.config.paths.journalFolderName);
    const files = await walkFiles(journalRoot);
    const journalFiles = files.filter((filePath) => path.extname(filePath).toLowerCase() === '.md');
    progress?.setStage('Indexing journal entries', Math.max(journalFiles.length, 1));

    for (const filePath of journalFiles) {
      const isoDate = parseJournalFilenameDate(path.basename(filePath));
      if (!isoDate) {
        progress?.increment();
        continue;
      }

      const raw = await fs.promises.readFile(filePath, 'utf8');
      const day = this.getOrCreateDay(dayMap, isoDate);
      day.journal = this.createJournalRecord(filePath, raw, journalImages);
      progress?.increment();
    }
  }

  async indexMedia(dayMap, photosById, mediaMetaCache, nextMediaMetaCache, mediaTags = {}, mediaDescriptions = {}, mediaLikes = {}, mediaDateOverrides = {}, portableMetadata = {}, inventoryRecords = null, progress = null) {
    const validStats = Array.isArray(inventoryRecords)
      ? inventoryRecords
      : (await this.scanMediaInventory()).records;
    progress?.setStage('Indexing media library', Math.max(validStats.length, 1));
    const mediaRecords = await mapLimit(validStats, 6, async ({ filePath, stat, signature }) => {
      const record = await this.buildPhotoRecord({
        filePath,
        stat,
        signature: signature || hash(`${filePath}|${stat.size}|${stat.mtimeMs}`),
        mediaMetaCache,
        nextMediaMetaCache,
        mediaTags,
        mediaDescriptions,
        mediaLikes,
        mediaDateOverrides,
        portableMetadata
      });
      if (!record) return null;
      photosById.set(record.id, record);
      const day = this.getOrCreateDay(dayMap, record.isoDate);
      day.photos.push(record);
      return record;
    }, {
      onProgress: () => progress?.increment()
    });

    return mediaRecords.filter(Boolean);
  }

  createRebuildProgress(reason) {
    const webProgress = new WebRebuildProgress(this, reason);
    if (reason !== 'startup' || !process.stdout.isTTY) return webProgress;
    return new CompositeRebuildProgress([
      webProgress,
      new StartupProgressRenderer('Book of Life startup')
    ]);
  }

  getRebuildStatus() {
    return {
      ...createIdleRebuildProgress(),
      ...(this.rebuildProgress || {}),
      running: this.isBuilding,
      queued: this.rebuildQueued
    };
  }

  async buildPhotoRecord({
    filePath,
    stat,
    signature,
    mediaMetaCache,
    nextMediaMetaCache,
    mediaTags = {},
    mediaDescriptions = {},
    mediaLikes = {},
    mediaDateOverrides = {},
    portableMetadata = {}
  }) {
      const effectiveSignature = signature || hash(`${filePath}|${stat.size}|${stat.mtimeMs}`);
      const portableEntry = this.portableMediaStore.getEntry(portableMetadata, filePath) || {};
      const manualDateOverride = this.normalizeMediaDateOverride(portableEntry.dateOverride || mediaDateOverrides[filePath]);
      const cachedMeta = mediaMetaCache[effectiveSignature] || null;
      const cachedDateInfo = cachedMeta?.dateInfo || (cachedMeta?.isoDate ? cachedMeta : null);
      let dateInfo = manualDateOverride || null;
      if (!dateInfo && cachedDateInfo && !this.shouldRefreshCachedDateInfo(cachedDateInfo, filePath)) {
        dateInfo = cachedDateInfo;
      }
      if (!dateInfo) dateInfo = await this.extractMediaDateInfo(filePath, stat);
      if (!dateInfo) return null;
      const dimensions = cachedMeta?.width && cachedMeta?.height
        ? { width: Number(cachedMeta.width || 0), height: Number(cachedMeta.height || 0) }
        : await readMediaDimensions(filePath);
      if (!manualDateOverride) {
        nextMediaMetaCache[effectiveSignature] = {
          dateInfo,
          width: dimensions.width || 0,
          height: dimensions.height || 0
        };
      }

      const id = hash(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const type = isVideoFile(filePath) ? 'video' : 'image';
      const rootInfo = this.getPhotoRootInfo(filePath);
      const record = {
        id,
        filePath,
        fileName: path.basename(filePath),
        baseName: path.basename(filePath, ext),
        ext,
        type,
        isoDate: dateInfo.isoDate,
        capturedAt: dateInfo.capturedAt,
        modifiedAt: dateInfo.modifiedAt,
        dateSource: dateInfo.source,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        birthtimeMs: stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs,
        width: dimensions.width || 0,
        height: dimensions.height || 0,
        folder: rootInfo.relativeFolder,
        folderRootLabel: rootInfo.rootLabel,
        folderRootId: rootInfo.rootId,
        rootPath: rootInfo.rootPath,
        relativePath: rootInfo.relativePath,
        tags: Array.isArray(portableEntry.tags) ? portableEntry.tags : (Array.isArray(mediaTags[filePath]) ? mediaTags[filePath] : []),
        description: typeof portableEntry.description === 'string' ? portableEntry.description : (typeof mediaDescriptions[filePath] === 'string' ? mediaDescriptions[filePath] : ''),
        liked: Object.prototype.hasOwnProperty.call(portableEntry, 'liked') ? Boolean(portableEntry.liked) : Boolean(mediaLikes[filePath])
      };
      record.availability = MEDIA_AVAILABILITY.AVAILABLE;
      record.originalAvailable = true;
      return record;
  }

  shouldRefreshCachedDateInfo(cachedDateInfo) {
    if (!cachedDateInfo) return false;
    const source = String(cachedDateInfo.source || '');
    return !source || source === 'filename' || source === 'exif' || source === 'filesystem-created';
  }

  async extractMediaDateInfo(filePath, stat) {
    let capturedAtDate = null;
    let modifiedAtDate = null;
    let dateSource = null;

    if (isImageFile(filePath)) {
      try {
        const fileBuffer = await fs.promises.readFile(filePath);
        const exif = await exifr.parse(fileBuffer, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] });
        const exifDateInfo = selectImageExifDateInfo(exif);
        capturedAtDate = exifDateInfo.capturedAtDate;
        modifiedAtDate = exifDateInfo.modifiedAtDate;
        dateSource = exifDateInfo.source;
      } catch (error) {
        // Many exported or edited images have no EXIF. Ignore and fall through.
      }
    }

    if (isVideoFile(filePath)) {
      const videoDate = await readVideoCreatedDate(filePath);
      if (videoDate) {
        capturedAtDate = new Date(videoDate.capturedAt);
        dateSource = videoDate.source;
      }
    }

    if (!capturedAtDate) {
      const modified = new Date(stat.mtimeMs);
      if (!Number.isNaN(modified.getTime())) {
        capturedAtDate = modified;
        dateSource = 'filesystem-modified';
      }
    }

    if (!capturedAtDate) {
      const created = stat.birthtimeMs ? new Date(stat.birthtimeMs) : null;
      if (created && !Number.isNaN(created.getTime())) {
        capturedAtDate = created;
        dateSource = 'filesystem-created';
      }
    }

    if (!capturedAtDate) {
      return null;
    }

    // Use file modification time as fallback for modifiedAtDate
    if (!modifiedAtDate) {
      modifiedAtDate = new Date(stat.mtimeMs);
    }

    return {
      isoDate: capturedAtDate.toISOString().slice(0, 10),
      capturedAt: capturedAtDate.toISOString(),
      modifiedAt: modifiedAtDate.toISOString(),
      source: dateSource
    };
  }


  getPhotoRootInfo(filePath) {
    const roots = this.photoRoots;
    for (let index = 0; index < roots.length; index += 1) {
      const root = roots[index];
      const relative = path.relative(root, filePath);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        const normalized = relative.replace(/\\/g, '/');
        const folder = path.dirname(normalized).replace(/\\/g, '/');
        return {
          rootId: String(index),
          rootPath: root,
          rootLabel: path.basename(root) || root,
          relativeFolder: folder && folder !== '.' ? folder : '.',
          relativePath: normalized
        };
      }
      if (!relative) {
        return {
          rootId: String(index),
          rootPath: root,
          rootLabel: path.basename(root) || root,
          relativeFolder: '.',
          relativePath: path.basename(filePath)
        };
      }
    }
    return { rootId: '', rootPath: '', rootLabel: '', relativeFolder: '.', relativePath: path.basename(filePath) };
  }

  getOrCreateDay(dayMap, isoDate) {
    if (!dayMap.has(isoDate)) {
      dayMap.set(isoDate, {
        isoDate,
        dateLabel: longDateLabel(isoDate),
        monthKey: isoDate.slice(0, 7),
        monthLabel: monthLabelFromIso(isoDate),
        journal: null,
        photos: [],
        photoIds: []
      });
    }
    return dayMap.get(isoDate);
  }

  renderJournalHtml(raw, journalImages) {
    const withEmbeds = raw.replace(/!\[\[([^\]]+)\]\]/g, (match, imageName) => {
      const trimmed = String(imageName).trim();
      if (!journalImages[trimmed]) return '';
      return `![](/media/journal-inline/${encodeURIComponent(trimmed)})`;
    });
    return markdown.render(withEmbeds);
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

  buildJournalPreview(raw, { searchTerm = '' } = {}) {
    const withoutEmbeds = String(raw || '').replace(/!\[\[[^\]]+\]\]/g, '');
    const normalizedLines = withoutEmbeds
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[#>*_`\-]+/g, ' ').trimEnd())
      .filter((line, index, array) => line || array[index - 1] || array[index + 1])
      .map((line) => line.trim());

    while (normalizedLines.length && !normalizedLines[0]) normalizedLines.shift();
    while (normalizedLines.length && !normalizedLines[normalizedLines.length - 1]) normalizedLines.pop();

    let previewLines = normalizedLines.slice(0, 3);
    if (searchTerm) {
      const term = String(searchTerm).toLowerCase();
      const matchIndex = normalizedLines.findIndex((line) => line.toLowerCase().includes(term));
      if (matchIndex >= 0) {
        const start = Math.max(0, matchIndex - 1);
        previewLines = normalizedLines.slice(start, start + 3);
        const firstMatchLineIndex = previewLines.findIndex((line) => line.toLowerCase().includes(term));
        if (firstMatchLineIndex >= 0) {
          const sourceLine = previewLines[firstMatchLineIndex];
          const lower = sourceLine.toLowerCase();
          const pos = lower.indexOf(term);
          if (pos > 84) {
            const sliceStart = Math.max(0, pos - 56);
            const sliceEnd = Math.min(sourceLine.length, pos + term.length + 80);
            previewLines[firstMatchLineIndex] = `…${sourceLine.slice(sliceStart, sliceEnd).trim()}${sliceEnd < sourceLine.length ? '…' : ''}`;
          }
        }
      }
    }

    const previewCharLimit = 300;
    const longestLineLength = normalizedLines.reduce((max, line) => Math.max(max, line.length), 0);
    const totalPreviewChars = normalizedLines.join('\n').trim().length;
    const isTruncated =
      normalizedLines.length > 3
      || totalPreviewChars > previewCharLimit
      || longestLineLength > previewCharLimit;

    return {
      text: previewLines.join('\n').trim(),
      lines: previewLines,
      isTruncated
    };
  }

  getBootstrap() {
    const todayIsoDate = dateToIsoLocal(new Date());
    const totalEntries = this.state.years.reduce((sum, year) => sum + (year.journalCount || 0), 0);
    const totalMedia = this.state.years.reduce((sum, year) => sum + (year.photoCount || 0), 0);
    const totalWords = this.state.dayKeys.reduce((sum, isoDate) => {
      const day = this.state.days.get(isoDate);
      return sum + (day?.journal?.wordCount || 0);
    }, 0);
    return {
      generatedAt: this.state.generatedAt,
      totalDays: this.state.dayKeys.length,
      totalEntries,
      totalWords,
      totalMedia,
      firstDate: this.state.dayKeys[0] || null,
      lastDate: this.state.dayKeys[this.state.dayKeys.length - 1] || null,
      today: this.serializeHomeDay(todayIsoDate),
      years: [...this.state.years].sort((a, b) => b.year - a.year).map((entry) => ({
        ...entry,
        coverUrls: entry.coverPhotoIds.map((id) => this.thumbUrlForPhotoId(id))
      })),
      monthsByYear: [...this.state.monthsByYear]
        .sort((a, b) => b.year - a.year)
        .map((yearEntry) => ({
          year: yearEntry.year,
          months: [...yearEntry.months]
            .sort((a, b) => b.key.localeCompare(a.key))
            .map((month) => ({
              ...month,
              coverUrls: month.coverPhotoIds.map((id) => this.thumbUrlForPhotoId(id))
            }))
        })),
      railDates: [...this.state.railDates].reverse(),
      chunkSize: this.config.indexing.chunkSize
    };
  }

  serializeHomeDay(isoDate) {
    const day = this.state.days.get(isoDate);
    return {
      isoDate,
      dateLabel: longDateLabel(isoDate),
      hasTimelineItem: Boolean(day),
      hasJournal: Boolean(day?.journal),
      wordCount: day?.journal?.wordCount || 0,
      photoCount: day?.photos?.length || 0,
      photos: day ? this.serializeDay(isoDate).photos : [],
      previewText: day?.journal?.previewText || '',
      previewLines: Array.isArray(day?.journal?.previewLines) ? [...day.journal.previewLines] : [],
      isPreviewTruncated: Boolean(day?.journal?.isPreviewTruncated)
    };
  }


  getYear(year) {
    const target = Number(year);
    const entry = (this.state.monthsByYear || []).find((item) => Number(item.year) === target);
    if (!entry) return null;
    return {
      year: target,
      months: [...entry.months]
        .sort((a, b) => b.key.localeCompare(a.key))
        .map((month) => ({
          ...month,
          coverUrls: month.coverPhotoIds.map((id) => this.thumbUrlForPhotoId(id))
        }))
    };
  }

  getMonth(monthKey) {
    const month = (this.state.monthsByYear || [])
      .flatMap((entry) => entry.months || [])
      .find((item) => item.key === monthKey);
    if (!month) return null;

    const days = this.state.dayKeys
      .filter((isoDate) => isoDate.startsWith(`${monthKey}-`))
      .slice()
      .sort((a, b) => b.localeCompare(a))
      .map((isoDate) => {
        const day = this.state.days.get(isoDate);
        return {
          isoDate,
          dateLabel: day.dateLabel,
          shortLabel: shortDateLabel(isoDate),
          photoCount: day.photos.length,
          hasJournal: Boolean(day.journal),
          wordCount: day.journal?.wordCount || 0,
          previewThumbs: day.photos
            .slice()
            .sort((a, b) => String(b.modifiedAt || b.capturedAt || '').localeCompare(String(a.modifiedAt || a.capturedAt || '')) || a.filePath.localeCompare(b.filePath))
            .slice(0, 4)
            .map((photo) => ({
              id: photo.id,
              type: photo.type,
              thumbUrl: this.thumbUrlForPhoto(photo),
              previewUrl: this.previewUrlForPhoto(photo)
            }))
        };
      });

    return {
      key: month.key,
      year: month.year,
      label: month.label,
      firstDate: month.firstDate,
      photoCount: month.photoCount,
      journalCount: month.journalCount,
      days
    };
  }

  getGalleryIndex() {
    const days = this.state.dayKeys
      .map((isoDate) => this.state.days.get(isoDate))
      .filter((day) => day?.photos?.length)
      .sort((a, b) => b.isoDate.localeCompare(a.isoDate))
      .map((day) => ({
        isoDate: day.isoDate,
        dateLabel: day.dateLabel,
        monthKey: day.monthKey,
        monthLabel: day.monthLabel,
        photoCount: day.photos.length,
        hasJournal: Boolean(day.journal),
        wordCount: day.journal?.wordCount || 0
      }));
    return { total: days.length, days };
  }

  getFolderBrowse(rootId, relativePath = '') {
    const targetRootId = String(rootId || '0');
    const rootPath = this.config.paths.photoFolders?.[Number(targetRootId)];
    if (!rootPath) return null;

    const normalizedPath = String(relativePath || '')
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '');
    const targetPath = normalizedPath || '.';
    const childFolders = new Map();
    const media = [];

    for (const photo of this.state.photosById.values()) {
      if (String(photo.folderRootId || '') !== targetRootId) continue;
      const folderPath = String(photo.folder || '.');
      const comparableFolder = folderPath === '.' ? '' : folderPath;

      if (comparableFolder === normalizedPath) {
        media.push(this.serializePhoto(photo));
        continue;
      }

      const prefix = normalizedPath ? `${normalizedPath}/` : '';
      if (!comparableFolder.startsWith(prefix)) continue;
      const remainder = comparableFolder.slice(prefix.length);
      const [childName] = remainder.split('/').filter(Boolean);
      if (!childName) continue;
      const childRelativePath = [normalizedPath, childName].filter(Boolean).join('/');
      if (!childFolders.has(childRelativePath)) {
        childFolders.set(childRelativePath, {
          label: childName,
          relativePath: childRelativePath,
          displayPath: childRelativePath || '.',
          mediaCount: 0,
          latestModifiedMs: 0,
          cover: null
        });
      }
      const bucket = childFolders.get(childRelativePath);
      bucket.mediaCount += 1;
      const modifiedMs = Number(photo.modifiedAtMs || photo.createdAtMs || 0);
      bucket.latestModifiedMs = Math.max(bucket.latestModifiedMs, modifiedMs);
      if (!bucket.cover || String(photo.capturedAt || '') > String(bucket.cover.capturedAt || '')) {
        bucket.cover = this.serializePhoto(photo);
      }
    }

    media.sort((a, b) => String(b.modifiedAt || b.capturedAt || '').localeCompare(String(a.modifiedAt || a.capturedAt || '')) || String(a.fileName || '').localeCompare(String(b.fileName || '')));
    const folders = [...childFolders.values()]
      .sort((a, b) => (b.latestModifiedMs || 0) - (a.latestModifiedMs || 0) || a.label.localeCompare(b.label));

    const parts = normalizedPath ? normalizedPath.split('/').filter(Boolean) : [];
    const breadcrumbs = [{ label: path.basename(rootPath) || rootPath, relativePath: '' }];
    let currentPath = '';
    for (const part of parts) {
      currentPath = [currentPath, part].filter(Boolean).join('/');
      breadcrumbs.push({ label: part, relativePath: currentPath });
    }

    return {
      rootId: targetRootId,
      rootLabel: path.basename(rootPath) || rootPath,
      relativePath: targetPath,
      breadcrumbs,
      folders,
      media
    };
  }

  getDateIndex(isoDate) {
    return this.state.dayIndexByDate[isoDate] ?? -1;
  }

  getTimelineChunk({ anchorDate, startIndex, limit }) {
    const total = this.state.dayKeys.length;
    if (!total) {
      return { total, startIndex: 0, endIndex: -1, hasOlder: false, hasNewer: false, days: [] };
    }

    let start = Number.isInteger(startIndex) ? startIndex : null;
    const safeLimit = Math.max(1, Number(limit || this.config.indexing.chunkSize));
    if (start === null || Number.isNaN(start)) {
      const anchorIndex = anchorDate ? this.getDateIndex(anchorDate) : total - 1;
      const safeAnchor = anchorIndex >= 0 ? anchorIndex : total - 1;
      const half = Math.floor(safeLimit / 2);
      start = Math.max(0, safeAnchor - half);
    }

    const end = Math.min(total, start + safeLimit);
    const slice = this.state.dayKeys.slice(start, end);

    return {
      total,
      startIndex: start,
      endIndex: end - 1,
      hasOlder: start > 0,
      hasNewer: end < total,
      days: slice.map((isoDate) => this.serializeDay(isoDate))
    };
  }

  getGalleryChunk({ startIndex, limit }) {
    const mediaDayKeys = this.state.dayKeys.filter((isoDate) => {
      const day = this.state.days.get(isoDate);
      return Boolean(day?.photos?.length);
    });
    const total = mediaDayKeys.length;
    if (!total) {
      return { total, startIndex: 0, endIndex: -1, hasOlder: false, hasNewer: false, days: [] };
    }

    const safeStart = Math.max(0, Math.min(total - 1, Number(startIndex || 0)));
    const safeLimit = Math.max(1, Number(limit || this.config.indexing.chunkSize));
    const endExclusive = Math.min(total, safeStart + safeLimit);
    const days = [];
    for (let offset = safeStart; offset < endExclusive; offset += 1) {
      const isoDate = mediaDayKeys[total - 1 - offset];
      days.push(this.serializeDay(isoDate));
    }

    return {
      total,
      startIndex: safeStart,
      endIndex: endExclusive - 1,
      hasOlder: endExclusive < total,
      hasNewer: safeStart > 0,
      days
    };
  }

  search(query) {
    const rawQuery = String(query || '').trim();
    const term = rawQuery.toLowerCase();
    if (!term) return { query: '', total: 0, days: [], folders: [] };

    const matches = [];
    const folderCounts = new Map();
    for (let index = this.state.dayKeys.length - 1; index >= 0; index -= 1) {
      const isoDate = this.state.dayKeys[index];
      const day = this.state.days.get(isoDate);
      if (!day) continue;
      const journalMatchCount = this.countSearchOccurrences(day.journalSearchText || '', term);
      const journalMatch = journalMatchCount > 0;
      const matchedMedia = (day.photos || [])
        .filter((photo) => String(photo.description || '').toLowerCase().includes(term))
        .sort((a, b) => String(b.modifiedAt || b.capturedAt || '').localeCompare(String(a.modifiedAt || a.capturedAt || '')) || a.filePath.localeCompare(b.filePath))
        .map((photo) => {
          const serialized = this.serializePhoto(photo);
          serialized.searchMatch = true;
          serialized.searchMatchCount = this.countSearchOccurrences(serialized.description || '', term);
          const folderKey = `${serialized.folderRootId || ''}::${serialized.folder || '.'}`;
          if (!folderCounts.has(folderKey)) {
            folderCounts.set(folderKey, {
              key: folderKey,
              rootId: serialized.folderRootId || '',
              rootLabel: serialized.folderRootLabel || '',
              folder: serialized.folder || '.',
              label: `${serialized.folderRootLabel || ''}${serialized.folder && serialized.folder !== '.' ? ` / ${serialized.folder}` : ''}`.trim() || '(root)',
              count: 0
            });
          }
          folderCounts.get(folderKey).count += 1;
          return serialized;
        });
      if (journalMatch || matchedMedia.length) {
        matches.push(this.serializeDay(isoDate, {
          searchTerm: rawQuery,
          journalMatch,
          journalMatchCount,
          matchedMedia
        }));
      }
      if (matches.length >= 200) break;
    }

    return {
      query: rawQuery,
      total: matches.length,
      days: matches,
      folders: [...folderCounts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    };
  }

  countSearchOccurrences(text, term) {
    const haystack = String(text || '').toLowerCase();
    const needle = String(term || '').toLowerCase().trim();
    if (!needle) return 0;
    let count = 0;
    let start = 0;
    while (start < haystack.length) {
      const index = haystack.indexOf(needle, start);
      if (index < 0) break;
      count += 1;
      start = index + needle.length;
    }
    return count;
  }

  serializePhoto(photo) {
    const physicalRootLabel = photo.folderRootLabel || '';
    const location = {
      id: `local:${photo.id}`,
      deviceId: this.localDevice.id,
      deviceName: this.localDevice.name,
      deviceType: this.localDevice.type,
      localMediaId: photo.id,
      fileName: photo.fileName || '',
      storageRootId: photo.folderRootId || '',
      storageRootLabel: physicalRootLabel,
      relativePath: photo.relativePath || photo.fileName || '',
      size: Number(photo.size || 0),
      availability: photo.originalAvailable === false ? 'missing' : 'available'
    };
    const locations = [
      location,
      ...(Array.isArray(photo.locations) ? photo.locations : [])
    ].filter((entry, index, entries) => {
      const key = `${entry.deviceId || ''}:${entry.localMediaId || entry.id || ''}`;
      return entries.findIndex((candidate) => `${candidate.deviceId || ''}:${candidate.localMediaId || candidate.id || ''}` === key) === index;
    });
    const availableLocations = locations.filter((entry) => entry.availability === 'available');
    const transfers = Array.isArray(photo.transfers) ? photo.transfers : [];
    const cloudBackupStatus = photo.backupStatus || {};
    const backupStatus = {
      ...cloudBackupStatus,
      cloudBackedUp: Boolean(cloudBackupStatus.cloudBackedUp || photo.cloudOriginal?.inCloud || photo.availabilitySummary?.originalInCloud),
      desktopBackupDeviceIds: [...new Set((Array.isArray(cloudBackupStatus.desktopBackupDeviceIds)
        ? cloudBackupStatus.desktopBackupDeviceIds
        : availableLocations
        .filter((entry) => entry.deviceType === 'desktop' && entry.deviceId && entry.deviceId !== this.localDevice.id)
        .map((entry) => entry.deviceId))
        .filter((deviceId) => deviceId !== this.localDevice.id))],
      syncingDestinations: Array.isArray(cloudBackupStatus.syncingDestinations) ? cloudBackupStatus.syncingDestinations : transfers.filter((entry) => ['queued', 'running', 'staging'].includes(entry.status)),
      failedDestinations: Array.isArray(cloudBackupStatus.failedDestinations) ? cloudBackupStatus.failedDestinations : transfers.filter((entry) => ['failed', 'permission-required'].includes(entry.status)),
      currentDeviceHasOriginal: location.availability === 'available',
      currentDeviceId: this.localDevice.id,
      currentDeviceType: this.localDevice.type,
      availableRemoteDeviceTypes: [...new Set(availableLocations
        .filter((entry) => entry.deviceId !== this.localDevice.id)
        .map((entry) => entry.deviceType)
        .filter(Boolean))],
      hasUsableOriginalRoute: Boolean(cloudBackupStatus.hasUsableOriginalRoute || photo.cloudOriginal?.inCloud || photo.availabilitySummary?.originalInCloud || availableLocations.length)
    };
    return {
      id: photo.id,
      type: photo.type,
      fileName: photo.fileName,
      baseName: photo.baseName,
      thumbUrl: this.thumbUrlForPhoto(photo),
      previewUrl: this.previewUrlForPhoto(photo),
      displayUrl: this.displayUrlForPhoto(photo),
      downloadUrl: this.downloadUrlForPhoto(photo),
      fullUrl: `/media/full/${photo.id}`,
      availability: photo.availability || MEDIA_AVAILABILITY.AVAILABLE,
      originalAvailable: photo.originalAvailable !== false,
      unavailableSince: photo.unavailableSince || '',
      isoDate: photo.isoDate,
      dateLabel: longDateLabel(photo.isoDate),
      capturedAt: photo.capturedAt,
      dateSource: photo.dateSource,
      size: photo.size,
      ext: photo.ext,
      width: photo.width || 0,
      height: photo.height || 0,
      folder: photo.folder || '.',
      folderRootLabel: this.localDevice.name,
      folderRootId: photo.folderRootId || '',
      relativePath: photo.relativePath || photo.fileName,
      locations,
      transfers,
      backupStatus,
      availabilitySummary: photo.availabilitySummary || {
        localCopies: locations.filter((entry) => entry.availability === 'available').length
      },
      tags: Array.isArray(photo.tags) ? photo.tags : [],
      description: typeof photo.description === 'string' ? photo.description : '',
      liked: Boolean(photo.liked)
    };
  }

  serializeDay(isoDate, { searchTerm = '', journalMatch = false, journalMatchCount = 0, matchedMedia = null } = {}) {
    const day = this.state.days.get(isoDate);
    const preview = day.journal ? this.buildJournalPreview(day.journal.raw, { searchTerm }) : null;
    const orderedPhotos = day.photos
      .slice()
      .sort((a, b) => String(b.modifiedAt || b.capturedAt || '').localeCompare(String(a.modifiedAt || a.capturedAt || '')) || a.filePath.localeCompare(b.filePath))
      .map((photo) => this.serializePhoto(photo));
    const matched = Array.isArray(matchedMedia) ? matchedMedia : [];
    return {
      isoDate: day.isoDate,
      dateLabel: day.dateLabel,
      monthKey: day.monthKey,
      monthLabel: day.monthLabel,
      photoCount: day.photos.length,
      photos: orderedPhotos,
      journalMatch: Boolean(journalMatch),
      journalMatchCount,
      matchedMediaCount: matched.length,
      matchedMedia: matched,
      matchCount: journalMatchCount + matched.reduce((sum, item) => sum + Math.max(1, Number(item.searchMatchCount || 0)), 0),
      journal: day.journal
        ? {
            title: day.journal.title,
            previewText: preview?.text || day.journal.previewText,
            previewLines: preview?.lines || day.journal.previewLines,
            isPreviewTruncated: day.journal.isPreviewTruncated,
            fullHtml: day.journal.fullHtml,
            wordCount: day.journal.wordCount || 0
          }
        : null
    };
  }



  journalFolderPath() {
    return path.join(this.config.paths.journalVault, this.config.paths.journalFolderName);
  }

  getJournalFilePath(isoDate) {
    const fileName = formatJournalFilename(isoDate);
    if (!fileName) return null;
    return path.join(this.journalFolderPath(), fileName);
  }

  createJournalRecord(filePath, raw, journalImages = this.state.journalImages || {}) {
    const fullHtml = this.renderJournalHtml(raw, journalImages);
    const preview = this.buildJournalPreview(raw);
    return {
      filePath,
      title: path.basename(filePath, '.md'),
      raw,
      previewText: preview.text,
      previewLines: preview.lines,
      isPreviewTruncated: preview.isTruncated,
      fullHtml,
      wordCount: this.countWords(raw)
    };
  }

  recomputeDerivedState() {
    const dayKeys = Array.from(this.state.days.keys()).sort();
    const yearsMap = new Map();
    const monthsMap = new Map();
    const railDates = [];
    const dayIndexByDate = {};

    dayKeys.forEach((isoDate, index) => {
      dayIndexByDate[isoDate] = index;
      const day = this.state.days.get(isoDate);
      day.isoDate = isoDate;
      day.dateLabel = longDateLabel(isoDate);
      day.monthKey = isoDate.slice(0, 7);
      day.monthLabel = monthLabelFromIso(isoDate);
      if (day.journal) {
        day.journal.wordCount = Number.isFinite(day.journal.wordCount)
          ? day.journal.wordCount
          : this.countWords(day.journal.raw);
      }
      day.photos = (day.photos || []).slice().sort((a, b) => String(a.modifiedAt || a.capturedAt || '').localeCompare(String(b.modifiedAt || b.capturedAt || '')) || a.filePath.localeCompare(b.filePath));
      day.photoIds = day.photos.map((photo) => photo.id);
      day.journalSearchText = [
        day.dateLabel,
        shortDateLabel(isoDate),
        day.journal?.title || '',
        day.journal?.raw || ''
      ].join('\n').toLowerCase();
      day.searchText = [
        day.journalSearchText,
        ...day.photos.map((photo) => String(photo.description || ''))
      ].join('\n').toLowerCase();
      const year = Number(isoDate.slice(0, 4));
      const monthKey = slugMonth(new Date(`${isoDate}T12:00:00Z`));

      if (!yearsMap.has(year)) {
        yearsMap.set(year, {
          year,
          firstDate: isoDate,
          journalCount: 0,
          photoCount: 0,
          coverPhotoIds: []
        });
      }
      if (!monthsMap.has(monthKey)) {
        monthsMap.set(monthKey, {
          key: monthKey,
          year,
          monthIndex: Number(isoDate.slice(5, 7)) - 1,
          label: monthLabelFromIso(isoDate),
          firstDate: isoDate,
          journalCount: 0,
          photoCount: 0,
          coverPhotoIds: []
        });
      }

      const yearBucket = yearsMap.get(year);
      const monthBucket = monthsMap.get(monthKey);
      if (day.journal) {
        yearBucket.journalCount += 1;
        monthBucket.journalCount += 1;
      }
      yearBucket.photoCount += day.photos.length;
      monthBucket.photoCount += day.photos.length;

      for (const photo of day.photos) {
        if (yearBucket.coverPhotoIds.length < 4) yearBucket.coverPhotoIds.push(photo.id);
        if (monthBucket.coverPhotoIds.length < 4) monthBucket.coverPhotoIds.push(photo.id);
      }

      railDates.push({
        index,
        isoDate,
        label: shortDateLabel(isoDate),
        longLabel: longDateLabel(isoDate),
        hasJournal: Boolean(day.journal),
        photoCount: day.photos.length
      });
    });

    const years = Array.from(yearsMap.values()).sort((a, b) => a.year - b.year);
    const monthsByYear = years.map((yearEntry) => ({
      year: yearEntry.year,
      months: Array.from(monthsMap.values())
        .filter((entry) => entry.year === yearEntry.year)
        .sort((a, b) => a.key.localeCompare(b.key))
    }));

    this.state.dayKeys = dayKeys;
    this.state.railDates = railDates;
    this.state.years = years;
    this.state.monthsByYear = monthsByYear;
    this.state.dayIndexByDate = dayIndexByDate;
  }

  async persistState() {
    this.state.generatedAt = new Date().toISOString();
    await writeJson(this.indexCachePath, this.serializeState(this.state));
  }

  async getEntry(isoDate, { createIfMissing = false } = {}) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) return null;
    const filePath = this.getJournalFilePath(isoDate);
    if (!filePath) return null;

    const exists = fs.existsSync(filePath);
    const raw = exists ? await fs.promises.readFile(filePath, 'utf8') : '';
    const day = this.state.days.get(isoDate);
    const serializedDay = day ? this.serializeDay(isoDate) : null;
    const fallbackJournal = exists && raw.trim() ? this.createJournalRecord(filePath, raw) : null;
    return {
      isoDate,
      exists,
      createIfMissing,
      filePath,
      title: path.basename(filePath, '.md'),
      raw,
      dateLabel: longDateLabel(isoDate),
      monthKey: isoDate.slice(0, 7),
      monthLabel: monthLabelFromIso(isoDate),
      photos: serializedDay?.photos || [],
      photoCount: day?.photos?.length || 0,
      hasJournal: Boolean(day?.journal || fallbackJournal),
      journal: serializedDay?.journal || fallbackJournal,
      wordCount: day?.journal?.wordCount || fallbackJournal?.wordCount || this.countWords(raw)
    };
  }

  async saveEntry(isoDate, raw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) {
      throw new Error('Invalid entry date.');
    }

    const filePath = this.getJournalFilePath(isoDate);
    if (!filePath) throw new Error('Invalid entry date.');
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

    const text = String(raw ?? '');
    const trimmed = text.trim();

    if (!trimmed) {
      await fs.promises.rm(filePath, { force: true }).catch(() => {});
      const day = this.state.days.get(isoDate);
      if (day) {
        day.journal = null;
        if (!day.photos.length) this.state.days.delete(isoDate);
      }
      this.recomputeDerivedState();
      await this.persistState();
      return this.state.days.has(isoDate) ? this.serializeDay(isoDate) : null;
    }

    const tempPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await fs.promises.writeFile(tempPath, text, 'utf8');
    await fs.promises.rename(tempPath, filePath);

    const day = this.getOrCreateDay(this.state.days, isoDate);
    day.journal = this.createJournalRecord(filePath, text);
    this.recomputeDerivedState();
    await this.persistState();

    return this.serializeDay(isoDate);
  }


  async migrateLegacyPortableMetadata({ mediaTags = {}, mediaDescriptions = {}, mediaLikes = {}, mediaDateOverrides = {}, portableMetadata = {} }) {
    const pendingByRoot = new Map();

    const addPending = (filePath, patch) => {
      const rootInfo = this.portableMediaStore.getRootInfo(filePath);
      if (!rootInfo) return;
      if (!pendingByRoot.has(rootInfo.rootPath)) pendingByRoot.set(rootInfo.rootPath, {});
      const bucket = pendingByRoot.get(rootInfo.rootPath);
      bucket[rootInfo.relativePath] = {
        ...(bucket[rootInfo.relativePath] || portableMetadata[rootInfo.rootPath]?.entries?.[rootInfo.relativePath] || {}),
        ...patch
      };
    };

    Object.entries(mediaTags || {}).forEach(([filePath, tags]) => {
      const current = this.portableMediaStore.getEntry(portableMetadata, filePath);
      if (!current?.tags?.length && Array.isArray(tags) && tags.length) addPending(filePath, { tags });
    });
    Object.entries(mediaDescriptions || {}).forEach(([filePath, description]) => {
      const current = this.portableMediaStore.getEntry(portableMetadata, filePath);
      if (!current?.description && typeof description === 'string' && description.trim()) addPending(filePath, { description });
    });
    Object.entries(mediaLikes || {}).forEach(([filePath, liked]) => {
      const current = this.portableMediaStore.getEntry(portableMetadata, filePath);
      if (!current?.liked && liked) addPending(filePath, { liked: true });
    });
    Object.entries(mediaDateOverrides || {}).forEach(([filePath, value]) => {
      const current = this.portableMediaStore.getEntry(portableMetadata, filePath);
      const normalized = this.normalizeMediaDateOverride(value);
      if (!current?.dateOverride && normalized) addPending(filePath, { dateOverride: normalized });
    });

    for (const [rootPath, entries] of pendingByRoot.entries()) {
      const store = portableMetadata[rootPath] || await this.portableMediaStore.loadRoot(rootPath);
      for (const [relativePath, patch] of Object.entries(entries)) {
        store.entries[relativePath] = {
          ...(store.entries[relativePath] || {}),
          ...patch
        };
      }
      portableMetadata[rootPath] = store;
      await this.portableMediaStore.saveRoot(rootPath, store);
    }
  }

  async persistDerivedCaches() {
    await Promise.all([
      writeJson(this.mediaTagsCachePath, this.state.mediaTags || {}),
      writeJson(this.mediaDescriptionsCachePath, this.state.mediaDescriptions || {}),
      writeJson(this.mediaLikesCachePath, this.state.mediaLikes || {}),
      writeJson(this.mediaDateOverridesCachePath, this.state.mediaDateOverrides || {})
    ]);
  }

  async updatePortableMetadata(filePath, patch) {
    await this.portableMediaStore.updateEntry(filePath, (current) => ({ ...current, ...patch }));
  }

  updateInMemoryPhoto(photoId, patch) {
    const photo = this.getPhoto(photoId);
    if (!photo) return null;
    Object.assign(photo, patch);
    const day = this.state.days.get(photo.isoDate);
    if (day) {
      for (const item of day.photos || []) {
        if (item.id === photoId) Object.assign(item, patch);
      }
    }
    return photo;
  }

  replaceInMemoryPhoto(photoId, nextPhoto) {
    const current = this.getPhoto(photoId);
    if (!current || !nextPhoto) return null;
    const currentDay = this.state.days.get(current.isoDate);
    if (currentDay?.photos?.length) {
      const index = currentDay.photos.findIndex((item) => item.id === photoId);
      if (index >= 0) currentDay.photos[index] = nextPhoto;
    }
    this.state.photosById.delete(photoId);
    this.state.photosById.set(nextPhoto.id, nextPhoto);
    return nextPhoto;
  }

  async remapDerivedFilePath(oldFilePath, newFilePath) {
    const remap = (collection, removeWhenFalsy = false) => {
      if (!collection || !Object.prototype.hasOwnProperty.call(collection, oldFilePath)) return;
      const value = collection[oldFilePath];
      delete collection[oldFilePath];
      if (removeWhenFalsy && !value) return;
      collection[newFilePath] = value;
    };

    remap(this.state.mediaTags);
    remap(this.state.mediaDescriptions);
    remap(this.state.mediaLikes, true);
    remap(this.state.mediaDateOverrides);
    await this.persistDerivedCaches();
  }

  async moveFileOnDisk(sourcePath, destinationPath) {
    try {
      await fs.promises.rename(sourcePath, destinationPath);
    } catch (error) {
      if (error?.code !== 'EXDEV') throw error;
      await fs.promises.copyFile(sourcePath, destinationPath);
      await fs.promises.rm(sourcePath, { force: true });
    }
  }

  async setPhotoTags(photoId, tags) {
    const photo = this.getPhoto(photoId);
    if (!photo) return null;
    const nextTags = Array.from(new Set((Array.isArray(tags) ? tags : [])
      .map((tag) => String(tag || '').trim())
      .filter(Boolean))).slice(0, 40);
    this.state.mediaTags = this.state.mediaTags || {};
    this.state.mediaTags[photo.filePath] = nextTags;
    this.updateInMemoryPhoto(photoId, { tags: nextTags });
    await this.updatePortableMetadata(photo.filePath, { tags: nextTags });
    await writeJson(this.mediaTagsCachePath, this.state.mediaTags);
    await this.persistState();
    return { ...photo, tags: nextTags };
  }

  async setPhotoDescription(photoId, description) {
    const photo = this.getPhoto(photoId);
    if (!photo) return null;
    const nextDescription = String(description || '').replace(/\r\n/g, '\n').trim().slice(0, 4000);

    this.state.mediaDescriptions = this.state.mediaDescriptions || {};
    this.state.mediaDescriptions[photo.filePath] = nextDescription;
    this.updateInMemoryPhoto(photoId, { description: nextDescription });
    await this.updatePortableMetadata(photo.filePath, { description: nextDescription });
    await writeJson(this.mediaDescriptionsCachePath, this.state.mediaDescriptions);
    await this.persistState();
    return { ...photo, description: nextDescription };
  }

  async setPhotoLiked(photoId, liked) {
    const photo = this.getPhoto(photoId);
    if (!photo) return null;
    const nextLiked = Boolean(liked);

    this.state.mediaLikes = this.state.mediaLikes || {};
    if (nextLiked) this.state.mediaLikes[photo.filePath] = true;
    else delete this.state.mediaLikes[photo.filePath];

    this.updateInMemoryPhoto(photoId, { liked: nextLiked });
    await this.updatePortableMetadata(photo.filePath, { liked: nextLiked });
    await writeJson(this.mediaLikesCachePath, this.state.mediaLikes);
    await this.persistState();
    return { ...photo, liked: nextLiked };
  }

  normalizeMediaDateOverride(value) {
    if (!value) return null;
    if (typeof value === 'string') {
      return /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? { isoDate: value, capturedAt: `${value}T12:00:00.000Z`, source: 'manual' }
        : null;
    }
    if (typeof value !== 'object') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value.isoDate || ''))) return null;
    const timeFragment = typeof value.capturedAt === 'string' && value.capturedAt.includes('T')
      ? value.capturedAt.slice(10)
      : 'T12:00:00.000Z';
    return {
      isoDate: value.isoDate,
      capturedAt: `${value.isoDate}${timeFragment.startsWith('T') ? timeFragment : 'T12:00:00.000Z'}`,
      source: value.source || 'manual'
    };
  }

  buildCapturedAt(isoDate, timeValue, fallbackCapturedAt = '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) throw new Error('Invalid date.');
    const normalizedTime = /^\d{2}:\d{2}$/.test(String(timeValue || ''))
      ? `${timeValue}:00`
      : (typeof fallbackCapturedAt === 'string' && /T\d{2}:\d{2}:\d{2}/.test(fallbackCapturedAt)
          ? fallbackCapturedAt.slice(11, 19)
          : '12:00:00');
    return `${isoDate}T${normalizedTime}.000Z`;
  }

  prunePhotoMetaCache(metaCache, filePath, { size, mtimeMs } = {}) {
    if (!metaCache || typeof metaCache !== 'object') return;
    if (filePath && Number.isFinite(size) && Number.isFinite(mtimeMs)) {
      delete metaCache[hash(`${filePath}|${size}|${mtimeMs}`)];
    }
  }

  removePhotoFromState(photoId, { removeMetadata = false } = {}) {
    const photo = this.getPhoto(photoId);
    if (!photo) return null;

    const day = this.state.days.get(photo.isoDate);
    if (day) {
      day.photos = (day.photos || []).filter((item) => item.id !== photoId);
      if (!day.photos.length && !day.journal) this.state.days.delete(photo.isoDate);
    }
    this.state.photosById.delete(photoId);

    if (removeMetadata) {
      delete this.state.mediaTags?.[photo.filePath];
      delete this.state.mediaDescriptions?.[photo.filePath];
      delete this.state.mediaLikes?.[photo.filePath];
      delete this.state.mediaDateOverrides?.[photo.filePath];
    }

    return photo;
  }

  insertPhotoIntoState(photo) {
    if (!photo) return null;
    const existing = this.state.photosById.get(photo.id);
    if (existing) this.removePhotoFromState(existing.id, { removeMetadata: false });
    this.state.photosById.set(photo.id, photo);
    this.getOrCreateDay(this.state.days, photo.isoDate).photos.push(photo);
    return photo;
  }

  async addMediaFiles(filePaths, { persist = true } = {}) {
    const uniquePaths = Array.from(new Set((Array.isArray(filePaths) ? filePaths : []).filter(Boolean)));
    if (!uniquePaths.length) return [];

    const mediaMetaCache = await readJson(this.mediaMetaCachePath, {});
    const nextMediaMetaCache = { ...mediaMetaCache };
    const portableMetadata = await this.portableMediaStore.loadAll();
    const added = [];
    const inventoryEntries = { ...(this.mediaInventory || {}) };

    for (const filePath of uniquePaths) {
      try {
        const stat = await fs.promises.stat(filePath);
        inventoryEntries[filePath] = `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
        const record = await this.buildPhotoRecord({
          filePath,
          stat,
          signature: hash(`${filePath}|${stat.size}|${stat.mtimeMs}`),
          mediaMetaCache,
          nextMediaMetaCache,
          mediaTags: this.state.mediaTags || {},
          mediaDescriptions: this.state.mediaDescriptions || {},
          mediaLikes: this.state.mediaLikes || {},
          mediaDateOverrides: this.state.mediaDateOverrides || {},
          portableMetadata
        });
        if (!record) continue;
        this.insertPhotoIntoState(record);
        added.push(record);
      } catch (error) {
        // Ignore files that cannot be read during incremental refresh.
      }
    }

    await writeJson(this.mediaMetaCachePath, nextMediaMetaCache);
    if (persist) {
      this.recomputeDerivedState();
      await this.persistState();
      await this.persistMediaInventory({
        entries: inventoryEntries,
        signature: this.computeInventorySignature(inventoryEntries)
      });
      this.notifyIndexChanged('media-added', added);
    }
    return added.map((photo) => ({ ...photo }));
  }

  async removeMediaFile(photoId, { persist = true, removeMetadata = true } = {}) {
    const removed = this.removePhotoFromState(photoId, { removeMetadata });
    if (!removed) return null;

    const metaCache = await readJson(this.mediaMetaCachePath, {});
    this.prunePhotoMetaCache(metaCache, removed.filePath, removed);
    await writeJson(this.mediaMetaCachePath, metaCache);

    if (removeMetadata) {
      await this.persistDerivedCaches();
      await this.portableMediaStore.updateEntry(removed.filePath, () => ({}));
    }

    if (persist) {
      this.recomputeDerivedState();
      await this.persistState();
      const inventoryEntries = { ...(this.mediaInventory || {}) };
      delete inventoryEntries[removed.filePath];
      await this.persistMediaInventory({
        entries: inventoryEntries,
        signature: this.computeInventorySignature(inventoryEntries)
      });
    }

    return { ...removed };
  }

  async refreshFromFilesystem(reason = 'refresh') {
    if (this.isBuilding) return { changed: false, skipped: true };

    const inventory = await this.scanMediaInventory();
    const hasUnavailablePhotos = Array.from(this.state.photosById.values())
      .some((photo) => (photo.availability || MEDIA_AVAILABILITY.AVAILABLE) !== MEDIA_AVAILABILITY.AVAILABLE);
    if (inventory.signature === this.mediaInventorySignature && !hasUnavailablePhotos) {
      this.mediaRootStatus = inventory.rootStatus || {};
      return { changed: false, reason };
    }

    const previousEntries = this.mediaInventory || {};
    const nextEntries = inventory.entries || {};
    const removedPaths = Object.keys(previousEntries).filter((filePath) => !Object.prototype.hasOwnProperty.call(nextEntries, filePath));
    const changedPaths = Object.keys(nextEntries).filter((filePath) => previousEntries[filePath] !== nextEntries[filePath]);
    const recoveredPaths = Object.keys(nextEntries).filter((filePath) => {
      const photo = this.getPhoto(hash(filePath));
      return photo && photo.availability !== MEDIA_AVAILABILITY.AVAILABLE;
    });
    const reindexPaths = Array.from(new Set([...changedPaths, ...recoveredPaths]));
    const stalePhotos = new Map();
    const removedLocalPaths = [];
    const preservedUnavailable = [];
    const availableRoots = new Set(inventory.availableRoots || this.photoRoots);
    const unavailableRoots = new Set(inventory.unavailableRoots || []);

    for (const filePath of [...removedPaths, ...reindexPaths]) {
      const photo = this.getPhoto(hash(filePath));
      if (photo) stalePhotos.set(filePath, photo);
    }

    for (const filePath of removedPaths) {
      const photo = this.getPhoto(hash(filePath));
      if (!photo) continue;
      const rootPath = photo.rootPath || this.getPhotoRootInfo(filePath).rootPath;
      const availability = await this.classifyUnavailablePhoto(photo, rootPath, { availableRoots, unavailableRoots });
      if (availability) {
        const preserved = this.cloneUnavailablePhoto(photo, availability);
        this.removePhotoFromState(photo.id, { removeMetadata: false });
        this.insertPhotoIntoState(preserved);
        preservedUnavailable.push(filePath);
      } else {
        this.removePhotoFromState(photo.id, { removeMetadata: false });
        removedLocalPaths.push(filePath);
      }
    }

    for (const filePath of reindexPaths) {
      const photo = this.getPhoto(hash(filePath));
      if (photo) this.removePhotoFromState(photo.id, { removeMetadata: false });
    }

    const metaCache = await readJson(this.mediaMetaCachePath, {});
    [...removedLocalPaths, ...reindexPaths].forEach((filePath) => {
      const previous = stalePhotos.get(filePath);
      this.prunePhotoMetaCache(metaCache, filePath, previous || {});
    });
    await writeJson(this.mediaMetaCachePath, metaCache);

    if (reindexPaths.length) {
      await this.addMediaFiles(reindexPaths, { persist: false });
    }

    this.recomputeDerivedState();
    await this.persistState();
    const nextInventoryEntries = { ...(inventory.entries || {}) };
    for (const filePath of preservedUnavailable) {
      if (previousEntries[filePath]) nextInventoryEntries[filePath] = previousEntries[filePath];
    }
    await this.persistMediaInventory({
      ...inventory,
      entries: nextInventoryEntries,
      signature: this.computeInventorySignature(nextInventoryEntries)
    });
    this.notifyIndexChanged(reason);
    console.log(`Book of Life index refreshed (${reason}) with ${changedPaths.length} changed, ${recoveredPaths.length} recovered, ${removedLocalPaths.length} removed, and ${preservedUnavailable.length} unavailable files.`);
    return {
      changed: true,
      changedPaths: changedPaths.length,
      recoveredPaths: recoveredPaths.length,
      removedPaths: removedLocalPaths.length,
      unavailablePaths: preservedUnavailable.length
    };
  }

  async setPhotoDateTime(photoId, { isoDate, time } = {}) {
    const photo = this.getPhoto(photoId);
    if (!photo) return null;
    const nextIsoDate = String(isoDate || photo.isoDate || '').trim();
    const nextTime = String(time || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextIsoDate)) throw new Error('Invalid date.');
    if (nextTime && !/^\d{2}:\d{2}$/.test(nextTime)) throw new Error('Invalid time.');

    const nextCapturedAt = this.buildCapturedAt(nextIsoDate, nextTime, photo.capturedAt);
    this.state.mediaDateOverrides = this.state.mediaDateOverrides || {};
    let wroteToFile = false;

    try {
      if (isExifWritableImage(photo.filePath)) {
        await writeImageExifCreatedDate(photo.filePath, nextIsoDate, { capturedAt: nextCapturedAt });
        wroteToFile = true;
      } else if (isVideoMetadataWritable(photo.filePath)) {
        await writeVideoCreatedDateInPlace(photo.filePath, nextIsoDate, { capturedAt: nextCapturedAt });
        wroteToFile = true;
      }
    } catch (error) {
      wroteToFile = false;
    }

    if (wroteToFile) {
      delete this.state.mediaDateOverrides[photo.filePath];
      await this.updatePortableMetadata(photo.filePath, { dateOverride: null });
    } else {
      const override = {
        isoDate: nextIsoDate,
        capturedAt: nextCapturedAt,
        source: 'manual'
      };
      this.state.mediaDateOverrides[photo.filePath] = override;
      await this.updatePortableMetadata(photo.filePath, { dateOverride: override });
    }

    await writeJson(this.mediaDateOverridesCachePath, this.state.mediaDateOverrides);
    const nextPhoto = await this.reindexPhotoRecord(photoId);
    return nextPhoto ? { ...nextPhoto } : null;
  }

  async reindexPhotoRecord(photoId) {
    const previousPhoto = this.getPhoto(photoId);
    if (!previousPhoto) return null;

    const stat = await fs.promises.stat(previousPhoto.filePath);
    const mediaMetaCache = await readJson(this.mediaMetaCachePath, {});
    this.prunePhotoMetaCache(mediaMetaCache, previousPhoto.filePath, previousPhoto);

    const nextMediaMetaCache = { ...mediaMetaCache };
    const portableMetadata = await this.portableMediaStore.loadAll();
    const record = await this.buildPhotoRecord({
      filePath: previousPhoto.filePath,
      stat,
      signature: hash(`${previousPhoto.filePath}|${stat.size}|${stat.mtimeMs}`),
      mediaMetaCache,
      nextMediaMetaCache,
      mediaTags: this.state.mediaTags || {},
      mediaDescriptions: this.state.mediaDescriptions || {},
      mediaLikes: this.state.mediaLikes || {},
      mediaDateOverrides: this.state.mediaDateOverrides || {},
      portableMetadata
    });
    if (!record) return null;

    this.removePhotoFromState(photoId, { removeMetadata: false });
    this.insertPhotoIntoState(record);
    this.recomputeDerivedState();

    await writeJson(this.mediaMetaCachePath, nextMediaMetaCache);
    await this.persistState();

    const inventoryEntries = { ...(this.mediaInventory || {}) };
    inventoryEntries[record.filePath] = `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
    await this.persistMediaInventory({
      entries: inventoryEntries,
      signature: this.computeInventorySignature(inventoryEntries)
    });

    return record;
  }

  async setMediaDateOverridesByPath(overrides) {
    if (!overrides || typeof overrides !== 'object') return;

    this.state.mediaDateOverrides = this.state.mediaDateOverrides || {};
    let changed = false;

    for (const [filePath, value] of Object.entries(overrides)) {
      const normalized = this.normalizeMediaDateOverride(value);
      if (!normalized) continue;
      const previous = this.state.mediaDateOverrides[filePath];
      if (
        previous?.isoDate === normalized.isoDate
        && previous?.capturedAt === normalized.capturedAt
        && previous?.source === normalized.source
      ) {
        continue;
      }
      this.state.mediaDateOverrides[filePath] = normalized;
      await this.updatePortableMetadata(filePath, { dateOverride: normalized });
      changed = true;
    }

    if (changed) {
      await writeJson(this.mediaDateOverridesCachePath, this.state.mediaDateOverrides);
    }
  }

  async renamePhoto(photoId, baseName) {
    const photo = this.getPhoto(photoId);
    if (!photo) return null;
    const nextBaseName = path.basename(String(baseName || '').trim(), photo.ext);
    if (!nextBaseName) throw new Error('Filename cannot be empty.');
    const nextFileName = `${nextBaseName}${photo.ext}`;
    const nextFilePath = path.join(path.dirname(photo.filePath), nextFileName);
    if (nextFilePath === photo.filePath) return { ...photo };
    try {
      await fs.promises.access(nextFilePath);
      throw new Error('A file with that name already exists.');
    } catch (error) {
      if (error?.message === 'A file with that name already exists.') throw error;
    }

    await this.moveFileOnDisk(photo.filePath, nextFilePath);
    await this.portableMediaStore.moveEntry(photo.filePath, nextFilePath);
    await this.remapDerivedFilePath(photo.filePath, nextFilePath);
    this.removePhotoFromState(photoId, { removeMetadata: false });
    const [nextPhoto] = await this.addMediaFiles([nextFilePath]);
    return nextPhoto || null;
  }

  async movePhoto(photoId, rootId, relativePath) {
    const photo = this.getPhoto(photoId);
    if (!photo) return null;
    const targetRoot = this.photoRoots[Number(rootId)];
    if (!targetRoot) throw new Error('Invalid target root.');
    const safeRelative = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const destinationDir = path.resolve(targetRoot, safeRelative || '.');
    const relativeToRoot = path.relative(targetRoot, destinationDir);
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) throw new Error('Invalid target folder.');
    await fs.promises.mkdir(destinationDir, { recursive: true });
    const nextFilePath = path.join(destinationDir, photo.fileName);
    if (nextFilePath === photo.filePath) return { ...photo };
    try {
      await fs.promises.access(nextFilePath);
      throw new Error('A file with that name already exists in the target folder.');
    } catch (error) {
      if (error?.message === 'A file with that name already exists in the target folder.') throw error;
    }

    await this.moveFileOnDisk(photo.filePath, nextFilePath);
    await this.portableMediaStore.moveEntry(photo.filePath, nextFilePath);
    await this.remapDerivedFilePath(photo.filePath, nextFilePath);
    this.removePhotoFromState(photoId, { removeMetadata: false });
    const [nextPhoto] = await this.addMediaFiles([nextFilePath]);
    return nextPhoto || null;
  }

  getPhoto(photoId) {
    return this.state.photosById.get(photoId) || null;
  }

  getJournalImageByName(fileName) {
    return this.state.journalImages[fileName] || null;
  }

  serializeState(state) {
    return {
      generatedAt: state.generatedAt,
      journalImages: state.journalImages,
      days: Object.fromEntries(Array.from(state.days.entries())),
      dayKeys: state.dayKeys,
      railDates: state.railDates,
      years: state.years,
      monthsByYear: state.monthsByYear,
      photosById: Object.fromEntries(Array.from(state.photosById.entries())),
      dayIndexByDate: state.dayIndexByDate,
      mediaTags: state.mediaTags || {},
      mediaDescriptions: state.mediaDescriptions || {},
      mediaLikes: state.mediaLikes || {},
      mediaDateOverrides: state.mediaDateOverrides || {}
    };
  }

  inflateState(payload) {
    return {
      generatedAt: payload.generatedAt,
      journalImages: payload.journalImages || {},
      days: new Map(Object.entries(payload.days || {})),
      dayKeys: payload.dayKeys || [],
      railDates: payload.railDates || [],
      years: payload.years || [],
      monthsByYear: payload.monthsByYear || [],
      photosById: new Map(Object.entries(payload.photosById || {})),
      dayIndexByDate: payload.dayIndexByDate || {},
      mediaTags: payload.mediaTags || {},
      mediaDescriptions: payload.mediaDescriptions || {},
      mediaLikes: payload.mediaLikes || {},
      mediaDateOverrides: payload.mediaDateOverrides || {}
    };
  }
}

function formatDuration(durationMs) {
  const ms = Math.max(0, Number(durationMs) || 0);
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 10) return `${totalSeconds.toFixed(1)}s`;
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function createIdleRebuildProgress() {
  return {
    reason: '',
    running: false,
    queued: false,
    stage: 'Idle',
    current: 0,
    total: 0,
    percent: 100,
    startedAt: '',
    completedAt: '',
    error: ''
  };
}

class WebRebuildProgress {
  constructor(indexer, reason) {
    this.indexer = indexer;
    this.reason = reason;
    this.startedAt = new Date().toISOString();
    this.stage = 'Preparing library';
    this.current = 0;
    this.total = 0;
    this.done = false;
    this.publish({ running: true, percent: 0 });
  }

  publish(patch = {}) {
    const total = Math.max(0, Number(this.total) || 0);
    const current = Math.max(0, Number(this.current) || 0);
    this.indexer.rebuildProgress = {
      reason: this.reason,
      running: patch.running !== undefined ? patch.running : !this.done,
      queued: this.indexer.rebuildQueued,
      stage: this.stage,
      current,
      total,
      percent: total > 0 ? Math.round((Math.min(current, total) / total) * 100) : (this.done ? 100 : 0),
      startedAt: this.startedAt,
      completedAt: patch.completedAt || '',
      error: patch.error || ''
    };
  }

  setStage(stageLabel, total = 0) {
    this.stage = stageLabel;
    this.total = Math.max(0, Number(total) || 0);
    this.current = 0;
    this.publish();
  }

  increment(amount = 1) {
    this.current += Math.max(1, Number(amount) || 1);
    if (this.total > 0) this.current = Math.min(this.current, this.total);
    this.publish();
  }

  complete() {
    this.done = true;
    if (this.total > 0) this.current = this.total;
    this.publish({ running: false, completedAt: new Date().toISOString() });
  }

  clear() {
    if (!this.done && this.indexer.rebuildProgress?.running) {
      this.publish();
    }
  }
}

class CompositeRebuildProgress {
  constructor(renderers = []) {
    this.renderers = renderers.filter(Boolean);
  }

  setStage(stageLabel, total = 0) {
    this.renderers.forEach((renderer) => renderer.setStage(stageLabel, total));
  }

  increment(amount = 1) {
    this.renderers.forEach((renderer) => renderer.increment(amount));
  }

  complete() {
    this.renderers.forEach((renderer) => renderer.complete());
  }

  clear() {
    this.renderers.forEach((renderer) => renderer.clear());
  }
}

class StartupProgressRenderer {
  constructor(label) {
    this.label = label;
    this.activeStageLabel = '';
    this.linesRendered = 0;
    this.tasks = [];
    this.tasksByLabel = new Map();
  }

  setStage(stageLabel, total = 0) {
    if (this.activeStageLabel && this.activeStageLabel !== stageLabel) {
      this.finishTask(this.activeStageLabel);
    }

    this.activeStageLabel = stageLabel;
    let task = this.tasksByLabel.get(stageLabel);
    if (!task) {
      task = {
        stageLabel,
        total: Math.max(0, Number(total) || 0),
        current: 0,
        startedAt: Date.now(),
        completedAt: 0,
        done: false
      };
      this.tasks.push(task);
      this.tasksByLabel.set(stageLabel, task);
    } else {
      task.total = Math.max(0, Number(total) || 0);
      task.current = 0;
      task.startedAt = Date.now();
      task.completedAt = 0;
      task.done = false;
    }

    this.render();
  }

  increment(amount = 1) {
    if (!this.activeStageLabel) return;
    const task = this.tasksByLabel.get(this.activeStageLabel);
    if (!task || task.done) return;
    const next = task.current + Math.max(1, Number(amount) || 1);
    task.current = task.total > 0 ? Math.min(task.total, next) : next;
    this.render();
  }

  complete() {
    if (this.activeStageLabel) this.finishTask(this.activeStageLabel);
    this.render();
    process.stdout.write('\n');
    this.linesRendered = 0;
  }

  clear() {
    if (!this.linesRendered) return;
    if (this.linesRendered > 1) {
      process.stdout.write(`\x1b[${this.linesRendered - 1}A`);
    }
    for (let index = 0; index < this.linesRendered; index += 1) {
      process.stdout.write('\r\x1b[2K');
      if (index < this.linesRendered - 1) process.stdout.write('\x1b[1B');
    }
    if (this.linesRendered > 1) {
      process.stdout.write(`\x1b[${this.linesRendered - 1}A`);
    }
    process.stdout.write('\r');
    this.linesRendered = 0;
  }

  finishTask(stageLabel) {
    const task = this.tasksByLabel.get(stageLabel);
    if (!task || task.done) return;
    task.done = true;
    task.current = task.total > 0 ? task.total : task.current;
    task.completedAt = Date.now();
    if (this.activeStageLabel === stageLabel) this.activeStageLabel = '';
  }

  render() {
    const lines = [
      `${this.label}:`
    ];
    for (const task of this.tasks) {
      lines.push(this.renderTask(task));
    }

      if (this.linesRendered > 1) {
        process.stdout.write(`\x1b[${this.linesRendered - 1}A`);
      }

    lines.forEach((line, index) => {
      process.stdout.write(`\r\x1b[2K${line}`);
      if (index < lines.length - 1) process.stdout.write('\n');
    });

    this.linesRendered = lines.length;
  }

  renderTask(task) {
    const width = 24;
    const ratio = task.total > 0
      ? Math.max(0, Math.min(1, task.current / task.total))
      : (task.done ? 1 : 0);
    const filled = Math.round(ratio * width);
    const bar = `${'='.repeat(filled)}${'-'.repeat(width - filled)}`;
    const percent = `${String(Math.round(ratio * 100)).padStart(3, ' ')}%`;
    const detail = task.total > 0 ? `${task.current}/${task.total}` : `${task.current}`;
    const eta = task.done
      ? `done in ${formatDuration(task.completedAt - task.startedAt)}`
      : this.renderEta(task);
    return `  [${bar}] ${percent} ${task.stageLabel} ${detail} | ${eta}`;
  }

  renderEta(task) {
    if (task.current <= 0 || task.total <= 0) return 'ETA --';
    const elapsedMs = Date.now() - task.startedAt;
    if (elapsedMs < 250) return 'ETA --';
    const remainingUnits = Math.max(0, task.total - task.current);
    const msPerUnit = elapsedMs / Math.max(1, task.current);
    return `ETA ${formatDuration(Math.round(remainingUnits * msPerUnit))}`;
  }
}

module.exports = { TimelineIndexer, selectImageExifDateInfo };
