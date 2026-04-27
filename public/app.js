const requestIdle = window.requestIdleCallback || function requestIdleFallback(callback) {
  return window.setTimeout(() => callback({ timeRemaining: () => 10 }), 120);
};

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

const UPLOAD_TARGET_STORAGE_KEY = 'lifeserver-upload-target-v1';

function loadStoredUploadTarget() {
  try {
    const parsed = JSON.parse(localStorage.getItem(UPLOAD_TARGET_STORAGE_KEY) || '{}');
    return {
      rootId: typeof parsed.rootId === 'string' ? parsed.rootId : '0',
      relativePath: typeof parsed.relativePath === 'string' ? parsed.relativePath : ''
    };
  } catch (error) {
    return { rootId: '0', relativePath: '' };
  }
}

const state = {
  bootstrap: null,
  totalDays: 0,
  indexToDate: {},
  dateIndexMap: {},
  loadedDays: [],
  loadedStart: null,
  loadedEnd: null,
  chunkCache: new Map(),
  pendingChunks: new Map(),
  searchMode: false,
  searchQuery: '',
  searchUiOpen: false,
  searchInputTimer: 0,
  activeDate: null,
  expandedDates: new Set(),
  mediaObserver: null,
  sentinelObserver: null,
  mediaQueue: [],
  mediaQueueSet: new Set(),
  mediaActiveLoads: 0,
  maxMediaLoads: 2,
  scrollHandleTimer: null,
  mobileTopbarTimer: null,
  scrollHandleDragging: false,
  scrollHandleBusy: false,
  scrollHandleQueuedIndex: null,
  scrollDragStartY: 0,
  scrollDragStartIndex: 0,
  scrollPreviewIndex: null,
  scrollJumpTimer: null,
  topbarHidden: false,
  mobileLastScrollY: 0,
  mobileTopbarAnchorY: 0,
  route: { view: 'home', scrollY: 0 },
  homeScrollY: 0,
  monthCache: new Map(),
  yearCache: new Map(),
  settingsOpen: false,
  viewerSequence: [],
  viewerIndex: -1,
  viewerLoadToken: 0,
  viewerZoom: 1,
  viewerPanX: 0,
  viewerPanY: 0,
  viewerPointers: new Map(),
  viewerPanOrigin: null,
  viewerPinchStartDistance: null,
  viewerPinchStartZoom: 1,
  viewerSwipeStart: null,
  viewerVelocityX: 0,
  viewerVelocityY: 0,
  viewerMomentumFrame: null,
  viewerDetailsOpen: false,
  folderRoots: [],
  uploadContext: null,
  uploadTarget: loadStoredUploadTarget(),
  uploadSelectedFiles: [],
  uploadFileSeq: 0,
  uploadXhr: null,
  uploadProgressRatio: 0,
  uploadCreatingFolder: null,
  uploadPreparing: false,
  viewerClosing: false,
  viewerDateToastTimer: null,
  viewerLastShownDate: '',
  viewerDescriptionDirty: false,
  viewerDescriptionSaving: false,
  viewerDetailsSwipeStartY: null,
  timelinePointers: new Map(),
  timelinePinchStartDistance: null,
  timelinePinchStartColumns: Number(localStorage.getItem('lifeserver-grid-columns') || 0) || null,
  theme: localStorage.getItem('lifeserver-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  gridColumns: Number(localStorage.getItem('lifeserver-grid-columns') || 0) || null
};

const dom = {
  body: document.body,
  homeButton: document.getElementById('homeButton'),
  topbarDateLabel: document.getElementById('topbarDateLabel'),
  topbarActions: document.getElementById('topbarActions'),
  uploadTopbarButton: document.getElementById('uploadTopbarButton'),
  searchToggleButton: document.getElementById('searchToggleButton'),
  searchCloseButton: document.getElementById('searchCloseButton'),
  settingsButton: document.getElementById('settingsButton'),
  settingsHomeButton: document.getElementById('settingsHomeButton'),
  settingsTodayButton: document.getElementById('settingsTodayButton'),
  settingsUploadButton: document.getElementById('settingsUploadButton'),
  settingsModal: document.getElementById('settingsModal'),
  settingsCloseButton: document.getElementById('settingsCloseButton'),
  logoutButton: document.getElementById('logoutButton'),
  themeLight: document.getElementById('themeLight'),
  themeDark: document.getElementById('themeDark'),
  todaySection: document.getElementById('todaySection'),
  yearSection: document.getElementById('yearSection'),
  yearSectionTitle: document.getElementById('yearSectionTitle'),
  yearSectionSubtitle: document.getElementById('yearSectionSubtitle'),
  yearCarouselShell: document.querySelector('.year-carousel-shell'),
  todayEntryCard: document.getElementById('todayEntryCard'),
  todayEntryHeading: document.getElementById('todayEntryHeading'),
  todayEntryMeta: document.getElementById('todayEntryMeta'),
  todayEntryPreview: document.getElementById('todayEntryPreview'),
  todayEntryMedia: document.getElementById('todayEntryMedia'),
  todayEntryStatus: document.getElementById('todayEntryStatus'),
  yearCarousel: document.getElementById('yearCarousel'),
  yearBackButton: document.getElementById('yearBackButton'),
  yearNextButton: document.getElementById('yearNextButton'),
  homeView: document.getElementById('homeView'),
  explorerView: document.getElementById('explorerView'),
  explorerBackButton: document.getElementById('explorerBackButton'),
  explorerTitle: document.getElementById('explorerTitle'),
  explorerSubtitle: document.getElementById('explorerSubtitle'),
  explorerGrid: document.getElementById('explorerGrid'),
  timelineSection: document.getElementById('timelineSection'),
  timelinePane: document.getElementById('timelinePane'),
  timelineFeed: document.getElementById('timelineFeed'),
  timelineTopSpacer: document.getElementById('timelineTopSpacer'),
  timelineBottomSpacer: document.getElementById('timelineBottomSpacer'),
  searchForm: document.getElementById('searchForm'),
  searchInput: document.getElementById('searchInput'),
  clearSearch: document.getElementById('clearSearch'),
  scrollHandle: document.getElementById('scrollHandle'),
  scrollTrack: document.getElementById('scrollTrack'),
  scrollThumb: document.getElementById('scrollThumb'),
  scrollThumbLabel: document.getElementById('scrollThumbLabel'),
  scrollGrabber: document.getElementById('scrollGrabber'),
  scrollTopButton: document.getElementById('scrollTopButton'),
  scrollYearMarks: document.getElementById('scrollYearMarks'),
  jumpLoader: document.getElementById('jumpLoader'),
  jumpLoaderLabel: document.getElementById('jumpLoaderLabel'),
  photoViewer: document.getElementById('photoViewer'),
  viewerStage: document.getElementById('viewerStage'),
  viewerCanvas: document.getElementById('viewerCanvas'),
  viewerLoading: document.getElementById('viewerLoading'),
  viewerImage: document.getElementById('viewerImage'),
  viewerVideo: document.getElementById('viewerVideo'),
  viewerClose: document.getElementById('viewerClose'),
  viewerInfoToggle: document.getElementById('viewerInfoToggle'),
  viewerPrev: document.getElementById('viewerPrev'),
  viewerNext: document.getElementById('viewerNext'),
  viewerZoomIn: document.getElementById('viewerZoomIn'),
  viewerZoomOut: document.getElementById('viewerZoomOut'),
  viewerZoomReset: document.getElementById('viewerZoomReset'),
  viewerDetails: document.getElementById('viewerDetails'),
  viewerDetailsMeta: document.getElementById('viewerDetailsMeta'),
  viewerDateToast: document.getElementById('viewerDateToast'),
  viewerDescriptionInput: document.getElementById('viewerDescriptionInput'),
  uploadModal: document.getElementById('uploadModal'),
  uploadBackdrop: document.querySelector('#uploadModal .upload-backdrop'),
  uploadClose: document.getElementById('uploadClose'),
  uploadWindow: document.querySelector('#uploadModal .upload-window'),
  uploadTitle: document.getElementById('uploadTitle'),
  uploadFolderButton: document.getElementById('uploadFolderButton'),
  uploadFolderLabel: document.getElementById('uploadFolderLabel'),
  uploadFolderTree: document.getElementById('uploadFolderTree'),
  uploadNewFolder: document.getElementById('uploadNewFolder'),
  uploadAddFiles: document.getElementById('uploadAddFiles'),
  uploadFileInput: document.getElementById('uploadFileInput'),
  uploadFilePicker: document.querySelector('#uploadModal .upload-file-picker'),
  uploadSelectionLoading: document.getElementById('uploadSelectionLoading'),
  uploadCheckRow: document.querySelector('#uploadModal .upload-check-row'),
  uploadPreviewList: document.getElementById('uploadPreviewList'),
  uploadSetExifDate: document.getElementById('uploadSetExifDate'),
  uploadExifDateLabel: document.getElementById('uploadExifDateLabel'),
  uploadSubmit: document.getElementById('uploadSubmit'),
  uploadSubmitLabel: document.getElementById('uploadSubmitLabel'),
  uploadCancel: document.getElementById('uploadCancel'),
  uploadResume: document.getElementById('uploadResume'),
  uploadResumeLabel: document.getElementById('uploadResumeLabel'),
  viewerTagsInput: document.getElementById('viewerTagsInput'),
  viewerTagsSave: document.getElementById('viewerTagsSave')
};

const mediaViewer = window.createMediaViewer({
  getItems: () => state.viewerSequence,
  onOpen: () => {
    dom.body.classList.add('viewer-open');
  },
  onClose: () => {
    if (dom.uploadModal.classList.contains('hidden') && !state.settingsOpen) dom.body.classList.remove('viewer-open');
  },
  onRequestClose: () => {
    closeViewer();
  },
  onItemChange: (item) => {
    if (history.state?.viewer) {
      history.replaceState({ ...history.state, viewerMediaId: item.id }, '', location.href);
    }
  },
  onSaveTags: async (item, tags) => {
    const payload = await fetchJson(`/api/media/${item.id}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags })
    });
    item.tags = payload.tags || [];
    syncViewerMediaMutation(item.id, (photo) => { photo.tags = item.tags; });
    return item.tags;
  },
  onSaveDescription: async (item, description) => {
    const payload = await fetchJson(`/api/media/${item.id}/description`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description })
    });
    item.description = payload.description || '';
    syncViewerMediaMutation(item.id, (photo) => { photo.description = item.description; });
    return { description: item.description };
  },
  onToggleLike: async (item, liked) => {
    const payload = await fetchJson(`/api/media/${item.id}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liked })
    });
    item.liked = Boolean(payload.liked);
    syncViewerMediaMutation(item.id, (photo) => { photo.liked = item.liked; });
    return { liked: item.liked };
  },
  onSaveDate: async (item, isoDate) => {
    const payload = await fetchJson(`/api/media/${item.id}/date`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isoDate: isoDate || '' })
    });
    await refreshBootstrap(payload.isoDate || item.isoDate || state.bootstrap?.lastDate || null);
    return payload;
  },
  onError: (error) => {
    console.error(error);
  }
});

dom.photoViewer = mediaViewer.root;

function redirectToLogin() {
  if (window.location.pathname !== '/login') window.location.href = '/login';
}

function fetchJson(url, options) {
  return fetch(url, options).then((response) => {
    if (response.status === 401) {
      redirectToLogin();
      throw new Error('Unauthorized');
    }
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response.json();
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightPlainText(text, query) {
  const source = String(text || '');
  const term = String(query || '').trim();
  if (!term) return escapeHtml(source);
  const regex = new RegExp(`(${escapeRegExp(term)})`, 'ig');
  return source
    .split(regex)
    .map((part, index) => (index % 2 === 1 ? `<mark class="search-hit">${escapeHtml(part)}</mark>` : escapeHtml(part)))
    .join('');
}

function highlightJournalHtml(html, query) {
  const term = String(query || '').trim();
  if (!term || !html) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT, null);
  const regex = new RegExp(escapeRegExp(term), 'ig');
  const targets = [];
  let node;
  while ((node = walker.nextNode())) {
    if (!node.nodeValue || !node.nodeValue.trim()) continue;
    if (node.parentElement && node.parentElement.closest('mark.search-hit')) continue;
    targets.push(node);
  }
  for (const textNode of targets) {
    const textValue = textNode.nodeValue || '';
    regex.lastIndex = 0;
    if (!regex.test(textValue)) continue;
    regex.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(textValue))) {
      const start = match.index;
      const end = start + match[0].length;
      if (start > lastIndex) frag.appendChild(document.createTextNode(textValue.slice(lastIndex, start)));
      const mark = document.createElement('mark');
      mark.className = 'search-hit';
      mark.textContent = match[0];
      frag.appendChild(mark);
      lastIndex = end;
    }
    if (lastIndex < textValue.length) frag.appendChild(document.createTextNode(textValue.slice(lastIndex)));
    textNode.parentNode.replaceChild(frag, textNode);
  }
  return template.innerHTML;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function routeSignature(route) {
  const view = route?.view || 'home';
  if (view === 'year') return `year:${route?.year ?? ''}`;
  if (view === 'month') return `month:${route?.monthKey ?? ''}:${route?.year ?? ''}`;
  return `home:${route?.focusDate ?? ''}`;
}

function routeMatches(a, b) {
  return routeSignature(a) === routeSignature(b);
}

function monthChipLabel(isoDate) {
  if (!isoDate) return '—';
  const [y, m] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1, 1));
  return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function uploadDisplayName(fileName) {
  return String(fileName || '');
}

function dateRailLabel(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function formatWordCount(count) {
  const value = Number(count || 0);
  return `${value} word${value === 1 ? '' : 's'}`;
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (size <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function formatUploadDateSummary(file, isoDate, setExifDate) {
  if (setExifDate && isoDate) return `EXIF created date -> ${dateRailLabel(isoDate)}`;
  if (file?.lastModified) {
    const date = new Date(file.lastModified);
    const localIso = [date.getFullYear(), `${date.getMonth() + 1}`.padStart(2, '0'), `${date.getDate()}`.padStart(2, '0')].join('-');
    return `Keep current file date -> ${dateRailLabel(localIso)}`;
  }
  return 'Keep current file date metadata';
}

function createSelectedUploadFile(file) {
  return {
    id: `upload-${Date.now()}-${state.uploadFileSeq += 1}`,
    file,
    objectUrl: URL.createObjectURL(file)
  };
}

function revokeUploadSelectionFiles(files = state.uploadSelectedFiles) {
  files.forEach((item) => {
    if (item?.objectUrl) URL.revokeObjectURL(item.objectUrl);
  });
}

function clearUploadSelection() {
  revokeUploadSelectionFiles();
  state.uploadSelectedFiles = [];
  state.uploadProgressRatio = 0;
  setUploadPreparing(false);
  if (dom.uploadFileInput) dom.uploadFileInput.value = '';
}

function updateUploadButtonLabel() {
  if (!dom.uploadSubmitLabel) return;
  const count = state.uploadSelectedFiles.length;
  dom.uploadSubmitLabel.textContent = count ? `Upload ${count} file${count === 1 ? '' : 's'}` : 'Upload';
}

function setUploadPreparing(preparing) {
  state.uploadPreparing = Boolean(preparing);
  dom.uploadSelectionLoading?.classList.toggle('hidden', !state.uploadPreparing);
  dom.uploadPreviewList?.classList.toggle('is-preparing', state.uploadPreparing);
}

function updateUploadPreviewProgress() {
  const files = state.uploadSelectedFiles || [];
  const exactProgress = (Number(state.uploadProgressRatio || 0) / 100) * Math.max(files.length, 1);
  files.forEach((item, index) => {
    const progress = state.uploadXhr ? clamp((exactProgress - index) * 100, 0, 100) : 0;
    const fill = dom.uploadPreviewList?.querySelector(`[data-upload-progress="${item.id}"]`);
    if (fill) fill.style.width = `${progress}%`;
  });
}

function removeUploadFile(fileId) {
  if (state.uploadXhr) return;
  const nextFiles = [];
  let removed = null;
  state.uploadSelectedFiles.forEach((item) => {
    if (item.id === fileId && !removed) removed = item;
    else nextFiles.push(item);
  });
  if (removed?.objectUrl) URL.revokeObjectURL(removed.objectUrl);
  state.uploadSelectedFiles = nextFiles;
  if (!state.uploadSelectedFiles.length && dom.uploadFileInput) dom.uploadFileInput.value = '';
  updateUploadButtonLabel();
  renderUploadPreviews();
}

async function appendUploadFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const batchSize = 8;
  for (let index = 0; index < files.length; index += batchSize) {
    const batch = files.slice(index, index + batchSize).map((file) => createSelectedUploadFile(file));
    state.uploadSelectedFiles = [...state.uploadSelectedFiles, ...batch];
    updateUploadButtonLabel();
    renderUploadPreviews();
    if (index + batchSize < files.length) await nextFrame();
  }
}

function buildPreviewLines(journal, maxChars = 300, maxLines = 3) {
  const sourceLines = (journal?.previewLines || journal?.previewText?.split('\n') || []).filter((line) => line !== undefined && line !== null);
  const lines = [];
  let used = 0;
  let truncated = false;
  for (const rawLine of sourceLines) {
    if (lines.length >= maxLines || used >= maxChars) {
      truncated = true;
      break;
    }
    let line = String(rawLine || '');
    const remaining = maxChars - used;
    if (line.length > remaining) {
      line = line.slice(0, Math.max(0, remaining)).trimEnd();
      truncated = true;
    }
    lines.push(line);
    used += line.length;
  }
  if (!lines.length) lines.push('');
  if (truncated && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[\s.]+$/,'')}…`;
  }
  return lines.slice(0, maxLines);
}

function getTodayEntryHref() {
  const today = state.bootstrap?.today;
  if (!today?.isoDate) return '/today';
  return today.hasJournal ? `/edit/${today.isoDate}` : `/edit/${today.isoDate}?create=1`;
}

function buildTodayEntryMeta(today, includeDate = true) {
  const parts = includeDate ? [today?.dateLabel || 'Today'] : [];
  if (today?.hasJournal) parts.push(formatWordCount(today.wordCount));
  if (today?.photoCount) parts.push(`${today.photoCount} media`);
  if (!today?.hasJournal && !today?.photoCount && !today?.hasTimelineItem) parts.push('Nothing here yet');
  return parts.join(' / ');
}

function buildTodayEntryPreview(today) {
  if (today?.hasJournal) {
    const preview = buildPreviewLines({
      previewLines: today.previewLines,
      previewText: today.previewText
    }, 220, 3).map((line) => String(line || '').trim()).filter(Boolean).join('\n');
    return preview || "Today's entry is ready to keep editing.";
  }
  if (today?.photoCount) {
    return today.photoCount === 1
      ? "1 media item is already on today's timeline. Add the journal entry so the story for today is easy to pick up."
      : `${today.photoCount} media items are already on today's timeline. Add the journal entry so the story for today is easy to pick up.`;
  }
  return "";
  // return "Nothing is written for today yet. Click to create today's entry and keep moving.";
}

function currentTopbarDateLabel() {
  if (state.activeDate) return dateRailLabel(state.activeDate);
  if (state.bootstrap?.today?.dateLabel) return state.bootstrap.today.dateLabel;
  if (state.bootstrap?.lastDate) return dateRailLabel(state.bootstrap.lastDate);
  return 'Memory browser';
}

function updateTopbarDateLabel() {
  if (!dom.topbarDateLabel) return;
  dom.topbarDateLabel.textContent = currentTopbarDateLabel();
}

function buildInlineMediaCollection(media, {
  maxItems = media.length,
  wrapClass = 'entry-media-strip-wrap',
  stripClass = 'entry-media-strip',
  tileClass = 'entry-media-tile'
} = {}) {
  const items = (media || []).slice(0, maxItems);
  if (!items.length) return '';
  return `
    <div class="${wrapClass}">
      <div class="${stripClass}">
        ${items.map((item) => buildMediaTile(item, tileClass)).join('')}
      </div>
    </div>
  `;
}

function renderTodayEntryCard() {
  if (!dom.todayEntryCard) return;
  const today = state.bootstrap?.today || {};
  const hasJournal = Boolean(today.hasJournal);
  const photos = Array.isArray(today.photos) ? today.photos : [];
  const hasMedia = photos.length > 0 || Boolean(today.photoCount);
  const shouldHideTodaySection = hasJournal || hasMedia;

  dom.todaySection?.classList.toggle('hidden', shouldHideTodaySection);

  if (dom.todayEntryHeading) dom.todayEntryHeading.textContent = hasJournal ? ("Today: " + today.dateLabel) : "Create today's journal";
  if (dom.todayEntryMeta) dom.todayEntryMeta.textContent = buildTodayEntryMeta(today, false) == "Nothing here yet" ? "What happened today?" : buildTodayEntryMeta(today, false);
  if (dom.todayEntryPreview) {
    dom.todayEntryPreview.textContent = buildTodayEntryPreview(today);
    dom.todayEntryPreview.classList.toggle('is-placeholder', !hasJournal);
  }
  if (dom.todayEntryMedia) {
    const mediaHtml = buildInlineMediaCollection(photos, { maxItems: 3 });
    dom.todayEntryMedia.innerHTML = mediaHtml;
    dom.todayEntryMedia.classList.toggle('hidden', !mediaHtml);
    dom.todayEntryMedia.setAttribute('aria-hidden', mediaHtml ? 'false' : 'true');
  }
  // if (dom.todayEntryStatus) {
  //   dom.todayEntryStatus.textContent = hasJournal ? 'Edit today' : 'Create today';
  //   dom.todayEntryStatus.dataset.mode = hasJournal ? 'edit' : 'create';
  // }

  dom.todayEntryCard.dataset.mode = hasJournal ? 'edit' : 'create';
  dom.todayEntryCard.setAttribute('aria-label', hasJournal
    ? `Edit today's entry for ${today.dateLabel || 'today'}`
    : `Create today's entry for ${today.dateLabel || 'today'}`);
  if (state.mediaObserver) setupMediaObserver();
  updateTopbarDateLabel();
}

function getFolderChildren(rootId, parentPath = '') {
  const root = state.folderRoots.find((item) => item.rootId === rootId);
  if (!root) return [];
  const target = String(parentPath || '');
  const walk = (node) => {
    if ((node.relativePath || '') === target) return node;
    for (const child of (node.children || [])) {
      const hit = walk(child);
      if (hit) return hit;
    }
    return null;
  };
  const node = walk(root.tree);
  return node?.children || [];
}

function nextFolderName(rootId, parentPath, rawName) {
  const desired = String(rawName || 'New Folder').trim() || 'New Folder';
  const taken = new Set(getFolderChildren(rootId, parentPath).map((child) => String(child.label || '').toLowerCase()));
  if (!taken.has(desired.toLowerCase())) return desired;
  let index = 1;
  while (taken.has(`${desired} (${index})`.toLowerCase())) index += 1;
  return `${desired} (${index})`;
}

function insertOptimisticFolder(rootId, parentPath, folderName) {
  const root = state.folderRoots.find((item) => item.rootId === rootId);
  if (!root) return '';
  const target = String(parentPath || '');
  const walk = (node) => {
    if ((node.relativePath || '') === target) return node;
    for (const child of (node.children || [])) {
      const hit = walk(child);
      if (hit) return hit;
    }
    return null;
  };
  const parent = walk(root.tree);
  if (!parent) return '';
  const relativePath = [target, folderName].filter(Boolean).join('/');
  parent.children = parent.children || [];
  parent.children.push({
    label: folderName,
    relativePath,
    displayPath: relativePath || '.',
    mediaCount: 0,
    latestModifiedMs: Date.now(),
    icon: 'folder',
    children: [],
    pending: true
  });
  parent.children.sort((a, b) => (b.latestModifiedMs || 0) - (a.latestModifiedMs || 0) || String(a.label || '').localeCompare(String(b.label || '')));
  return relativePath;
}

function findFolderNode(rootId, relativePath) {
  const root = (state.folderRoots || []).find((item) => item.rootId === rootId) || state.folderRoots[0];
  if (!root) return null;
  const target = String(relativePath || '');
  const walk = (node) => {
    if ((node.relativePath || '') === target) return node;
    for (const child of (node.children || [])) {
      const hit = walk(child);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root.tree);
}

function persistUploadTarget() {
  localStorage.setItem(UPLOAD_TARGET_STORAGE_KEY, JSON.stringify({
    rootId: state.uploadTarget.rootId || '0',
    relativePath: state.uploadTarget.relativePath || ''
  }));
}

function normalizeUploadTarget() {
  const selectedRoot = (state.folderRoots || []).find((item) => item.rootId === state.uploadTarget.rootId);
  if (selectedRoot && findFolderNode(selectedRoot.rootId, state.uploadTarget.relativePath || '')) {
    persistUploadTarget();
    return;
  }
  const fallbackRoot = selectedRoot || state.folderRoots[0];
  if (!fallbackRoot) {
    state.uploadTarget = { rootId: '0', relativePath: '' };
    return;
  }
  state.uploadTarget = { rootId: fallbackRoot.rootId, relativePath: '' };
  persistUploadTarget();
}

function updateUploadDateToggleLabel() {
  if (!dom.uploadExifDateLabel) return;
  const targetLabel = state.uploadContext?.isoDate ? dateRailLabel(state.uploadContext.isoDate) : 'this day';
  dom.uploadExifDateLabel.textContent = `Set EXIF created date to ${targetLabel}`;
}

function updateUploadUiState() {
  dom.uploadWindow?.classList.toggle('is-uploading', Boolean(state.uploadXhr));
  dom.uploadWindow?.classList.toggle('is-preparing', Boolean(state.uploadPreparing));
  dom.uploadAddFiles?.classList.toggle('hidden', Boolean(state.uploadXhr));
}

function focusPendingUploadFolderInput() {
  if (!state.uploadCreatingFolder) return;
  requestAnimationFrame(() => {
    const input = document.getElementById('uploadNewFolderInput');
    if (input) {
      input.focus();
      input.select();
    }
  });
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 760px)').matches;
}

function isCoarsePointer() {
  return window.matchMedia('(pointer: coarse)').matches;
}

function topOffset() {
  return isMobileViewport() ? 78 : 104;
}

function timelineChunkSize() {
  return state.bootstrap?.chunkSize || 24;
}

function maxLoadedDays() {
  return timelineChunkSize() * 3;
}

function timelineCacheKey(start, limit) {
  return `${start}:${limit}`;
}

function cacheTimelineResponse(response) {
  const limit = Math.max(1, (response.endIndex - response.startIndex) + 1);
  state.chunkCache.set(timelineCacheKey(response.startIndex, limit), response);
  return response;
}

async function getTimelineChunk(start, limit) {
  const key = timelineCacheKey(start, limit);
  if (state.chunkCache.has(key)) return state.chunkCache.get(key);
  if (state.pendingChunks.has(key)) return state.pendingChunks.get(key);

  const promise = fetchJson(`/api/timeline?start=${start}&limit=${limit}`, { cache: 'no-store' })
    .then((response) => cacheTimelineResponse(response))
    .finally(() => state.pendingChunks.delete(key));

  state.pendingChunks.set(key, promise);
  return promise;
}

function prefetchTimelineRange(start, limit) {
  if (start < 0 || limit <= 0) return;
  const key = timelineCacheKey(start, limit);
  if (state.chunkCache.has(key) || state.pendingChunks.has(key)) return;
  requestIdle(() => {
    getTimelineChunk(start, limit).catch(() => {});
  });
}

function prefetchAdjacentChunks(response) {
  if (state.searchMode || !state.bootstrap) return;
  const chunkSize = timelineChunkSize();
  if (response.startIndex > 0) {
    const start = Math.max(0, response.startIndex - chunkSize);
    prefetchTimelineRange(start, response.startIndex - start);
  }
  if (response.endIndex + 1 < response.total) {
    const start = response.endIndex + 1;
    prefetchTimelineRange(start, Math.min(chunkSize, response.total - start));
  }
}

function applyTheme(theme) {
  state.theme = theme === 'dark' ? 'dark' : 'light';
  dom.body.dataset.theme = state.theme;
  localStorage.setItem('lifeserver-theme', state.theme);
  dom.themeLight?.classList.toggle('is-active', state.theme === 'light');
  dom.themeDark?.classList.toggle('is-active', state.theme === 'dark');
}

function setThemeChoice(theme) {
  applyTheme(theme);
}

function gridColumnBounds() {
  return isMobileViewport() ? { min: 2, max: 5, base: 2 } : { min: 3, max: 7, base: 4 };
}

function applyGridColumns(columns) {
  const bounds = gridColumnBounds();
  const numeric = Number(columns || bounds.base);
  const next = clamp(Math.round(numeric), bounds.min, bounds.max);
  state.gridColumns = next;
  localStorage.setItem('lifeserver-grid-columns', String(next));
  const tileScale = clamp(bounds.base / next, 0.68, 1.18);
  dom.body.style.setProperty('--grid-columns', String(next));
  dom.body.style.setProperty('--tile-scale', tileScale.toFixed(3));
}

function setGridColumns(columns) {
  applyGridColumns(columns);
}

function stepGridColumns(delta) {
  const bounds = gridColumnBounds();
  const current = state.gridColumns || bounds.base;
  const next = clamp(Math.round(current + delta), bounds.min, bounds.max);
  if (next === current) return false;
  setGridColumns(next);
  return true;
}

function normalizeWheelDelta(event) {
  if (!event) return 0;
  if (event.deltaMode === 1) return event.deltaY * 18;
  if (event.deltaMode === 2) return event.deltaY * window.innerHeight;
  return event.deltaY;
}

function createCoverHtml(urls, { journalOnly = false } = {}) {
  if (!urls || !urls.length) return `<div class="card-fallback ${journalOnly ? 'is-journal-only' : ''}">${journalOnly ? '<span class="card-fallback-icon"><i class="fa-regular fa-note-sticky"></i></span>' : ''}</div>`;
  if (urls.length === 1) {
    return `<div class="cover-single"><img src="${urls[0]}" alt="" loading="lazy" fetchpriority="low" decoding="async" /></div>`;
  }
  const tiles = urls.slice(0, 4);
  return `
    <div class="cover-collage count-${tiles.length}">
      ${tiles.map((url) => `<div><img src="${url}" alt="" loading="lazy" fetchpriority="low" decoding="async" /></div>`).join('')}
    </div>
  `;
}

function renderYearCarousel() {
  const years = state.bootstrap?.years || [];
  if (!years.length) {
    dom.yearCarousel.innerHTML = '<div class="empty-state"><h2>Nothing indexed yet</h2><p>Set your folders in config.json and restart the app.</p></div>';
    return;
  }

  dom.yearCarousel.innerHTML = years.map((year) => `
    <button class="year-card" type="button" data-year="${year.year}">
      ${createCoverHtml(year.coverUrls)}
      <div class="card-content">
        <div class="card-title">${year.year}</div>
        <div class="card-stats">${year.journalCount} entries · ${year.photoCount} media</div>
      </div>
    </button>
  `).join('');
}

function renderRail() {
  const items = state.bootstrap?.railDates || [];
  state.dateIndexMap = Object.fromEntries(items.map((item) => [item.isoDate, item.index]));
  state.indexToDate = Object.fromEntries(items.map((item) => [item.index, item.isoDate]));
}

function isDateLoaded(isoDate) {
  const targetIndex = state.dateIndexMap[isoDate];
  return targetIndex !== undefined && state.loadedStart !== null && targetIndex >= state.loadedStart && targetIndex <= state.loadedEnd;
}

function renderScrollYearMarks() {
  const years = state.bootstrap?.years || [];
  if (!dom.scrollYearMarks) return;
  if (!years.length || state.totalDays <= 1) {
    dom.scrollYearMarks.innerHTML = '';
    return;
  }
  dom.scrollYearMarks.innerHTML = [...years].reverse().map((year) => {
    const index = state.dateIndexMap[year.firstDate];
    if (index === undefined) return '';
    const ratio = 1 - (index / Math.max(1, state.totalDays - 1));
    return `<span class="scroll-year-mark" style="top:${Math.round(ratio * 1000) / 10}%">${escapeHtml(String(year.year))}</span>`;
  }).join('');
}

function updateRailActive() {
  // Date-index mapping still powers scrolling and jump marks, but the rail UI is gone.
}

function openSettings() {
  state.settingsOpen = true;
  dom.settingsModal.classList.remove('hidden');
  dom.body.classList.add('viewer-open');
}

function closeSettings() {
  state.settingsOpen = false;
  dom.settingsModal.classList.add('hidden');
  if (dom.photoViewer.classList.contains('hidden')) dom.body.classList.remove('viewer-open');
}

function syncTopbarSearchState() {
  dom.body.classList.toggle('search-bar-open', state.searchUiOpen);
  dom.searchForm?.classList.toggle('hidden', !state.searchUiOpen);
  dom.topbarActions?.classList.toggle('hidden', state.searchUiOpen);
  dom.homeButton?.classList.toggle('hidden', state.searchUiOpen);
  dom.clearSearch?.classList.toggle('hidden', !(dom.searchInput?.value || '').trim());
}

function openSearchBar() {
  state.searchUiOpen = true;
  syncTopbarSearchState();
  window.requestAnimationFrame(() => {
    dom.searchInput?.focus();
    dom.searchInput?.select();
  });
}

async function closeSearchBar({ clear = true } = {}) {
  window.clearTimeout(state.searchInputTimer);
  state.searchInputTimer = 0;
  state.searchUiOpen = false;
  if (clear && dom.searchInput && (dom.searchInput.value || state.searchQuery)) {
    dom.searchInput.value = '';
    await runSearch('');
  }
  syncTopbarSearchState();
}

function topbarUploadDate() {
  return state.activeDate
    || state.route?.focusDate
    || state.bootstrap?.today?.isoDate
    || state.bootstrap?.lastDate
    || null;
}

function triggerTopbarUpload() {
  const isoDate = topbarUploadDate();
  if (!isoDate) return;
  beginUploadSelection(isoDate);
}

function showJumpLoader(label) {
  if (!dom.jumpLoader) return;
  dom.jumpLoaderLabel.textContent = label || 'Loading…';
  dom.jumpLoader.classList.remove('hidden');
}

function hideJumpLoader() {
  dom.jumpLoader?.classList.add('hidden');
}

async function refreshBootstrap(focusDate = null) {
  const anchor = !focusDate && state.route.view === 'home' ? captureScrollAnchor() : null;
  state.chunkCache.clear();
  state.pendingChunks.clear();
  state.monthCache.clear();
  state.yearCache.clear();
  state.loadedDays = [];
  state.loadedStart = null;
  state.loadedEnd = null;
  state.bootstrap = await fetchJson('/api/bootstrap', { cache: 'no-store' });
  state.totalDays = state.bootstrap.totalDays;
  renderTodayEntryCard();
  renderYearCarousel();
  renderRail();
  renderScrollYearMarks();
  updateTopbarDateLabel();

  if (focusDate && state.dateIndexMap[focusDate] !== undefined) {
    await scrollToDate(focusDate, 'auto');
    return;
  }

  if (anchor?.isoDate && state.dateIndexMap[anchor.isoDate] !== undefined) {
    await ensureTimelineContainsDate(anchor.isoDate, 'center');
    requestAnimationFrame(() => restoreScrollAnchor(anchor));
    return;
  }

  if (state.bootstrap?.lastDate) {
    await ensureTimelineLoaded(state.bootstrap.lastDate);
    return;
  }

  renderTimeline();
}

async function loadUploadFolders() {
  const payload = await fetchJson('/api/upload/folders');
  state.folderRoots = payload.roots || [];
  normalizeUploadTarget();
}

function renderFolderNode(node, rootId, depth = 0) {
  const isSelected = state.uploadTarget.rootId === rootId && state.uploadTarget.relativePath === node.relativePath;
  const indent = depth * 14;
  const modified = node.latestModifiedMs ? new Date(node.latestModifiedMs).toLocaleDateString() : '';
  const isCreatingHere = state.uploadCreatingFolder && state.uploadCreatingFolder.rootId === rootId && state.uploadCreatingFolder.parentPath === node.relativePath;
  const createRow = isCreatingHere ? `
    <div class="upload-folder-node depth-${depth + 1} is-creating">
      <div class="upload-folder-item upload-folder-item-creating" style="padding-left:${12 + ((depth + 1) * 14)}px">
        <span class="upload-folder-item-main"><i class="fa-solid fa-folder-plus"></i><input id="uploadNewFolderInput" class="upload-folder-input" type="text" value="${escapeHtml(state.uploadCreatingFolder.name || 'New Folder')}" /></span>
        <label class="upload-folder-item-meta upload-folder-confirm" aria-label="Create folder"><input id="uploadNewFolderConfirm" type="checkbox" /><i class="fa-solid fa-check"></i></label>
      </div>
    </div>
  ` : '';
  const icon = node.pending ? 'spinner fa-spin' : escapeHtml(node.icon || 'folder');
  const meta = `${node.mediaCount || 0}${modified ? ` · ${escapeHtml(modified)}` : ''}`;
  return `
    <div class="upload-folder-node depth-${depth}">
      <button class="upload-folder-item ${isSelected ? 'is-selected' : ''} ${node.pending ? 'is-pending' : ''}" type="button" style="padding-left:${12 + indent}px" data-upload-root="${rootId}" data-upload-path="${escapeHtml(node.relativePath)}">
        <span class="upload-folder-item-main"><i class="fa-solid fa-${icon}"></i><span>${escapeHtml(node.displayPath === '.' ? '(root)' : node.label)}</span></span>
        <span class="upload-folder-item-meta">${meta}</span>
      </button>
      ${(node.children || []).map((child) => renderFolderNode(child, rootId, depth + 1)).join('')}
      ${createRow}
    </div>
  `;
}

function renderUploadPreviewsFilenameLegacy() {
  if (!dom.uploadPreviewList) return;
  const files = state.uploadSelectedFiles || [];
  const setExifDate = Boolean(dom.uploadSetExifDate?.checked);
  dom.uploadPreviewList.innerHTML = files.map((item) => {
    const file = item.file;
    const isVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(file.name);
    const displayName = uploadDisplayName(file.name);
    return `<button class="upload-preview-card ${state.uploadXhr ? '' : 'is-removable'}" type="button" ${state.uploadXhr ? 'disabled' : ''} data-upload-remove="${item.id}" aria-label="Remove ${escapeHtml(file.name)}"><div class="upload-preview-thumb">${isVideo ? `<video src="${item.objectUrl}" muted playsinline preload="none"></video><span class="upload-preview-video"><i class="fa-solid fa-play"></i></span>` : `<img src="${item.objectUrl}" alt="${escapeHtml(file.name)}" loading="lazy" decoding="async" />`}${state.uploadXhr ? '' : '<span class="upload-preview-remove"><i class="fa-solid fa-xmark"></i></span>'}</div><div class="upload-preview-meta"><strong title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</strong><span>EXIF date · ${escapeHtml(formatUploadDateSummary(file, state.uploadContext?.isoDate, prefix))}</span><span>Size · ${escapeHtml(formatFileSize(file.size))}</span></div><div class="upload-preview-progress"><span class="upload-preview-progress-fill" data-upload-progress="${item.id}"></span></div></button>`;
  }).join('');
  updateUploadPreviewProgress();
}

function renderUploadPreviewsExifLegacy() {
  if (!dom.uploadPreviewList) return;
  const files = state.uploadSelectedFiles || [];
  const setExifDate = Boolean(dom.uploadSetExifDate?.checked);
  dom.uploadPreviewList.innerHTML = files.map((item) => {
    const file = item.file;
    const isVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(file.name);
    const displayName = uploadDisplayName(file.name);
    const previewThumb = isVideo
      ? `<video src="${item.objectUrl}" muted playsinline preload="none"></video><span class="upload-preview-video"><i class="fa-solid fa-play"></i></span>`
      : `<img src="${item.objectUrl}" alt="${escapeHtml(file.name)}" loading="lazy" decoding="async" />`;
    return `<button class="upload-preview-card ${state.uploadXhr ? '' : 'is-removable'}" type="button" ${state.uploadXhr ? 'disabled' : ''} data-upload-remove="${item.id}" aria-label="Remove ${escapeHtml(file.name)}"><div class="upload-preview-thumb">${previewThumb}${state.uploadXhr ? '' : '<span class="upload-preview-remove"><i class="fa-solid fa-xmark"></i></span>'}</div><div class="upload-preview-meta"><strong title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</strong><span>${escapeHtml(formatUploadDateSummary(file, state.uploadContext?.isoDate, setExifDate))}</span><span>Size Â· ${escapeHtml(formatFileSize(file.size))}</span></div><div class="upload-preview-progress"><span class="upload-preview-progress-fill" data-upload-progress="${item.id}"></span></div></button>`;
  }).join('');
  updateUploadPreviewProgress();
}

function renderUploadPreviews() {
  if (!dom.uploadPreviewList) return;
  const files = state.uploadSelectedFiles || [];
  const setExifDate = Boolean(dom.uploadSetExifDate?.checked);
  dom.uploadPreviewList.innerHTML = files.map((item) => {
    const file = item.file;
    const isVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(file.name);
    const displayName = uploadDisplayName(file.name);
    const previewThumb = isVideo
      ? `<video src="${item.objectUrl}" muted playsinline preload="none"></video><span class="upload-preview-video"><i class="fa-solid fa-play"></i></span>`
      : `<img src="${item.objectUrl}" alt="${escapeHtml(file.name)}" loading="lazy" decoding="async" />`;
    return `<button class="upload-preview-card ${state.uploadXhr ? '' : 'is-removable'}" type="button" ${state.uploadXhr ? 'disabled' : ''} data-upload-remove="${item.id}" aria-label="Remove ${escapeHtml(file.name)}"><div class="upload-preview-thumb">${previewThumb}${state.uploadXhr ? '' : '<span class="upload-preview-remove"><i class="fa-solid fa-xmark"></i></span>'}</div><div class="upload-preview-meta"><strong title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</strong><span>${escapeHtml(formatUploadDateSummary(file, state.uploadContext?.isoDate, setExifDate))}</span><span>Size - ${escapeHtml(formatFileSize(file.size))}</span></div><div class="upload-preview-progress"><span class="upload-preview-progress-fill" data-upload-progress="${item.id}"></span></div></button>`;
  }).join('');
  updateUploadPreviewProgress();
}

function updateUploadFolderLabel() {
  const root = state.folderRoots.find((item) => item.rootId === state.uploadTarget.rootId) || state.folderRoots[0];
  if (!root) {
    dom.uploadFolderLabel.textContent = 'No photo folders configured';
    return;
  }
  const node = findFolderNode(root.rootId, state.uploadTarget.relativePath || '');
  dom.uploadFolderLabel.textContent = node?.label || root.rootLabel;
}

function renderUploadFolderTree() {
  if (!dom.uploadFolderTree) return;
  const roots = state.uploadXhr
    ? state.folderRoots.filter((root) => root.rootId === state.uploadTarget.rootId)
    : state.folderRoots;
  dom.uploadFolderTree.innerHTML = roots.map((root) => `
    <div class="upload-folder-root ${root.rootId === state.uploadTarget.rootId ? 'is-active-root' : ''}">
      <div class="upload-folder-root-label"><i class="fa-solid fa-hard-drive"></i> ${escapeHtml(root.rootLabel)} <span class="upload-folder-root-count">${root.tree.mediaCount || 0}</span></div>
      ${renderFolderNode(root.tree, root.rootId)}
    </div>
  `).join('');
  updateUploadFolderLabel();
  focusPendingUploadFolderInput();
}

async function openUploadModal(isoDate) {
  state.uploadContext = { isoDate };
  dom.uploadTitle.textContent = `Add media for ${dateRailLabel(isoDate)}`;
  if (!state.uploadXhr) {
    state.uploadProgressRatio = 0;
    dom.uploadSetExifDate.checked = true;
    dom.uploadSubmit.style.setProperty('--upload-progress', '0%');
    updateUploadButtonLabel();
    dom.uploadCancel?.classList.add('hidden');
  }
  if (!state.folderRoots.length) await loadUploadFolders();
  updateUploadDateToggleLabel();
  updateUploadUiState();
  renderUploadFolderTree();
  renderUploadPreviews();
  dom.uploadFolderTree.classList.remove('is-open');
  dom.uploadModal.classList.remove('hidden');
  dom.uploadResume?.classList.add('hidden');
  dom.body.classList.add('viewer-open');
}

function closeUploadModal() {
  if (state.uploadXhr) {
    dom.uploadModal.classList.add('hidden');
    dom.uploadResumeLabel.textContent = dom.uploadSubmitLabel?.textContent || 'Uploading…';
    dom.uploadResume?.classList.remove('hidden');
    if (dom.photoViewer.classList.contains('hidden') && !state.settingsOpen) dom.body.classList.remove('viewer-open');
    return;
  }
  state.uploadContext = null;
  state.uploadCreatingFolder = null;
  clearUploadSelection();
  renderUploadPreviews();
  dom.uploadModal.classList.add('hidden');
  dom.uploadResume?.classList.add('hidden');
  updateUploadUiState();
  if (dom.photoViewer.classList.contains('hidden') && !state.settingsOpen) dom.body.classList.remove('viewer-open');
}

function setUploadTarget(rootId, relativePath) {
  state.uploadTarget = { rootId, relativePath: relativePath || '' };
  state.uploadCreatingFolder = null;
  persistUploadTarget();
  renderUploadFolderTree();
}

function promptNewUploadFolder() {
  state.uploadCreatingFolder = {
    rootId: state.uploadTarget.rootId || (state.folderRoots[0]?.rootId || '0'),
    parentPath: state.uploadTarget.relativePath || '',
    name: 'New Folder'
  };
  dom.uploadFolderTree?.classList.add('is-open');
  renderUploadFolderTree();
}

async function commitNewUploadFolder() {
  if (!state.uploadCreatingFolder) return;
  const input = document.getElementById('uploadNewFolderInput');
  const requestedName = String(input?.value || state.uploadCreatingFolder.name || 'New Folder').trim() || 'New Folder';
  const rootId = state.uploadCreatingFolder.rootId;
  const parentPath = state.uploadCreatingFolder.parentPath || '';
  const optimisticName = nextFolderName(rootId, parentPath, requestedName);
  state.uploadCreatingFolder = null;
  const optimisticPath = insertOptimisticFolder(rootId, parentPath, optimisticName);
  state.uploadTarget = { rootId, relativePath: optimisticPath };
  persistUploadTarget();
  renderUploadFolderTree();
  try {
    const payload = await fetchJson('/api/upload/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootId, relativePath: parentPath, folderName: optimisticName })
    });
    await loadUploadFolders();
    state.uploadTarget = { rootId, relativePath: payload.relativePath === '.' ? '' : payload.relativePath };
    persistUploadTarget();
    renderUploadFolderTree();
  } catch (error) {
    await loadUploadFolders();
    renderUploadFolderTree();
    throw error;
  }
}


function beginUploadSelection(isoDate) {
  state.uploadContext = { isoDate };
  dom.uploadAddFiles?.click();
}

function cancelUploadMedia() {
  if (!state.uploadXhr) return;
  state.uploadXhr.abort();
}

function uploadMediaFiles() {
  const files = state.uploadSelectedFiles.length ? state.uploadSelectedFiles.map((item) => item.file) : Array.from(dom.uploadFileInput.files || []);
  if (!files.length) return;
  const form = new FormData();
  form.append('rootId', state.uploadTarget.rootId || '0');
  form.append('relativePath', state.uploadTarget.relativePath || '');
  form.append('targetIsoDate', state.uploadContext.isoDate);
  form.append('setExifDate', dom.uploadSetExifDate.checked ? '1' : '0');
  files.forEach((file) => form.append('files', file));

  state.uploadProgressRatio = 0;
  const xhr = new XMLHttpRequest();
  state.uploadXhr = xhr;
  dom.uploadSubmit.disabled = true;
  dom.uploadSubmit.style.setProperty('--upload-progress', '0%');
  if (dom.uploadSubmitLabel) dom.uploadSubmitLabel.textContent = `Uploading ${files.length} file${files.length === 1 ? '' : 's'} · 0%`;
  dom.uploadCancel?.classList.remove('hidden');
  updateUploadUiState();
  renderUploadFolderTree();
  updateUploadPreviewProgress();
  xhr.open('POST', '/api/upload/media');
  xhr.upload.addEventListener('progress', (event) => {
    if (!event.lengthComputable) return;
    const ratio = Math.round((event.loaded / event.total) * 100);
    state.uploadProgressRatio = ratio;
    dom.uploadSubmit.style.setProperty('--upload-progress', `${ratio}%`);
    if (dom.uploadSubmitLabel) dom.uploadSubmitLabel.textContent = `Uploading ${files.length} file${files.length === 1 ? '' : 's'} · ${ratio}%`;
    dom.uploadResumeLabel.textContent = dom.uploadSubmitLabel?.textContent || 'Uploading…';
    updateUploadPreviewProgress();
  });
  xhr.addEventListener('load', async () => {
    state.uploadXhr = null;
    state.uploadProgressRatio = 100;
    dom.uploadSubmit.disabled = false;
    dom.uploadCancel?.classList.add('hidden');
    let payload = {};
    try { payload = JSON.parse(xhr.responseText || '{}'); } catch (error) {}
    if (xhr.status < 200 || xhr.status >= 300) {
      updateUploadUiState();
      if (dom.uploadSubmitLabel) dom.uploadSubmitLabel.textContent = payload.error || 'Upload failed';
      renderUploadFolderTree();
      updateUploadPreviewProgress();
      return;
    }
    dom.uploadSubmit.style.setProperty('--upload-progress', '100%');
    if (dom.uploadSubmitLabel) dom.uploadSubmitLabel.textContent = `Uploaded ${payload.count || files.length} file${(payload.count || files.length) === 1 ? '' : 's'}`;
    clearUploadSelection();
    updateUploadUiState();
    renderUploadFolderTree();
    renderUploadPreviews();
    await refreshBootstrap(payload.isoDate || state.uploadContext.isoDate);
    closeUploadModal();
  });
  xhr.addEventListener('abort', () => {
    state.uploadXhr = null;
    state.uploadProgressRatio = 0;
    dom.uploadSubmit.disabled = false;
    dom.uploadCancel?.classList.add('hidden');
    dom.uploadSubmit.style.setProperty('--upload-progress', '0%');
    if (dom.uploadSubmitLabel) dom.uploadSubmitLabel.textContent = 'Upload cancelled';
    dom.uploadResumeLabel.textContent = 'Upload cancelled';
    updateUploadUiState();
    renderUploadFolderTree();
    updateUploadPreviewProgress();
  });
  xhr.addEventListener('error', () => {
    state.uploadXhr = null;
    state.uploadProgressRatio = 0;
    dom.uploadSubmit.disabled = false;
    dom.uploadCancel?.classList.add('hidden');
    if (dom.uploadSubmitLabel) dom.uploadSubmitLabel.textContent = 'Upload failed';
    dom.uploadResumeLabel.textContent = 'Upload failed';
    updateUploadUiState();
    renderUploadFolderTree();
    updateUploadPreviewProgress();
  });
  xhr.send(form);
}

function buildMediaTile(media, className, { hero = false, label = '', badge = '' } = {}) {
  const thumb = media.thumbUrl;
  return `
    <button class="${className} media-tile open-media ${hero ? 'hero-photo' : ''}" type="button" data-media-id="${media.id}">
      <div class="media-skeleton"></div>
      <img class="lazy-media" data-src="${thumb}" alt="${escapeHtml(media.fileName || '')}" draggable="false" />
      ${hero ? '<div class="hero-gradient"></div>' : ''}
      ${label ? `<div class="hero-stamp">${escapeHtml(label)}</div>` : ''}
      ${media.type === 'video' ? `<div class="media-badge ${hero ? 'hero-badge' : ''}"><span class="play-mark"><i class="fa-solid fa-play"></i></span>Video</div>` : ''}
      ${badge && media.type !== 'video' ? `<div class="media-badge ${hero ? 'hero-badge' : ''}">${badge}</div>` : ''}
    </button>
  `;
}

function buildJournalHtml(day) {
  if (!day.journal) return '';
  const journal = day.journal;
  const expanded = state.expandedDates.has(day.isoDate);
  const highlightQuery = state.searchMode ? state.searchQuery : '';

  if (!journal.isPreviewTruncated) {
    return `<section class="journal-wrap"><div class="journal-body">${highlightJournalHtml(journal.fullHtml, highlightQuery)}</div></section>`;
  }

  const previewLines = buildPreviewLines(journal, 300, 3);
  const previewHtml = previewLines.map((line, index) => {
    const safeLine = highlightPlainText(line || '', highlightQuery);
    const tail = index === previewLines.length - 1 ? `<button class="expand-inline" type="button" data-journal-toggle="${day.isoDate}">Read more</button>` : '';
    return `<span class="journal-preview-line">${safeLine}${tail}</span>`;
  }).join('');

  return `
    <section class="journal-wrap">
      ${!expanded ? `<div class="journal-preview">${previewHtml}</div>` : ''}
      ${expanded ? `<div class="journal-body">${highlightJournalHtml(journal.fullHtml, highlightQuery)}</div><div class="expand-row"><button class="collapse-link" type="button" data-journal-toggle="${day.isoDate}">Show less</button></div>` : ''}
    </section>
  `;
}

function buildEntryAction(day) {
  if (day.journal) {
    return `<a class="journal-edit-button icon-button" href="/edit/${day.isoDate}" data-edit-date="${day.isoDate}" aria-label="Edit entry"><i class="fa-solid fa-pen-to-square"></i></a>`;
  }
  return `<a class="journal-edit-button icon-button" href="/edit/${day.isoDate}?create=1" data-create-entry-date="${day.isoDate}" aria-label="Add entry"><i class="fa-regular fa-note-sticky"></i></a>`;
}

function buildUploadAction(day) {
  return `<button class="journal-edit-button icon-button" type="button" data-upload-date="${day.isoDate}" aria-label="Add media"><i class="fa-solid fa-plus"></i></button>`;
}

function buildSearchPhotoStack(media) {
  const stack = media.slice(0, 4);
  return `
    <div class="search-photo-stack-wrap">
      <div class="search-photo-stack">
        ${stack.map((item, index) => `<button class="search-photo-stack-item open-media" type="button" data-media-id="${item.id}" style="--stack-index:${index}"><img class="lazy-media" data-src="${item.thumbUrl}" alt="${escapeHtml(item.fileName || '')}" draggable="false" /></button>`).join('')}
      </div>
    </div>
  `;
}

function buildDayHtml(day) {
  const media = day.photos || [];
  let mediaHtml = '';
  const searchCompact = state.searchMode;
  const entryActionHtml = buildEntryAction(day);
  const uploadActionHtml = buildUploadAction(day);

  if (media.length) {
    const stripItems = searchCompact ? media.slice(0, Math.min(media.length, 4)) : media;
    if (searchCompact) {
      mediaHtml = buildSearchPhotoStack(stripItems);
    } else if (media.length <= 4) {
      mediaHtml = buildInlineMediaCollection(stripItems);
    } else if (media.length >= 5) {
      mediaHtml = `<div class="photo-grid">${media.map((item) => buildMediaTile(item, 'photo-grid-button')).join('')}</div>`;
    }
  }

  const muted = day.photoCount
    ? `${day.photoCount} media`
    : (day.journal ? formatWordCount(day.journal.wordCount ?? 0) : '');

  return `
    <article class="day-block" data-day-date="${day.isoDate}" data-day-index="${state.dateIndexMap[day.isoDate] ?? ''}" data-month-label="${escapeHtml(day.monthLabel)}">
      <section class="entry-card">
        <div class="entry-card-head">
          <span class="entry-card-icon" aria-hidden="true"><i class="fa-solid fa-calendar-day"></i></span>
          <div class="entry-card-copy">
            <h3 class="day-title">${escapeHtml(day.dateLabel)}</h3>
            <div class="day-title-meta"><div class="day-title-muted">${escapeHtml(muted)}</div></div>
          </div>
        </div>
        <div class="entry-card-actions">${entryActionHtml}${uploadActionHtml}</div>
        ${buildJournalHtml(day)}
        ${mediaHtml}
      </section>
    </article>
  `;
}

function rebuildViewerSequence() {
  state.viewerSequence = state.loadedDays.flatMap((day) => day.photos.map((photo) => photo));
}

function enqueueMediaLoad(node) {
  if (!node || !node.dataset.src || state.mediaQueueSet.has(node)) return;
  state.mediaQueue.push(node);
  state.mediaQueueSet.add(node);
  processMediaQueue();
}

function finishMediaNode(node) {
  state.mediaQueueSet.delete(node);
  const skeleton = node.parentElement?.querySelector('.media-skeleton');
  if (skeleton) skeleton.remove();
}

function processMediaQueue() {
  while (state.mediaActiveLoads < state.maxMediaLoads && state.mediaQueue.length) {
    const node = state.mediaQueue.shift();
    if (!node?.isConnected || !node.dataset.src) {
      state.mediaQueueSet.delete(node);
      continue;
    }

    const src = node.dataset.src;
    delete node.dataset.src;
    state.mediaActiveLoads += 1;

    const done = () => {
      state.mediaActiveLoads = Math.max(0, state.mediaActiveLoads - 1);
      finishMediaNode(node);
      processMediaQueue();
    };

    node.onload = () => {
      node.classList.add('is-ready');
      done();
    };
    node.onerror = done;
    node.src = src;
  }
}

function setupMediaObserver() {
  if (state.mediaObserver) state.mediaObserver.disconnect();
  state.mediaObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      enqueueMediaLoad(entry.target);
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '120px 0px 120px 0px' });

  document.querySelectorAll('#todayEntryCard .lazy-media, #timelineFeed .lazy-media').forEach((node) => state.mediaObserver.observe(node));
}

function captureScrollAnchor() {
  const blocks = Array.from(document.querySelectorAll('.day-block'));
  const threshold = topOffset() + 32;
  let current = blocks[0] || null;
  for (const block of blocks) {
    const rect = block.getBoundingClientRect();
    if (rect.bottom >= threshold) {
      current = block;
      break;
    }
  }
  if (!current) return null;
  return { isoDate: current.dataset.dayDate, top: current.getBoundingClientRect().top };
}

function restoreScrollAnchor(anchor) {
  if (!anchor) return;
  const block = document.querySelector(`[data-day-date="${anchor.isoDate}"]`);
  if (!block) return;
  const afterTop = block.getBoundingClientRect().top;
  window.scrollBy({ top: afterTop - anchor.top, behavior: 'auto' });
}

function trimLoadedWindow(direction) {
  const limit = maxLoadedDays();
  if (state.loadedDays.length <= limit) return;
  const overflow = state.loadedDays.length - limit;
  if (overflow <= 0) return;

  if (direction === 'older') {
    state.loadedDays = state.loadedDays.slice(overflow);
    state.loadedEnd -= overflow;
  } else if (direction === 'newer') {
    state.loadedDays = state.loadedDays.slice(0, state.loadedDays.length - overflow);
    state.loadedStart += overflow;
  }
}

function renderTimeline() {
  if (!state.loadedDays.length) {
    dom.timelineFeed.innerHTML = `
      <div class="empty-state">
        <h2>${state.searchMode ? 'No matching journal entries' : 'No timeline data yet'}</h2>
        <p>${state.searchMode ? 'Try another search phrase.' : 'Once your folders are indexed, your timeline will appear here.'}</p>
      </div>
    `;
    dom.timelineTopSpacer.style.height = '0px';
    dom.timelineBottomSpacer.style.height = '0px';
    rebuildViewerSequence();
    updateStickyMonth();
    return;
  }

  const approxDayHeight = isMobileViewport() ? 240 : 280;
  const missingAbove = state.totalDays && state.loadedEnd !== null ? Math.max(0, state.totalDays - 1 - state.loadedEnd) : 0;
  const missingBelow = state.loadedStart !== null ? Math.max(0, state.loadedStart) : 0;
  dom.timelineTopSpacer.style.height = `${missingAbove * approxDayHeight}px`;
  dom.timelineBottomSpacer.style.height = `${missingBelow * approxDayHeight}px`;

  let html = '';
  if (!state.searchMode && state.loadedEnd < state.totalDays - 1) html += '<div id="topSentinel" class="timeline-sentinel"></div>';

  let previousMonth = null;
  for (const day of state.loadedDays) {
    if (day.monthKey !== previousMonth) {
      html += `<div class="month-divider"><span class="month-divider-label">${escapeHtml(day.monthLabel)}</span></div>`;
      previousMonth = day.monthKey;
    }
    html += buildDayHtml(day);
  }

  if (!state.searchMode && state.loadedStart > 0) html += '<div id="bottomSentinel" class="timeline-sentinel"></div>';

  dom.timelineFeed.innerHTML = html;
  rebuildViewerSequence();
  setupMediaObserver();
  setupSentinelObserver();
  updateActiveFromScroll();
  syncScrollThumb();
}

function applyTimelineResponse(response, { replace = false } = {}) {
  cacheTimelineResponse(response);
  state.totalDays = response.total;
  const responseDays = [...response.days].reverse();
  const anchor = !replace ? captureScrollAnchor() : null;
  let direction = 'replace';

  if (replace || state.loadedStart === null) {
    state.loadedDays = responseDays;
    state.loadedStart = response.startIndex;
    state.loadedEnd = response.endIndex;
  } else if (response.endIndex < state.loadedStart) {
    state.loadedDays = [...state.loadedDays, ...responseDays];
    state.loadedStart = response.startIndex;
    direction = 'older';
  } else if (response.startIndex > state.loadedEnd) {
    state.loadedDays = [...responseDays, ...state.loadedDays];
    state.loadedEnd = response.endIndex;
    direction = 'newer';
  } else {
    state.loadedDays = responseDays;
    state.loadedStart = response.startIndex;
    state.loadedEnd = response.endIndex;
  }

  trimLoadedWindow(direction);
  renderTimeline();
  prefetchAdjacentChunks(response);

  if (anchor) {
    requestAnimationFrame(() => restoreScrollAnchor(anchor));
  }
}

async function ensureTimelineLoaded(anchorDate) {
  if (state.searchMode || !state.bootstrap) return;
  const targetIndex = anchorDate ? state.dateIndexMap[anchorDate] : undefined;
  const chunkSize = timelineChunkSize();

  if (state.loadedStart !== null && targetIndex !== undefined && targetIndex >= state.loadedStart && targetIndex <= state.loadedEnd) {
    return;
  }

  const start = targetIndex === undefined
    ? Math.max(0, state.totalDays - chunkSize)
    : Math.max(0, targetIndex - Math.floor(chunkSize / 2));

  const response = await getTimelineChunk(start, chunkSize);
  applyTimelineResponse(response, { replace: true });
}

async function loadOlderChunk() {
  if (state.searchMode || state.loadedStart === null || state.loadedStart <= 0) return;
  const chunkSize = timelineChunkSize();
  const start = Math.max(0, state.loadedStart - chunkSize);
  const limit = state.loadedStart - start;
  const response = await getTimelineChunk(start, limit);
  applyTimelineResponse(response, { replace: false });
}

async function loadNewerChunk() {
  if (state.searchMode || state.loadedEnd === null || state.loadedEnd >= state.totalDays - 1) return;
  const chunkSize = timelineChunkSize();
  const start = state.loadedEnd + 1;
  const limit = Math.min(chunkSize, state.totalDays - start);
  const response = await getTimelineChunk(start, limit);
  applyTimelineResponse(response, { replace: false });
}

function setupSentinelObserver() {
  if (state.sentinelObserver) state.sentinelObserver.disconnect();
  if (state.searchMode) return;

  state.sentinelObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      if (entry.target.id === 'bottomSentinel') loadOlderChunk().catch(() => {});
      if (entry.target.id === 'topSentinel') loadNewerChunk().catch(() => {});
    });
  }, { rootMargin: '300px 0px 300px 0px' });

  const top = document.getElementById('topSentinel');
  const bottom = document.getElementById('bottomSentinel');
  if (top) state.sentinelObserver.observe(top);
  if (bottom) state.sentinelObserver.observe(bottom);
}

function updateStickyMonth() {
  return;
}

function updateActiveFromScroll() {
  if (state.route.view !== 'home') {
    state.activeDate = null;
    updateStickyMonth();
    updateRailActive();
    syncScrollThumb();
    updateTopbarDateLabel();
    return;
  }

  const dayBlocks = Array.from(document.querySelectorAll('.day-block'));
  if (!dayBlocks.length) {
    state.activeDate = null;
    updateStickyMonth();
    updateRailActive();
    syncScrollThumb();
    updateTopbarDateLabel();
    return;
  }

  const threshold = topOffset() + 80;
  let current = dayBlocks[0];
  for (const block of dayBlocks) {
    const rect = block.getBoundingClientRect();
    if (rect.top <= threshold) current = block;
    else break;
  }

  state.activeDate = current?.dataset.dayDate || dayBlocks[0].dataset.dayDate || null;
  updateStickyMonth();
  updateRailActive();
  updateScrollThumbLabel();
  updateTopbarDateLabel();
}

async function ensureTimelineContainsDate(isoDate, placement = 'center') {
  const targetIndex = state.dateIndexMap[isoDate];
  if (targetIndex === undefined) return;

  if (state.loadedStart !== null && targetIndex >= state.loadedStart && targetIndex <= state.loadedEnd) {
    return;
  }

  const chunkSize = timelineChunkSize();
  const start = placement === 'top'
    ? Math.max(0, targetIndex - chunkSize + 1)
    : Math.max(0, targetIndex - Math.floor(chunkSize / 2));
  const response = await getTimelineChunk(start, chunkSize);
  applyTimelineResponse(response, { replace: true });
}

function positionDatePrecisely(isoDate, behavior = 'auto') {
  const element = document.querySelector(`[data-day-date="${isoDate}"]`);
  if (!element) return;
  const nextTop = window.scrollY + element.getBoundingClientRect().top - topOffset();
  window.scrollTo({ top: Math.max(0, nextTop), behavior });
}

async function scrollToDate(isoDate, behavior = 'auto') {
  if (state.searchMode) {
    state.searchMode = false;
    state.searchQuery = '';
    dom.searchInput.value = '';
    dom.clearSearch.classList.add('hidden');
  }

  const needsLoad = !isDateLoaded(isoDate);
  if (needsLoad) showJumpLoader(`Loading ${dateRailLabel(isoDate)}…`);
  await ensureTimelineContainsDate(isoDate, 'top');
  positionDatePrecisely(isoDate, behavior);
  [80, 220, 420].forEach((delay) => {
    window.setTimeout(() => positionDatePrecisely(isoDate, 'auto'), delay);
  });
  state.activeDate = isoDate;
  hideJumpLoader();
  updateStickyMonth();
  updateRailActive();
  syncScrollThumb();
  updateTopbarDateLabel();
}

function hideScrollHandle() {
  dom.scrollHandle.classList.remove('visible', 'is-dragging');
  dom.scrollYearMarks?.classList.remove('visible');
}

function showScrollHandle() {
  dom.scrollHandle.classList.add('visible');
  clearTimeout(state.scrollHandleTimer);
  const delay = isMobileViewport() ? 320 : 680;
  if (!state.scrollHandleDragging) {
    state.scrollHandleTimer = window.setTimeout(() => {
      if (isMobileViewport()) {
        if (!state.scrollHandleDragging) hideScrollHandle();
        return;
      }
      if (!dom.scrollHandle.matches(':hover') && !state.scrollHandleDragging) hideScrollHandle();
    }, delay);
  }
}

function updateScrollThumbLabel(indexOverride = null) {
  const isoDate = indexOverride !== null ? state.indexToDate[indexOverride] : state.activeDate;
  dom.scrollThumbLabel.textContent = monthChipLabel(isoDate);
}

function syncScrollThumbPosition(indexOverride = null) {
  const activeIndex = indexOverride !== null
    ? indexOverride
    : (state.activeDate && state.dateIndexMap[state.activeDate] !== undefined ? state.dateIndexMap[state.activeDate] : null);
  if (activeIndex === null || activeIndex === undefined || state.totalDays <= 1) {
    dom.scrollHandle.style.top = '50%';
    return;
  }
  const minY = Math.max(topOffset() + 18, 88);
  const maxY = window.innerHeight - 88;
  const span = Math.max(140, maxY - minY);
  const ratio = 1 - (activeIndex / Math.max(1, state.totalDays - 1));
  const y = minY + (ratio * span);
  dom.scrollHandle.style.top = `${Math.round(y)}px`;
}

function syncScrollThumb() {
  updateScrollThumbLabel(state.scrollPreviewIndex);
  syncScrollThumbPosition(state.scrollPreviewIndex);
}

function indexFromHandleDrag(clientY) {
  const minY = Math.max(topOffset() + 18, 88);
  const maxY = window.innerHeight - 88;
  const ratio = 1 - clamp((clientY - minY) / Math.max(1, maxY - minY), 0, 1);
  return clamp(Math.round(ratio * Math.max(0, state.totalDays - 1)), 0, Math.max(0, state.totalDays - 1));
}

async function jumpToIndex(index, behavior = 'auto') {
  const isoDate = state.indexToDate[index];
  if (!isoDate) return;
  await goHome({ push: false });
  await scrollToDate(isoDate, behavior);
}

async function queueScrollHandleJump(index) {
  state.scrollPreviewIndex = index;
  syncScrollThumb();
  state.scrollHandleQueuedIndex = index;
  if (state.scrollHandleBusy) return;
  state.scrollHandleBusy = true;
  const run = async () => {
    const next = state.scrollHandleQueuedIndex;
    state.scrollHandleQueuedIndex = null;
    if (next === null || next === undefined) {
      state.scrollHandleBusy = false;
      return;
    }
    await jumpToIndex(next, 'auto');
    window.setTimeout(run, 120);
  };
  run().catch(() => {
    state.scrollHandleBusy = false;
  });
}

function updateHistoryScrollY() {
  if (!history.state || state.route.view !== 'home') return;
  const nextState = { ...history.state, scrollY: window.scrollY };
  history.replaceState(nextState, '', location.href);
}

function stopViewerMomentum() {
  if (state.viewerMomentumFrame) {
    cancelAnimationFrame(state.viewerMomentumFrame);
    state.viewerMomentumFrame = null;
  }
}

function startViewerMomentum() {
  stopViewerMomentum();
  const step = () => {
    state.viewerVelocityX *= 0.92;
    state.viewerVelocityY *= 0.92;
    if (Math.abs(state.viewerVelocityX) < 0.08 && Math.abs(state.viewerVelocityY) < 0.08) {
      state.viewerVelocityX = 0;
      state.viewerVelocityY = 0;
      state.viewerMomentumFrame = null;
      return;
    }
    state.viewerPanX += state.viewerVelocityX;
    state.viewerPanY += state.viewerVelocityY;
    updateViewerTransform();
    state.viewerMomentumFrame = requestAnimationFrame(step);
  };
  state.viewerMomentumFrame = requestAnimationFrame(step);
}

function resetViewerTransform() {
  stopViewerMomentum();
  state.viewerZoom = 1;
  state.viewerPanX = 0;
  state.viewerPanY = 0;
  state.viewerVelocityX = 0;
  state.viewerVelocityY = 0;
  updateViewerTransform();
}

function activeViewerNode() {
  return dom.viewerImage.classList.contains('hidden') ? dom.viewerVideo : dom.viewerImage;
}

function getViewerBaseSize() {
  const stageRect = dom.viewerStage.getBoundingClientRect();
  const node = activeViewerNode();
  const naturalWidth = node.videoWidth || node.naturalWidth || node.clientWidth || 1;
  const naturalHeight = node.videoHeight || node.naturalHeight || node.clientHeight || 1;
  const scale = Math.min(stageRect.width / naturalWidth, stageRect.height / naturalHeight, 1);
  return {
    stageWidth: stageRect.width,
    stageHeight: stageRect.height,
    fittedWidth: naturalWidth * scale,
    fittedHeight: naturalHeight * scale
  };
}

function updateViewerLoadingPosition() {
  if (!dom.viewerLoading || dom.viewerLoading.classList.contains('hidden')) return;
  const node = activeViewerNode();
  const stageRect = dom.viewerStage.getBoundingClientRect();
  const naturalWidth = node.videoWidth || node.naturalWidth || node.clientWidth || 0;
  const naturalHeight = node.videoHeight || node.naturalHeight || node.clientHeight || 0;
  if (!naturalWidth || !naturalHeight || !stageRect.width || !stageRect.height) {
    dom.viewerLoading.style.right = '14px';
    dom.viewerLoading.style.bottom = '14px';
    return;
  }
  const scale = Math.min(stageRect.width / naturalWidth, stageRect.height / naturalHeight, 1);
  const fittedWidth = naturalWidth * scale;
  const fittedHeight = naturalHeight * scale;
  const insetX = Math.max(0, (stageRect.width - fittedWidth) / 2);
  const insetY = Math.max(0, (stageRect.height - fittedHeight) / 2);
  dom.viewerLoading.style.right = `${Math.max(10, insetX + 10)}px`;
  dom.viewerLoading.style.bottom = `${Math.max(10, insetY + 10)}px`;
}

function updateViewerTransform() {
  const node = activeViewerNode();
  const isVisible = !node.classList.contains('hidden');
  if (!isVisible) {
    dom.viewerZoomReset.textContent = '100%';
    dom.viewerCanvas.classList.remove('is-pannable', 'is-panning');
    return;
  }

  const base = getViewerBaseSize();
  const mobileDetails = state.viewerDetailsOpen && window.innerWidth <= 900;
  const detailScale = mobileDetails ? 1.14 : 1;
  const detailShiftX = 0;
  const detailShiftY = mobileDetails ? -64 : 0;
  const effectiveZoom = state.viewerZoom * detailScale;
  const maxPanX = Math.max(0, (base.fittedWidth * effectiveZoom - base.stageWidth) / 2);
  const maxPanY = Math.max(0, (base.fittedHeight * effectiveZoom - base.stageHeight) / 2);
  state.viewerPanX = clamp(state.viewerPanX, -maxPanX, maxPanX);
  state.viewerPanY = clamp(state.viewerPanY, -maxPanY, maxPanY);
  dom.viewerCanvas.style.transform = `translate3d(${state.viewerPanX + detailShiftX}px, ${state.viewerPanY + detailShiftY}px, 0) scale(${effectiveZoom})`;
  dom.viewerZoomReset.textContent = `${Math.round(state.viewerZoom * 100)}%`;
  updateViewerLoadingPosition();
  dom.viewerCanvas.classList.toggle('is-pannable', state.viewerZoom > 1.01);
}

function setViewerZoom(nextZoom, origin = null) {
  stopViewerMomentum();
  const previousZoom = state.viewerZoom;
  const clamped = clamp(nextZoom, 1, 6);
  if (origin && previousZoom > 0) {
    const stageRect = dom.viewerStage.getBoundingClientRect();
    const ox = origin.clientX - stageRect.left - stageRect.width / 2;
    const oy = origin.clientY - stageRect.top - stageRect.height / 2;
    const ratio = clamped / previousZoom;
    state.viewerPanX = (state.viewerPanX - ox) * ratio + ox;
    state.viewerPanY = (state.viewerPanY - oy) * ratio + oy;
  }
  state.viewerZoom = clamped;
  if (state.viewerZoom === 1) {
    state.viewerPanX = 0;
    state.viewerPanY = 0;
  }
  updateViewerTransform();
}

function currentViewerItem() {
  return mediaViewer.getCurrentItem();
}

function renderViewerDetails(item) {
  if (!dom.viewerDetailsMeta || !item) return;
  const folderText = `${item.folderRootLabel || ''}${item.folder && item.folder !== '.' ? ` / ${item.folder}` : ''}`.trim() || '—';
  const rows = [
    ['File', item.fileName || '—'],
    ['Type', item.type === 'video' ? 'Video' : 'Photo'],
    ['Date', item.capturedAt ? new Date(item.capturedAt).toLocaleString() : '—'],
    ['Source', item.dateSource || '—'],
    ['Folder', folderText],
    ['Tags', Array.isArray(item.tags) && item.tags.length ? item.tags.join(', ') : '—'],
    ['Size', formatFileSize(item.size) || '—']
  ];
  dom.viewerDetailsMeta.innerHTML = rows.map(([label, value]) => `<div class="viewer-meta-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value || '—'))}</strong></div>`).join('');
  if (dom.viewerTagsInput) dom.viewerTagsInput.value = Array.isArray(item.tags) ? item.tags.join(', ') : '';
  if (dom.viewerDescriptionInput) {
    dom.viewerDescriptionInput.value = item.description || '';
    state.viewerDescriptionDirty = false;
  }
}

function syncViewerMediaMutation(photoId, mutator) {
  state.loadedDays.forEach((day) => day.photos.forEach((photo) => {
    if (photo.id === photoId) mutator(photo);
  }));
  state.viewerSequence.forEach((photo) => {
    if (photo.id === photoId) mutator(photo);
  });
}

async function saveViewerTags() {
  const item = currentViewerItem();
  if (!item) return;
  const tags = (dom.viewerTagsInput?.value || '').split(',').map((part) => part.trim()).filter(Boolean);
  const payload = await fetchJson(`/api/media/${item.id}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags })
  });
  item.tags = payload.tags || [];
  syncViewerMediaMutation(item.id, (photo) => { photo.tags = item.tags; });
  renderViewerDetails(item);
}

async function saveViewerDescriptionIfNeeded() {
  await mediaViewer.saveDescriptionIfNeeded();
}

function showViewerDateToast(text) {
  if (!dom.viewerDateToast || !text) return;
  dom.viewerDateToast.textContent = text;
  dom.viewerDateToast.classList.add('show');
  if (state.viewerDateToastTimer) window.clearTimeout(state.viewerDateToastTimer);
  state.viewerDateToastTimer = window.setTimeout(() => {
    dom.viewerDateToast?.classList.remove('show');
  }, 2400);
}

function setViewerDetails(open) {
  state.viewerDetailsOpen = Boolean(open);
  dom.viewerDetails?.classList.toggle('open', state.viewerDetailsOpen);
  dom.photoViewer?.classList.toggle('details-open', state.viewerDetailsOpen);
  dom.viewerInfoToggle?.classList.toggle('is-active', state.viewerDetailsOpen);
  dom.viewerCanvas?.classList.add('details-transitioning');
  window.setTimeout(() => dom.viewerCanvas?.classList.remove('details-transitioning'), 320);
  updateViewerTransform();
}

function closeViewer({ fromHistory = false } = {}) {
  if (!fromHistory && history.state?.viewer) {
    history.back();
    return;
  }
  mediaViewer.close();
}

function openViewerById(mediaId, { pushHistory = true } = {}) {
  const index = state.viewerSequence.findIndex((item) => item.id === mediaId);
  if (index === -1) return;
  mediaViewer.open(index, { forceDateToast: true });
  if (pushHistory) {
    const base = history.state && !history.state.viewer ? history.state : { ...state.route };
    history.pushState({ ...base, viewer: true, viewerMediaId: mediaId }, '', location.href);
  }
}

function playViewerStepAnimation(direction) {
  const node = activeViewerNode();
  if (!node) return;
  node.classList.remove('slide-next', 'slide-prev');
  void node.offsetWidth;
  node.classList.add(direction > 0 ? 'slide-next' : 'slide-prev');
  window.setTimeout(() => node.classList.remove('slide-next', 'slide-prev'), 200);
}

function renderViewerItem(direction = 0, { forceDateToast = false } = {}) {
  const item = state.viewerSequence[state.viewerIndex];
  if (!item) return;
  if (history.state?.viewer) {
    history.replaceState({ ...history.state, viewerMediaId: item.id }, '', location.href);
  }
  renderViewerDetails(item);
  if (forceDateToast || item.isoDate !== state.viewerLastShownDate) {
    showViewerDateToast(item.dateLabel || item.isoDate || '');
    state.viewerLastShownDate = item.isoDate || '';
  }

  state.viewerLoadToken += 1;
  const token = state.viewerLoadToken;
  state.viewerPointers.clear();
  state.viewerPanOrigin = null;
  state.viewerPinchStartDistance = null;
  state.viewerSwipeStart = null;
  stopViewerMomentum();
  state.viewerVelocityX = 0;
  state.viewerVelocityY = 0;
  resetViewerTransform();
  dom.viewerLoading.classList.remove('hidden');
  dom.viewerLoading.style.right = '14px';
  dom.viewerLoading.style.bottom = '14px';

  dom.viewerImage.classList.add('hidden');
  dom.viewerVideo.classList.add('hidden');

  if (item.type === 'video') {
    dom.viewerVideo.classList.remove('hidden');
    dom.viewerVideo.poster = item.thumbUrl;
    dom.viewerVideo.src = item.fullUrl;
    dom.viewerVideo.load();
    dom.viewerVideo.addEventListener('loadeddata', () => {
      if (token !== state.viewerLoadToken) return;
      dom.viewerLoading.classList.add('hidden');
      updateViewerTransform();
    }, { once: true });
  } else {
    dom.viewerImage.classList.remove('hidden');
    dom.viewerImage.alt = item.fileName;
    dom.viewerImage.src = item.thumbUrl;

    const fullImage = new Image();
    fullImage.onload = () => {
      if (token !== state.viewerLoadToken) return;
      dom.viewerImage.src = item.fullUrl;
      dom.viewerLoading.classList.add('hidden');
      updateViewerTransform();
    };
    fullImage.onerror = () => {
      if (token !== state.viewerLoadToken) return;
      dom.viewerLoading.classList.add('hidden');
    };
    fullImage.src = item.fullUrl;
    requestAnimationFrame(() => { updateViewerTransform(); updateViewerLoadingPosition(); });
  }

  if (direction) playViewerStepAnimation(direction);
}

async function stepViewer(direction) {
  await mediaViewer.step(direction);
}

function getPointerDistance() {
  const points = Array.from(state.viewerPointers.values());
  if (points.length < 2) return 0;
  const [a, b] = points;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function getPointerCenter() {
  const points = Array.from(state.viewerPointers.values());
  if (points.length < 2) return null;
  const [a, b] = points;
  return { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 };
}

function handleJournalToggle(isoDate) {
  const wasExpanded = state.expandedDates.has(isoDate);
  const block = document.querySelector(`[data-day-date="${isoDate}"]`);
  const collapseButton = block?.querySelector('[data-journal-toggle]');
  const previousToggleTop = collapseButton ? collapseButton.getBoundingClientRect().top : null;
  if (wasExpanded) state.expandedDates.delete(isoDate);
  else state.expandedDates.add(isoDate);
  renderTimeline();
  requestAnimationFrame(() => {
    const nextBlock = document.querySelector(`[data-day-date="${isoDate}"]`);
    if (!nextBlock) return;
    if (wasExpanded) {
      const nextButton = nextBlock.querySelector('[data-journal-toggle]');
      if (!nextButton || previousToggleTop === null) return;
      const nextTop = nextButton.getBoundingClientRect().top;
      window.scrollBy({ top: nextTop - previousToggleTop, behavior: 'auto' });
      return;
    }
    return;
  });
}

async function runSearch(query) {
  const term = String(query || '').trim();
  state.searchQuery = term;
  state.scrollPreviewIndex = null;
  state.scrollHandleQueuedIndex = null;
  state.scrollHandleBusy = false;
  dom.clearSearch.classList.toggle('hidden', !term);
  if (!term) {
    state.searchMode = false;
    dom.yearCarouselShell?.classList.remove('hidden');
    if (dom.yearSectionTitle) dom.yearSectionTitle.textContent = 'Browse your years';
    if (dom.yearSectionSubtitle) dom.yearSectionSubtitle.textContent = 'Start broad, then drop into a month, a day, or straight into the timeline.';
    await goHome({ push: false, restoreScroll: false });
    await ensureTimelineLoaded(state.bootstrap?.lastDate);
    renderTimeline();
    requestAnimationFrame(() => {
      updateActiveFromScroll();
      syncScrollThumb();
    });
    return;
  }

  const response = await fetchJson(`/api/search?q=${encodeURIComponent(term)}`);
  await goHome({ push: false, restoreScroll: false });
  state.searchMode = true;
  dom.yearCarouselShell?.classList.add('hidden');
  if (dom.yearSectionTitle) dom.yearSectionTitle.textContent = `Search results for ${term}`;
  if (dom.yearSectionSubtitle) dom.yearSectionSubtitle.textContent = `${response.total} matching days`;
  state.loadedDays = response.days;
  state.loadedStart = null;
  state.loadedEnd = null;
  state.activeDate = response.days[0]?.isoDate || null;
  renderTimeline();
  window.scrollTo({ top: dom.timelineSection.getBoundingClientRect().top + window.scrollY - topOffset(), behavior: 'auto' });
  requestAnimationFrame(() => {
    updateActiveFromScroll();
    syncScrollThumb();
    showScrollHandle();
  });
}

async function getYearData(year) {
  if (state.yearCache.has(year)) return state.yearCache.get(year);
  const payload = await fetchJson(`/api/year/${year}`);
  state.yearCache.set(year, payload);
  return payload;
}

async function getMonthData(monthKey) {
  if (state.monthCache.has(monthKey)) return state.monthCache.get(monthKey);
  const payload = await fetchJson(`/api/month/${monthKey}`);
  state.monthCache.set(monthKey, payload);
  return payload;
}

function monthCardHtml(month) {
  const journalOnly = !month.photoCount && month.journalCount > 0;
  return `
    <button class="explorer-card month-card-grid ${journalOnly ? 'is-journal-only' : ''}" type="button" data-month-key="${month.key}" data-year="${month.year}">
      ${createCoverHtml(month.coverUrls, { journalOnly })}
      <div class="card-content ${journalOnly ? 'card-content-solid' : ''}">
        <div class="card-title">${escapeHtml(month.label)}</div>
        <div class="card-stats">${month.journalCount} entries${month.photoCount ? ` · ${month.photoCount} media` : ''}</div>
      </div>
    </button>
  `;
}

function dayCardHtml(day, monthKey, year) {
  const thumbs = day.previewThumbs || [];
  const journalOnly = !day.photoCount && day.hasJournal;
  const cover = thumbs.length
    ? (thumbs.length === 1
      ? `<div class="cover-single"><img src="${thumbs[0].thumbUrl}" alt="" loading="lazy" fetchpriority="low" decoding="async" /></div>`
      : `<div class="cover-collage count-${thumbs.length}">${thumbs.map((thumb) => `<div class="${thumb.type === 'video' ? 'is-video' : ''}"><img src="${thumb.thumbUrl}" alt="" loading="lazy" fetchpriority="low" decoding="async" /></div>`).join('')}</div>`)
    : createCoverHtml([], { journalOnly: true });
  const addButton = !day.hasJournal && day.photoCount
    ? `<button class="day-card-add icon-button" type="button" data-create-entry-date="${day.isoDate}" aria-label="Add entry"><i class="fa-solid fa-pen"></i></button>`
    : '';

  return `
    <button class="explorer-card day-card ${journalOnly ? 'is-journal-only' : ''}" type="button" data-day-date="${day.isoDate}" data-month-key="${monthKey}" data-year="${year}">
      ${cover}
      ${addButton}
      <div class="card-content day-card-content ${journalOnly ? 'card-content-solid' : ''}">
        <div class="card-title">${escapeHtml(day.dateLabel || dateRailLabel(day.isoDate) || day.isoDate)}</div>
        <div class="day-card-meta">
          ${day.hasJournal ? '<span class="text-pill" aria-label="Has journal entry"><i class="fa-regular fa-note-sticky"></i></span>' : ''}
          <span>${day.photoCount ? `${day.photoCount} media` : `${day.hasJournal ? '1 Entry' : 'Open day'}`}</span>
        </div>
      </div>
    </button>
  `;
}

function showHomeView() {
  dom.homeView.classList.remove('hidden');
  dom.explorerView.classList.add('hidden');
  dom.body.classList.remove('explorer-open');
  if (!state.searchMode) dom.yearCarouselShell?.classList.remove('hidden');
}

function showExplorerView() {
  dom.explorerView.classList.remove('hidden');
  dom.homeView.classList.add('hidden');
  dom.body.classList.add('explorer-open');
  window.scrollTo({ top: 0, behavior: 'auto' });
}

async function openYearView(year, { push = true } = {}) {
  state.homeScrollY = window.scrollY;
  const payload = await getYearData(year);
  dom.explorerTitle.textContent = `${payload.year}`;
  dom.explorerSubtitle.textContent = 'Choose a month';
  dom.explorerGrid.className = 'explorer-grid months-grid';
  dom.explorerGrid.innerHTML = payload.months.map(monthCardHtml).join('');
  showExplorerView();
  if (push) history.pushState({ view: 'year', year, homeScrollY: state.homeScrollY }, '', `#year-${year}`);
  state.route = { view: 'year', year, homeScrollY: state.homeScrollY };
}

async function openMonthView(monthKey, year, { push = true } = {}) {
  state.homeScrollY = window.scrollY;
  const payload = await getMonthData(monthKey);
  dom.explorerTitle.textContent = payload.label;
  dom.explorerSubtitle.textContent = 'Choose a day';
  dom.explorerGrid.className = 'explorer-grid days-grid';
  dom.explorerGrid.innerHTML = payload.days.map((day) => dayCardHtml(day, monthKey, year)).join('');
  showExplorerView();
  if (push) history.pushState({ view: 'month', monthKey, year, homeScrollY: state.homeScrollY }, '', `#month-${monthKey}`);
  state.route = { view: 'month', monthKey, year, homeScrollY: state.homeScrollY };
}

async function goHome({ push = false, focusDate = null, restoreScroll = true, scrollY = null } = {}) {
  showHomeView();
  const nextScrollY = scrollY ?? state.homeScrollY ?? 0;
  state.route = { view: 'home', scrollY: nextScrollY, focusDate };
  if (push) history.pushState({ view: 'home', scrollY: nextScrollY, focusDate }, '', focusDate ? `#day-${focusDate}` : '#');
  if (focusDate) {
    await scrollToDate(focusDate, 'auto');
  } else if (restoreScroll) {
    if (nextScrollY <= 8 && state.bootstrap?.lastDate) {
      await ensureTimelineContainsDate(state.bootstrap.lastDate, 'top');
    }
    window.scrollTo({ top: nextScrollY, behavior: 'auto' });
  }
}

async function routeToState(route, { fromPop = false } = {}) {
  if (!route || route.view === 'home') {
    await goHome({ push: false, focusDate: route?.focusDate || null, restoreScroll: !route?.focusDate, scrollY: route?.scrollY || 0 });
    return;
  }
  if (route.view === 'year') {
    await openYearView(route.year, { push: false });
    return;
  }
  if (route.view === 'month') {
    await openMonthView(route.monthKey, route.year, { push: false });
    return;
  }
  if (!fromPop) await goHome({ push: false });
}

function showScrollTopButton() {
  dom.scrollTopButton.classList.toggle('visible', window.scrollY > 640);
}

function attachEvents() {
  let timelineWheelDelta = 0;
  let timelineWheelResetTimer = 0;

  const queueTimelineWheelReset = () => {
    if (timelineWheelResetTimer) window.clearTimeout(timelineWheelResetTimer);
    timelineWheelResetTimer = window.setTimeout(() => {
      timelineWheelDelta = 0;
      timelineWheelResetTimer = 0;
    }, 180);
  };

  async function goToNewestTop() {
    await goHome({ push: true, restoreScroll: false });
    await ensureTimelineContainsDate(state.bootstrap?.lastDate, 'top');
    window.scrollTo({ top: 0, behavior: 'auto' });
    updateActiveFromScroll();
    syncScrollThumb();
  }

  function updateMobileTopbar(forceEvaluate = false) {
    if (!isMobileViewport()) {
      state.topbarHidden = false;
      dom.body.classList.remove('topbar-hidden');
      return;
    }
    const y = window.scrollY;
    if (forceEvaluate) state.mobileTopbarAnchorY = y;
    const delta = y - state.mobileTopbarAnchorY;
    if (y < 24) {
      state.mobileTopbarAnchorY = y;
      state.topbarHidden = false;
    } else if (delta > 100) {
      state.mobileTopbarAnchorY = y;
      state.topbarHidden = true;
    } else if (delta < -100) {
      state.mobileTopbarAnchorY = y;
      state.topbarHidden = false;
    }
    dom.body.classList.toggle('topbar-hidden', state.topbarHidden);
  }

  dom.homeButton.addEventListener('click', () => {
    goToNewestTop().catch(console.error);
  });

  const openTodayEditor = () => { window.location.href = getTodayEntryHref(); };
  dom.todayEntryCard?.addEventListener('click', (event) => {
    if (event.target.closest('.open-media')) return;
    openTodayEditor();
  });
  dom.todayEntryCard?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('.open-media')) return;
    event.preventDefault();
    openTodayEditor();
  });
  dom.uploadTopbarButton?.addEventListener('click', triggerTopbarUpload);
  dom.searchToggleButton?.addEventListener('click', openSearchBar);
  dom.searchCloseButton?.addEventListener('click', () => {
    closeSearchBar({ clear: true }).catch(console.error);
  });
  dom.settingsButton.addEventListener('click', openSettings);
  dom.settingsCloseButton.addEventListener('click', closeSettings);
  dom.settingsModal.querySelector('.settings-backdrop').addEventListener('click', closeSettings);
  dom.settingsHomeButton?.addEventListener('click', () => {
    closeSettings();
    goToNewestTop().catch(console.error);
  });
  dom.settingsTodayButton?.addEventListener('click', () => {
    closeSettings();
    openTodayEditor();
  });
  dom.settingsUploadButton?.addEventListener('click', () => {
    closeSettings();
    triggerTopbarUpload();
  });
  dom.themeLight.addEventListener('click', () => setThemeChoice('light'));
  dom.themeDark.addEventListener('click', () => setThemeChoice('dark'));
  dom.logoutButton?.addEventListener('click', async () => {
    try {
      await fetchJson('/auth/logout', { method: 'POST' });
    } catch (error) {
      // redirect below even if the session already expired
    }
    window.location.href = '/login';
  });

  dom.yearBackButton.addEventListener('click', () => {
    dom.yearCarousel.scrollBy({ left: -dom.yearCarousel.clientWidth, behavior: 'smooth' });
  });
  dom.yearNextButton.addEventListener('click', () => {
    dom.yearCarousel.scrollBy({ left: dom.yearCarousel.clientWidth, behavior: 'smooth' });
  });

  dom.yearCarousel.addEventListener('click', (event) => {
    const card = event.target.closest('[data-year]');
    if (!card) return;
    card.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.035)', opacity: 0.9 }], { duration: 140, easing: 'ease-out' });
    window.setTimeout(() => {
      openYearView(Number(card.dataset.year)).catch(console.error);
    }, 90);
  });

  dom.explorerBackButton.addEventListener('click', () => history.back());

  dom.explorerGrid.addEventListener('click', (event) => {
    const addEntry = event.target.closest('[data-create-entry-date]');
    if (addEntry) {
      event.preventDefault();
      event.stopPropagation();
      window.location.href = `/edit/${addEntry.dataset.createEntryDate}?create=1`;
      return;
    }
    const monthCard = event.target.closest('[data-month-key]');
    if (monthCard && !monthCard.dataset.dayDate) {
      monthCard.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.03)', opacity: 0.92 }], { duration: 140, easing: 'ease-out' });
      window.setTimeout(() => {
        openMonthView(monthCard.dataset.monthKey, Number(monthCard.dataset.year)).catch(console.error);
      }, 90);
      return;
    }
    const dayCard = event.target.closest('.day-card');
    if (dayCard) {
      dayCard.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.03)', opacity: 0.92 }], { duration: 140, easing: 'ease-out' });
      window.setTimeout(() => {
        goHome({ push: true, focusDate: dayCard.dataset.dayDate, restoreScroll: false }).catch(console.error);
      }, 90);
    }
  });

  dom.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch(dom.searchInput.value).catch(console.error);
  });
  dom.searchInput.addEventListener('input', () => {
    dom.clearSearch.classList.toggle('hidden', !dom.searchInput.value.trim());
    window.clearTimeout(state.searchInputTimer);
    state.searchInputTimer = window.setTimeout(() => {
      runSearch(dom.searchInput.value).catch(console.error);
    }, 180);
  });
  dom.searchInput.addEventListener('search', () => runSearch(dom.searchInput.value).catch(console.error));
  dom.clearSearch.addEventListener('click', () => {
    dom.searchInput.value = '';
    runSearch('').catch(console.error);
    dom.searchInput.focus();
  });

  dom.uploadClose?.addEventListener('click', closeUploadModal);
  dom.uploadBackdrop?.addEventListener('click', closeUploadModal);
  dom.uploadFolderButton?.addEventListener('click', () => {
    dom.uploadFolderTree?.classList.toggle('is-open');
  });
  dom.uploadNewFolder?.addEventListener('click', () => {
    promptNewUploadFolder();
  });
  dom.uploadSetExifDate?.addEventListener('change', renderUploadPreviews);
  dom.uploadCancel?.addEventListener('click', cancelUploadMedia);
  dom.uploadAddFiles?.addEventListener('click', () => {
    dom.uploadFileInput?.click();
  });
  dom.uploadFileInput?.addEventListener('change', () => {
    const files = Array.from(dom.uploadFileInput.files || []);
    if (!files.length || !state.uploadContext) return;
    state.uploadProgressRatio = 0;
    dom.uploadSubmit?.style.setProperty('--upload-progress', '0%');
    setUploadPreparing(true);
    openUploadModal(state.uploadContext.isoDate)
      .then(() => nextFrame())
      .then(async () => {
        await appendUploadFiles(files);
      })
      .catch(console.error)
      .finally(() => {
        setUploadPreparing(false);
        updateUploadUiState();
        if (dom.uploadFileInput) dom.uploadFileInput.value = '';
      });
  });
  dom.uploadResume?.addEventListener('click', () => {
    if (state.uploadContext) openUploadModal(state.uploadContext.isoDate).catch(console.error);
  });
  dom.uploadFolderTree?.addEventListener('click', (event) => {
    const confirm = event.target.closest('.upload-folder-confirm');
    if (confirm) {
      event.preventDefault();
      commitNewUploadFolder().catch(console.error);
      return;
    }
    const item = event.target.closest('[data-upload-root]');
    if (!item) return;
    setUploadTarget(item.dataset.uploadRoot, item.dataset.uploadPath || '');
  });
  dom.uploadPreviewList?.addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-upload-remove]');
    if (!removeButton) return;
    removeUploadFile(removeButton.dataset.uploadRemove);
  });
  dom.uploadFolderTree?.addEventListener('input', (event) => {
    if (event.target?.id === 'uploadNewFolderInput' && state.uploadCreatingFolder) {
      state.uploadCreatingFolder.name = event.target.value;
    }
  });
  dom.uploadFolderTree?.addEventListener('keydown', (event) => {
    if (event.target?.id !== 'uploadNewFolderInput') return;
    if (event.key === 'Enter') {
      event.preventDefault();
      commitNewUploadFolder().catch(console.error);
    } else if (event.key === 'Escape') {
      state.uploadCreatingFolder = null;
      renderUploadFolderTree();
    }
  });
  dom.uploadSubmit?.addEventListener('click', uploadMediaFiles);


  document.addEventListener('click', (event) => {
    const mediaButton = event.target.closest('.open-media');
    if (mediaButton) {
      openViewerById(mediaButton.dataset.mediaId);
      return;
    }
    const toggle = event.target.closest('[data-journal-toggle]');
    if (toggle) { handleJournalToggle(toggle.dataset.journalToggle); return; }
    const edit = event.target.closest('[data-edit-date]');
    if (edit) {
      event.preventDefault();
      window.location.href = `/edit/${edit.dataset.editDate}`;
      return;
    }
    const createEntry = event.target.closest('[data-create-entry-date]');
    if (createEntry) {
      event.preventDefault();
      window.location.href = `/edit/${createEntry.dataset.createEntryDate}?create=1`;
      return;
    }
    const uploadTrigger = event.target.closest('[data-upload-date]');
    if (uploadTrigger) {
      event.preventDefault();
      beginUploadSelection(uploadTrigger.dataset.uploadDate);
    }
  });

  let scrollRaf = 0;
  window.addEventListener('scroll', () => {
    showScrollHandle();
    showScrollTopButton();
    updateMobileTopbar();
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      updateActiveFromScroll();
      syncScrollThumb();
      updateHistoryScrollY();
    });
  }, { passive: true });

  dom.scrollTopButton.addEventListener('click', () => {
    goToNewestTop().catch(console.error);
  });

  dom.scrollHandle.addEventListener('mouseenter', showScrollHandle);
  dom.scrollHandle.addEventListener('mousemove', showScrollHandle);
  dom.scrollGrabber.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); });

  dom.scrollGrabber.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    state.scrollHandleDragging = true;
    dom.scrollHandle.classList.add('is-dragging');
    dom.scrollYearMarks?.classList.add('visible');
    state.scrollPreviewIndex = indexFromHandleDrag(event.clientY);
    syncScrollThumb();
    dom.scrollGrabber.setPointerCapture(event.pointerId);
    showScrollHandle();
  });
  dom.scrollGrabber.addEventListener('pointermove', (event) => {
    if (!state.scrollHandleDragging) return;
    event.preventDefault();
    const index = indexFromHandleDrag(event.clientY);
    state.scrollPreviewIndex = index;
    syncScrollThumb();
    queueScrollHandleJump(index).catch(console.error);
    showScrollHandle();
  });
  const stopScrollDrag = (event) => {
    if (!state.scrollHandleDragging) return;
    state.scrollHandleDragging = false;
    dom.scrollHandle.classList.remove('is-dragging');
    dom.scrollYearMarks?.classList.remove('visible');
    try { dom.scrollGrabber.releasePointerCapture(event.pointerId); } catch (error) {}
    const finalIndex = state.scrollPreviewIndex;
    state.scrollPreviewIndex = null;
    syncScrollThumb();
    if (finalIndex !== null && finalIndex !== undefined) queueScrollHandleJump(finalIndex).catch(console.error);
    showScrollHandle();
  };
  dom.scrollGrabber.addEventListener('pointerup', stopScrollDrag);
  dom.scrollGrabber.addEventListener('pointercancel', stopScrollDrag);

  document.addEventListener('keydown', (event) => {
    if (mediaViewer.isOpen()) return;
    if (event.key === 'Escape' && state.settingsOpen) { closeSettings(); return; }
    if (event.key === 'Escape' && state.searchUiOpen) {
      closeSearchBar({ clear: true }).catch(console.error);
    }
  });

  window.addEventListener('resize', () => {
    applyGridColumns(state.gridColumns || gridColumnBounds().base);
    renderScrollYearMarks();
    syncScrollThumb();
    updateActiveFromScroll();
    updateMobileTopbar(false);
  });

  dom.timelinePane.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    const deltaY = normalizeWheelDelta(event);
    if (!deltaY) return;
    if (event.cancelable) event.preventDefault();
    queueTimelineWheelReset();
    timelineWheelDelta += deltaY;
    const stepSize = 72;
    while (Math.abs(timelineWheelDelta) >= stepSize) {
      const direction = Math.sign(timelineWheelDelta);
      const changed = stepGridColumns(direction);
      timelineWheelDelta -= stepSize * direction;
      if (!changed) {
        timelineWheelDelta = 0;
        break;
      }
    }
  }, { passive: false });

  dom.timelinePane.addEventListener('pointerdown', (event) => {
    if (!isCoarsePointer()) return;
    state.timelinePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    if (state.timelinePointers.size === 2) {
      const points = Array.from(state.timelinePointers.values());
      state.timelinePinchStartDistance = Math.hypot(points[0].clientX - points[1].clientX, points[0].clientY - points[1].clientY);
      state.timelinePinchStartColumns = state.gridColumns || gridColumnBounds().base;
      if (event.cancelable) event.preventDefault();
    }
  });
  dom.timelinePane.addEventListener('pointermove', (event) => {
    if (!state.timelinePointers.has(event.pointerId)) return;
    state.timelinePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    if (state.timelinePointers.size !== 2 || !state.timelinePinchStartDistance) return;
    if (event.cancelable) event.preventDefault();
    const points = Array.from(state.timelinePointers.values());
    const distance = Math.hypot(points[0].clientX - points[1].clientX, points[0].clientY - points[1].clientY);
    const ratio = distance / state.timelinePinchStartDistance;
    const bounds = gridColumnBounds();
    const start = state.timelinePinchStartColumns || bounds.base;
    const delta = Math.round((1 - ratio) * 4);
    setGridColumns(clamp(start + delta, bounds.min, bounds.max));
  });
  const endTimelinePinch = (event) => {
    state.timelinePointers.delete(event.pointerId);
    if (state.timelinePointers.size < 2) {
      state.timelinePinchStartDistance = null;
      state.timelinePinchStartColumns = state.gridColumns || gridColumnBounds().base;
    }
  };
  dom.timelinePane.addEventListener('pointerup', endTimelinePinch);
  dom.timelinePane.addEventListener('pointercancel', endTimelinePinch);

  window.addEventListener('popstate', (event) => {
    const nextState = event.state || { view: 'home', scrollY: 0 };
    if (!dom.photoViewer.classList.contains('hidden')) {
      closeViewer({ fromHistory: true });
      return;
    }
    if (nextState.viewer) {
      openViewerById(nextState.viewerMediaId, { pushHistory: false });
      return;
    }
    routeToState(nextState, { fromPop: true }).catch(console.error);
  });
}

function parseInitialRoute() {
  const url = new URL(window.location.href);
  const focusDate = url.searchParams.get('focus') || sessionStorage.getItem('lifeserver-focus-date') || '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(focusDate)) {
    sessionStorage.removeItem('lifeserver-focus-date');
    return { view: 'home', scrollY: 0, focusDate };
  }
  const hash = window.location.hash || '';
  const dayMatch = hash.match(/^#day-(\d{4}-\d{2}-\d{2})$/);
  if (dayMatch) return { view: 'home', scrollY: 0, focusDate: dayMatch[1] };
  const monthMatch = hash.match(/^#month-([\d-]{7})$/);
  if (monthMatch) return { view: 'month', monthKey: monthMatch[1], year: Number(monthMatch[1].slice(0, 4)) };
  const yearMatch = hash.match(/^#year-(\d{4})$/);
  if (yearMatch) return { view: 'year', year: Number(yearMatch[1]) };
  return { view: 'home', scrollY: 0 };
}

async function bootstrapApp() {
  applyTheme(state.theme);
  applyGridColumns(state.gridColumns || gridColumnBounds().base);
  state.bootstrap = await fetchJson('/api/bootstrap');
  state.totalDays = state.bootstrap.totalDays;
  state.mobileTopbarAnchorY = 0;
  syncTopbarSearchState();
  updateTopbarDateLabel();
  renderTodayEntryCard();
  renderYearCarousel();
  renderRail();
  renderScrollYearMarks();
  attachEvents();
  await ensureTimelineLoaded(state.bootstrap.lastDate);
  renderTimeline();
  showScrollHandle();
  showScrollTopButton();

  const initialState = history.state || parseInitialRoute();
  history.replaceState(initialState, '', location.href || '#');
  await routeToState(initialState);
  updateActiveFromScroll();
  syncScrollThumb();
}


bootstrapApp().catch((error) => {
  console.error(error);
  dom.timelineFeed.innerHTML = `
    <div class="empty-state">
      <h2>LifeServer could not start</h2>
      <p>${escapeHtml(error.message || 'Unknown startup error')}</p>
    </div>
  `;
});
