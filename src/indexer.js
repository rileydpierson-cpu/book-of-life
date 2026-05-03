const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');
const exifr = require('exifr');
const { readVideoCreatedDate } = require('./media-metadata');
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

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});

class TimelineIndexer {
  constructor(config) {
    this.config = config;
    this.cacheDir = config.paths.cacheDir;
    this.indexCachePath = path.join(this.cacheDir, 'index.json');
    this.mediaMetaCachePath = path.join(this.cacheDir, 'photo-meta.json');
    this.mediaTagsCachePath = path.join(this.cacheDir, 'media-tags.json');
    this.mediaDescriptionsCachePath = path.join(this.cacheDir, 'media-descriptions.json');
    this.mediaLikesCachePath = path.join(this.cacheDir, 'media-likes.json');
    this.mediaDateOverridesCachePath = path.join(this.cacheDir, 'media-date-overrides.json');

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
  }

  async init() {
    const cachedIndex = await readJson(this.indexCachePath, null);
    if (cachedIndex) this.state = this.inflateState(cachedIndex);
    await this.rebuild('startup');
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

  async rebuild(reason = 'manual') {
    if (this.isBuilding) {
      this.rebuildQueued = true;
      return;
    }

    this.isBuilding = true;
    try {
      const nextState = await this.buildState();
      this.state = nextState;
      await writeJson(this.indexCachePath, this.serializeState(nextState));
      console.log(`LifeServer index rebuilt (${reason}) with ${nextState.dayKeys.length} days.`);
    } finally {
      this.isBuilding = false;
      if (this.rebuildQueued) {
        this.rebuildQueued = false;
        queueMicrotask(() => this.rebuild('queued'));
      }
    }
  }

  thumbUrlForPhoto(photo) {
    if (!photo?.id) return '';
    const version = hash(`${photo.id}|${photo.mtimeMs || 0}|${photo.size || 0}|thumb-v5`);
    return `/media/thumb/${photo.id}?v=${version}`;
  }

  thumbUrlForPhotoId(photoId) {
    const photo = this.state.photosById.get(photoId);
    return photo ? this.thumbUrlForPhoto(photo) : `/media/thumb/${photoId}`;
  }

  async buildState() {
    const dayMap = new Map();
    const photosById = new Map();
    const journalImages = await this.indexJournalImages();
    const mediaMetaCache = await readJson(this.mediaMetaCachePath, {});
    const mediaTags = await readJson(this.mediaTagsCachePath, {});
    const mediaDescriptions = await readJson(this.mediaDescriptionsCachePath, {});
    const mediaLikes = await readJson(this.mediaLikesCachePath, {});
    const mediaDateOverrides = await readJson(this.mediaDateOverridesCachePath, {});
    const nextMediaMetaCache = {};

    await this.indexJournals(dayMap, journalImages);
    await this.indexMedia(dayMap, photosById, mediaMetaCache, nextMediaMetaCache, mediaTags, mediaDescriptions, mediaLikes, mediaDateOverrides);

    await writeJson(this.mediaMetaCachePath, nextMediaMetaCache);

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
      mediaTags,
      mediaDescriptions,
      mediaLikes,
      mediaDateOverrides
    };
    const previousState = this.state;
    this.state = nextState;
    this.recomputeDerivedState();
    const built = this.state;
    this.state = previousState;
    return built;
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

  async indexJournals(dayMap, journalImages) {
    const journalRoot = path.join(this.config.paths.journalVault, this.config.paths.journalFolderName);
    const files = await walkFiles(journalRoot);
    const journalFiles = files.filter((filePath) => path.extname(filePath).toLowerCase() === '.md');

    for (const filePath of journalFiles) {
      const isoDate = parseJournalFilenameDate(path.basename(filePath));
      if (!isoDate) continue;

      const raw = await fs.promises.readFile(filePath, 'utf8');
      const day = this.getOrCreateDay(dayMap, isoDate);
      day.journal = this.createJournalRecord(filePath, raw, journalImages);
    }
  }

  async indexMedia(dayMap, photosById, mediaMetaCache, nextMediaMetaCache, mediaTags = {}, mediaDescriptions = {}, mediaLikes = {}, mediaDateOverrides = {}) {
    const roots = this.config.paths.photoFolders || [];
    const mediaFiles = [];
    for (const folder of roots) {
      const files = await walkFiles(folder);
      for (const filePath of files) {
        if (isMediaFile(filePath)) mediaFiles.push(filePath);
      }
    }

    const stats = await mapLimit(mediaFiles, 8, async (filePath) => {
      try {
        const stat = await fs.promises.stat(filePath);
        return { filePath, stat };
      } catch (error) {
        return null;
      }
    });

    const validStats = stats.filter(Boolean);
    const mediaRecords = await mapLimit(validStats, 6, async ({ filePath, stat }) => {
      const signature = hash(`${filePath}|${stat.size}|${stat.mtimeMs}`);
      const manualDateOverride = this.normalizeMediaDateOverride(mediaDateOverrides[filePath]);
      const cachedDateInfo = mediaMetaCache[signature] || null;
      let dateInfo = manualDateOverride || null;
      if (!dateInfo && cachedDateInfo && !this.shouldRefreshCachedDateInfo(cachedDateInfo, filePath)) {
        dateInfo = cachedDateInfo;
      }
      if (!dateInfo) dateInfo = await this.extractMediaDateInfo(filePath, stat);
      if (!dateInfo) return null;
      if (!manualDateOverride) nextMediaMetaCache[signature] = dateInfo;

      const id = hash(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const type = isVideoFile(filePath) ? 'video' : 'image';
      const rootInfo = this.getPhotoRootInfo(filePath);
      const record = {
        id,
        filePath,
        fileName: path.basename(filePath),
        ext,
        type,
        isoDate: dateInfo.isoDate,
        capturedAt: dateInfo.capturedAt,
        dateSource: dateInfo.source,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        birthtimeMs: stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs,
        folder: rootInfo.relativeFolder,
        folderRootLabel: rootInfo.rootLabel,
        tags: Array.isArray(mediaTags[filePath]) ? mediaTags[filePath] : [],
        description: typeof mediaDescriptions[filePath] === 'string' ? mediaDescriptions[filePath] : '',
        liked: Boolean(mediaLikes[filePath])
      };

      photosById.set(id, record);
      const day = this.getOrCreateDay(dayMap, record.isoDate);
      day.photos.push(record);
      return record;
    });

    return mediaRecords.filter(Boolean);
  }

  shouldRefreshCachedDateInfo(cachedDateInfo) {
    return Boolean(cachedDateInfo && cachedDateInfo.source === 'filename');
  }

  async extractMediaDateInfo(filePath, stat) {
    if (isImageFile(filePath)) {
      try {
        const exif = await exifr.parse(filePath, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] });
        const exifDate = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate;
        if (exifDate instanceof Date && !Number.isNaN(exifDate.getTime())) {
          return {
            isoDate: exifDate.toISOString().slice(0, 10),
            capturedAt: exifDate.toISOString(),
            source: 'exif'
          };
        }
      } catch (error) {
        // Many exported or edited images have no EXIF. Ignore and fall through.
      }
    }

    if (isVideoFile(filePath)) {
      const videoDate = await readVideoCreatedDate(filePath);
      if (videoDate) return videoDate;
    }

    const created = stat.birthtimeMs ? new Date(stat.birthtimeMs) : null;
    if (created && !Number.isNaN(created.getTime())) {
      return {
        isoDate: created.toISOString().slice(0, 10),
        capturedAt: created.toISOString(),
        source: 'filesystem-created'
      };
    }

    const modified = new Date(stat.mtimeMs);
    if (!Number.isNaN(modified.getTime())) {
      return {
        isoDate: modified.toISOString().slice(0, 10),
        capturedAt: modified.toISOString(),
        source: 'filesystem-modified'
      };
    }

    return null;
  }


  getPhotoRootInfo(filePath) {
    const roots = this.config.paths.photoFolders || [];
    for (const root of roots) {
      const relative = path.relative(root, filePath);
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        const normalized = relative.replace(/\\/g, '/');
        const folder = path.dirname(normalized).replace(/\\/g, '/');
        return {
          rootPath: root,
          rootLabel: path.basename(root) || root,
          relativeFolder: folder && folder !== '.' ? folder : '.',
          relativePath: normalized
        };
      }
      if (!relative) {
        return {
          rootPath: root,
          rootLabel: path.basename(root) || root,
          relativeFolder: '.',
          relativePath: path.basename(filePath)
        };
      }
    }
    return { rootPath: '', rootLabel: '', relativeFolder: '.', relativePath: path.basename(filePath) };
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

    return {
      text: previewLines.join('\n').trim(),
      lines: previewLines,
      isTruncated: normalizedLines.length > 3
    };
  }

  getBootstrap() {
    const todayIsoDate = dateToIsoLocal(new Date());
    return {
      generatedAt: this.state.generatedAt,
      totalDays: this.state.dayKeys.length,
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
            .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || a.filePath.localeCompare(b.filePath))
            .slice(0, 4)
            .map((photo) => ({
              id: photo.id,
              type: photo.type,
              thumbUrl: this.thumbUrlForPhoto(photo)
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

  search(query) {
    const rawQuery = String(query || '').trim();
    const term = rawQuery.toLowerCase();
    if (!term) return { query: '', total: 0, days: [] };

    const matches = [];
    for (let index = this.state.dayKeys.length - 1; index >= 0; index -= 1) {
      const isoDate = this.state.dayKeys[index];
      const day = this.state.days.get(isoDate);
      const haystacks = [
        day.dateLabel,
        shortDateLabel(isoDate),
        day.journal?.title || '',
        day.journal?.raw || ''
      ].join('\n').toLowerCase();

      if (haystacks.includes(term)) matches.push(this.serializeDay(isoDate, { searchTerm: rawQuery }));
      if (matches.length >= 200) break;
    }

    return { query, total: matches.length, days: matches };
  }

  serializeDay(isoDate, { searchTerm = '' } = {}) {
    const day = this.state.days.get(isoDate);
    const preview = day.journal ? this.buildJournalPreview(day.journal.raw, { searchTerm }) : null;
    return {
      isoDate: day.isoDate,
      dateLabel: day.dateLabel,
      monthKey: day.monthKey,
      monthLabel: day.monthLabel,
      photoCount: day.photos.length,
      photos: day.photos
        .slice()
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || a.filePath.localeCompare(b.filePath))
        .map((photo) => ({
          id: photo.id,
          type: photo.type,
          fileName: photo.fileName,
          thumbUrl: this.thumbUrlForPhoto(photo),
          fullUrl: `/media/full/${photo.id}`,
          isoDate: photo.isoDate,
          dateLabel: longDateLabel(photo.isoDate),
          capturedAt: photo.capturedAt,
          dateSource: photo.dateSource,
          size: photo.size,
          ext: photo.ext,
          folder: photo.folder || '.',
          folderRootLabel: photo.folderRootLabel || '',
          tags: Array.isArray(photo.tags) ? photo.tags : [],
          description: typeof photo.description === 'string' ? photo.description : '',
          liked: Boolean(photo.liked)
        })),
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
      day.photos = (day.photos || []).slice().sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.filePath.localeCompare(b.filePath));
      day.photoIds = day.photos.map((photo) => photo.id);
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
        longLabel: longDateLabel(isoDate)
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
    return {
      isoDate,
      exists,
      createIfMissing,
      filePath,
      title: path.basename(filePath, '.md'),
      raw,
      dateLabel: longDateLabel(isoDate),
      photos: day ? this.serializeDay(isoDate).photos : [],
      photoCount: day?.photos?.length || 0,
      hasJournal: Boolean(day?.journal),
      wordCount: day?.journal?.wordCount || this.countWords(raw)
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


  async setPhotoTags(photoId, tags) {
    const photo = this.getPhoto(photoId);
    if (!photo) return null;
    const nextTags = Array.from(new Set((Array.isArray(tags) ? tags : [])
      .map((tag) => String(tag || '').trim())
      .filter(Boolean))).slice(0, 40);
    this.state.mediaTags = this.state.mediaTags || {};
    this.state.mediaTags[photo.filePath] = nextTags;
    photo.tags = nextTags;
    const day = this.state.days.get(photo.isoDate);
    if (day) {
      for (const item of day.photos || []) {
        if (item.id === photoId) item.tags = nextTags;
      }
    }
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
    photo.description = nextDescription;
    const day = this.state.days.get(photo.isoDate);
    if (day) {
      for (const item of day.photos || []) {
        if (item.id === photoId) item.description = nextDescription;
      }
    }
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

    photo.liked = nextLiked;
    const day = this.state.days.get(photo.isoDate);
    if (day) {
      for (const item of day.photos || []) {
        if (item.id === photoId) item.liked = nextLiked;
      }
    }

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

  async setPhotoDateOverride(photoId, isoDate) {
    const photo = this.getPhoto(photoId);
    if (!photo) return null;

    const nextIsoDate = String(isoDate || '').trim();
    this.state.mediaDateOverrides = this.state.mediaDateOverrides || {};

    if (!nextIsoDate) {
      delete this.state.mediaDateOverrides[photo.filePath];
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(nextIsoDate)) throw new Error('Invalid date override.');
      const timeFragment = typeof photo.capturedAt === 'string' && photo.capturedAt.includes('T')
        ? photo.capturedAt.slice(10)
        : 'T12:00:00.000Z';
      this.state.mediaDateOverrides[photo.filePath] = {
        isoDate: nextIsoDate,
        capturedAt: `${nextIsoDate}${timeFragment.startsWith('T') ? timeFragment : 'T12:00:00.000Z'}`,
        source: 'manual'
      };
    }

    await writeJson(this.mediaDateOverridesCachePath, this.state.mediaDateOverrides);
    await this.rebuild('manual-date-override');
    const nextPhoto = this.getPhoto(photoId);
    return nextPhoto ? { ...nextPhoto } : null;
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

module.exports = { TimelineIndexer };
