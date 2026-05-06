const requestIdle = window.requestIdleCallback || function requestIdleFallback(callback) {
  return window.setTimeout(() => callback({ timeRemaining: () => 10 }), 120);
};

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

const renderPhIcon = window.renderPhIcon || function renderFallbackIcon(name, { variant = 'regular', className = '', spin = false } = {}) {
  const family = variant === 'fill'
    ? 'ph-fill'
    : variant === 'duotone'
      ? 'ph-duotone'
      : variant === 'bold'
        ? 'ph-bold'
        : 'ph';
  const classes = [family, `ph-${name}`];
  if (className) classes.push(className);
  if (spin) classes.push('is-spinning');
  return `<i class="${classes.join(' ')}" aria-hidden="true"></i>`;
};

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
  homeSourceDays: [],
  homeSourceIndexByDate: {},
  homeSourceStartIndex: 0,
  homeSourceEndIndex: -1,
  searchResultDays: [],
  searchResultIndexByDate: {},
  fullTimelineDays: [],
  fullTimelineLoaded: false,
  fullTimelinePromise: null,
  fullTimelineError: '',
  timelineBooting: true,
  timelineCaching: false,
  loadedDays: [],
  loadedStart: null,
  loadedEnd: null,
  chunkCache: new Map(),
  pendingChunks: new Map(),
  searchMode: false,
  searchQuery: '',
  searchUiOpen: false,
  searchInputTimer: 0,
  searchRequestSeq: 0,
  activeSearchRequest: 0,
  searchAbortController: null,
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
  timelineMeasuredHeights: new Map(),
  timelineAverageHeight: 280,
  timelineCorrectionSuppressedUntil: 0,
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
  yearSection: document.getElementById('yearSection'),
  yearSectionTitle: document.getElementById('yearSectionTitle'),
  yearSectionSubtitle: document.getElementById('yearSectionSubtitle'),
  yearCarouselShell: document.querySelector('.year-carousel-shell'),
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
  timelineStatus: document.getElementById('timelineStatus'),
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
  uploadSharedDate: document.getElementById('uploadSharedDate'),
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
  onValidateFileName: async (item, baseName, viewer) => {
    try {
      return await fetchJson(`/api/media/${item.id}/validate-name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseName })
      });
    } catch (error) {
      const current = state.viewerSequence.find((photo) => photo.id === item.id) || item;
      const siblingConflict = (viewer?.getItems?.() || state.viewerSequence).some((photo) => (
        photo.id !== item.id
        && (photo.folderRootId || '') === (current.folderRootId || '')
        && (photo.folder || '') === (current.folder || '')
        && `${baseName}${current.ext || ''}`.toLowerCase() === String(photo.fileName || '').toLowerCase()
      ));
      return { valid: Boolean(baseName) && !siblingConflict, exists: siblingConflict, fallback: true };
    }
  },
  onRename: async (item, baseName) => {
    const payload = await fetchJson(`/api/media/${item.id}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseName })
    });
    await refreshBootstrap(payload.photo?.isoDate || item.isoDate || state.bootstrap?.lastDate || null);
    return payload;
  },
  onMove: async (item, target) => {
    const payload = await fetchJson(`/api/media/${item.id}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(target)
    });
    if (payload?.photo) {
      const nextPhoto = {
        ...item,
        ...payload.photo,
        thumbUrl: `/media/thumb/${payload.photo.id}`,
        previewUrl: payload.photo.type === 'video' ? `/media/preview/${payload.photo.id}` : '',
        fullUrl: `/media/full/${payload.photo.id}`
      };
      syncViewerMediaMutation(item.id, (photo) => {
        Object.assign(photo, nextPhoto);
      });
      state.viewerSequence = state.loadedDays.flatMap((day) => day.photos.map((photo) => photo));
    }
    void refreshBootstrap(payload.photo?.isoDate || item.isoDate || state.bootstrap?.lastDate || null).catch(console.error);
    return payload;
  },
  onLoadFolders: async () => fetchJson('/api/upload/folders'),
  onToggleLike: async (item, liked) => {
    const payload = await fetchJson(`/api/media/${item.id}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liked })
    });
    item.liked = Boolean(payload.liked);
    syncViewerMediaMutation(item.id, (photo) => { photo.liked = item.liked; });
    syncMediaTileLikedState(item.id, item.liked);
    return { liked: item.liked };
  },
  onDelete: async (item, index, viewer) => {
    if (!item) return;
    if (!window.confirm(`Delete ${item.fileName}?`)) return;
    await fetchJson(`/api/media/${item.id}`, { method: 'DELETE' });
    await refreshBootstrap(item.isoDate || state.bootstrap?.lastDate || null);
    if (!state.viewerSequence.length) {
      viewer.close({ animate: false });
      return;
    }
    viewer.refresh({ preferredIndex: Math.min(index, state.viewerSequence.length - 1), forceDateToast: true });
  },
  onSaveDateTime: async (item, value) => {
    const payload = await fetchJson(`/api/media/${item.id}/date-time`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    });
    await refreshBootstrap(payload.photo?.isoDate || item.isoDate || state.bootstrap?.lastDate || null);
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

function monthDayLabel(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date);
}

function monthLabelForIso(isoDate) {
  if (!isoDate) return '';
  const [y, m] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1, 1));
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function fileDateToLocalIso(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return [date.getFullYear(), `${date.getMonth() + 1}`.padStart(2, '0'), `${date.getDate()}`.padStart(2, '0')].join('-');
}

function isValidIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function isoToUtcDate(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== (m - 1) || date.getUTCDate() !== d) return null;
  return date;
}

function addDaysToIso(isoDate, days) {
  const date = isoToUtcDate(isoDate);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return [
    date.getUTCFullYear(),
    `${date.getUTCMonth() + 1}`.padStart(2, '0'),
    `${date.getUTCDate()}`.padStart(2, '0')
  ].join('-');
}

function diffDaysBetweenIso(laterIso, earlierIso) {
  const later = isoToUtcDate(laterIso);
  const earlier = isoToUtcDate(earlierIso);
  if (!later || !earlier) return 0;
  return Math.round((later.getTime() - earlier.getTime()) / 86400000);
}

function openEditorForDate(isoDate, { create = false } = {}) {
  if (!isoDate) return;
  window.location.href = create ? `/edit/${isoDate}?create=1` : `/edit/${isoDate}`;
}

function formatWordCount(count) {
  const value = Number(count || 0);
  return `${value} word${value === 1 ? '' : 's'}`;
}

function formatCountLabel(value, singular, plural = `${singular}s`) {
  const count = Math.max(0, Math.round(Number(value || 0)));
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function renderDefaultYearSubtitle() {
  if (!dom.yearSectionSubtitle) return;
  const entries = formatCountLabel(state.bootstrap?.totalEntries || 0, 'Entrie');
  const words = formatCountLabel(state.bootstrap?.totalWords || 0, 'Word');
  const media = formatCountLabel(state.bootstrap?.totalMedia || 0, 'Media', 'Media');
  dom.yearSectionSubtitle.innerHTML = `<span>${entries}</span> | <span>${words}</span> | <span>${media}</span>`;
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

function uploadDateSourceLabel(item) {
  if (item?.dateSource === 'exif') return 'Date taken metadata';
  if (item?.dateSource === 'last-modified') return 'File modified date';
  if (item?.dateSource === 'shared') return 'Shared LifeServer datestamp';
  if (item?.dateSource === 'manual') return 'Custom LifeServer date';
  return 'Upload context date';
}

async function extractUploadMetadataDate(file, fallbackIsoDate) {
  const exifr = window.exifr;
  const isImage = /^image\//.test(file?.type || '') || /\.(jpg|jpeg|png|webp|avif|heic|heif|tif|tiff)$/i.test(file?.name || '');
  if (isImage && exifr?.parse) {
    try {
      const exif = await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] });
      const exifDate = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate;
      const exifIsoDate = fileDateToLocalIso(exifDate);
      if (exifIsoDate) return { isoDate: exifIsoDate, dateSource: 'exif' };
    } catch (error) {}
  }
  const modifiedIsoDate = fileDateToLocalIso(file?.lastModified);
  if (modifiedIsoDate) return { isoDate: modifiedIsoDate, dateSource: 'last-modified' };
  return { isoDate: fallbackIsoDate || '', dateSource: 'context' };
}

function createSelectedUploadFile(file) {
  return {
    id: `upload-${Date.now()}-${state.uploadFileSeq += 1}`,
    file,
    objectUrl: URL.createObjectURL(file),
    isoDate: state.uploadContext?.isoDate || '',
    dateSource: 'context'
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

function updateUploadDateToggleLabel() {
  if (dom.uploadExifDateLabel) dom.uploadExifDateLabel.textContent = 'Override LifeServer datestamp';
}

function updateUploadSharedDateUi() {
  const enabled = Boolean(dom.uploadSetExifDate?.checked);
  if (dom.uploadSharedDate) {
    dom.uploadSharedDate.disabled = !enabled;
    if (!dom.uploadSharedDate.value) {
      dom.uploadSharedDate.value = state.uploadContext?.isoDate || state.uploadSelectedFiles[0]?.isoDate || '';
    }
  }
}

function applySharedUploadDate(isoDate) {
  if (!isValidIsoDate(isoDate)) return;
  state.uploadSelectedFiles = state.uploadSelectedFiles.map((item) => ({
    ...item,
    isoDate,
    dateSource: 'shared'
  }));
}

function setUploadFileDate(fileId, isoDate) {
  if (!isValidIsoDate(isoDate)) return;
  state.uploadSelectedFiles = state.uploadSelectedFiles.map((item) => (
    item.id === fileId
      ? { ...item, isoDate, dateSource: 'manual' }
      : item
  ));
  if (dom.uploadSetExifDate?.checked && dom.uploadSharedDate?.value && dom.uploadSharedDate.value !== isoDate) {
    dom.uploadSetExifDate.checked = false;
  }
  updateUploadSharedDateUi();
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
  updateUploadSharedDateUi();
  updateUploadUiState();
  renderUploadPreviews();
}

async function appendUploadFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const batchSize = 8;
  for (let index = 0; index < files.length; index += batchSize) {
    const batch = await Promise.all(files.slice(index, index + batchSize).map(async (file) => {
      const item = createSelectedUploadFile(file);
      const metadata = await extractUploadMetadataDate(file, state.uploadContext?.isoDate || '');
      item.isoDate = metadata.isoDate;
      item.dateSource = metadata.dateSource;
      if (dom.uploadSetExifDate?.checked && isValidIsoDate(dom.uploadSharedDate?.value)) {
        item.isoDate = dom.uploadSharedDate.value;
        item.dateSource = 'shared';
      }
      return item;
    }));
    state.uploadSelectedFiles = [...state.uploadSelectedFiles, ...batch];
    updateUploadButtonLabel();
    updateUploadSharedDateUi();
    updateUploadUiState();
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

function updateUploadUiState() {
  dom.uploadWindow?.classList.toggle('is-uploading', Boolean(state.uploadXhr));
  dom.uploadWindow?.classList.toggle('is-preparing', Boolean(state.uploadPreparing));
  dom.uploadAddFiles?.classList.toggle('hidden', Boolean(state.uploadXhr));
  if (dom.uploadSubmit) dom.uploadSubmit.hidden = !state.uploadSelectedFiles.length && !state.uploadXhr;
  updateUploadSharedDateUi();
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
  if (state.searchMode || !state.bootstrap || state.fullTimelineLoaded) return;
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
  if (!urls || !urls.length) return `<div class="card-fallback ${journalOnly ? 'is-journal-only' : ''}">${journalOnly ? `<span class="card-fallback-icon">${renderPhIcon('note', { variant: 'duotone' })}</span>` : ''}</div>`;
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

function createHomeSkeletonDay(item) {
  const isoDate = item?.isoDate;
  return {
    isoDate,
    dateLabel: item?.longLabel || item?.label || isoDate,
    monthKey: isoDate ? isoDate.slice(0, 7) : '',
    monthLabel: isoDate ? monthLabelForIso(isoDate) : '',
    photoCount: 0,
    photos: [],
    journal: null,
    __hydrated: false
  };
}

function initializeHomeSourceFromBootstrap() {
  const items = state.bootstrap?.railDates || [];
  state.homeSourceDays = items.map((item) => createHomeSkeletonDay(item));
  state.homeSourceStartIndex = 0;
  state.homeSourceEndIndex = Math.max(-1, state.homeSourceDays.length - 1);
  state.homeSourceIndexByDate = Object.fromEntries(state.homeSourceDays.map((day, index) => [day.isoDate, index]));
}

function activeSourceDays() {
  return state.searchMode ? state.searchResultDays : state.homeSourceDays;
}

function activeSourceIndexByDate() {
  return state.searchMode ? state.searchResultIndexByDate : state.homeSourceIndexByDate;
}

function activeSourceTotal() {
  return activeSourceDays().length;
}

function getGlobalIndexForLocal(localIndex) {
  if (localIndex === null || localIndex === undefined || localIndex < 0) return null;
  const source = activeSourceDays();
  const day = source[localIndex];
  if (!day) return null;
  if (state.searchMode) return state.dateIndexMap[day.isoDate] ?? null;
  return state.homeSourceEndIndex - localIndex;
}

function getLocalIndexForDate(isoDate) {
  return activeSourceIndexByDate()[isoDate];
}

function getLocalIndexForGlobalIndex(globalIndex) {
  const isoDate = state.indexToDate[globalIndex];
  if (!isoDate) return undefined;
  return state.homeSourceIndexByDate[isoDate];
}

function syncLoadedDaysFromWindow() {
  const source = activeSourceDays();
  if (!source.length || state.loadedStart === null || state.loadedEnd === null) {
    state.loadedDays = [];
    return;
  }
  state.loadedDays = source.slice(state.loadedStart, state.loadedEnd + 1);
}

function isHydratedHomeDay(localIndex) {
  const day = state.homeSourceDays[localIndex];
  return Boolean(day?.__hydrated);
}

function isLoadedLocalIndex(localIndex) {
  return state.loadedStart !== null
    && state.loadedEnd !== null
    && localIndex >= state.loadedStart
    && localIndex <= state.loadedEnd;
}

function mergeTimelineResponseIntoHomeSource(response) {
  const changedIndexes = [];
  const responseDays = [...(response?.days || [])].reverse();
  responseDays.forEach((day) => {
    const localIndex = state.homeSourceIndexByDate[day.isoDate];
    if (localIndex === undefined) return;
    const previous = state.homeSourceDays[localIndex];
    state.homeSourceDays[localIndex] = {
      ...previous,
      ...day,
      __hydrated: true
    };
    if (!previous?.__hydrated) changedIndexes.push(localIndex);
  });
  syncLoadedDaysFromWindow();
  return changedIndexes;
}

async function ensureHomeRangeLoaded(start, end) {
  if (state.searchMode) return false;
  const source = state.homeSourceDays;
  if (!source.length) return false;

  const safeStart = clamp(start, 0, source.length - 1);
  const safeEnd = clamp(end, safeStart, source.length - 1);
  let minGlobal = null;
  let maxGlobal = null;

  for (let localIndex = safeStart; localIndex <= safeEnd; localIndex += 1) {
    if (isHydratedHomeDay(localIndex)) continue;
    const globalIndex = getGlobalIndexForLocal(localIndex);
    if (globalIndex === null || globalIndex === undefined) continue;
    if (minGlobal === null || globalIndex < minGlobal) minGlobal = globalIndex;
    if (maxGlobal === null || globalIndex > maxGlobal) maxGlobal = globalIndex;
  }

  if (minGlobal === null || maxGlobal === null) return false;

  const response = await getTimelineChunk(minGlobal, (maxGlobal - minGlobal) + 1);
  const changedIndexes = mergeTimelineResponseIntoHomeSource(response);
  prefetchAdjacentChunks(response);
  if (!state.searchMode && dom.timelineFeed.querySelector('.timeline-unit')) {
    refreshHomeTimelineWindow({ indexes: changedIndexes });
  } else {
    renderTimelineWindow();
  }
  return true;
}

function timelineVisibleWindowSize() {
  return timelineHydrationWindowSize();
}

function suppressTimelineCorrection(durationMs = 520) {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  state.timelineCorrectionSuppressedUntil = now + durationMs;
}

function isTimelineCorrectionSuppressed() {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  return now < (state.timelineCorrectionSuppressedUntil || 0);
}

function renderTimelineLoadingState(label = 'Loading your timeline…', detail = 'Preparing the first days so the page becomes usable before the full cache finishes.') {
  dom.timelineTopSpacer.style.height = '0px';
  dom.timelineBottomSpacer.style.height = '0px';
  dom.timelineFeed.innerHTML = `
    <div class="timeline-boot-state" aria-live="polite">
      <div class="timeline-boot-card">
        <div class="timeline-boot-head">${renderPhIcon('spinner-gap', { spin: true })}<strong>${escapeHtml(label)}</strong></div>
        <p>${escapeHtml(detail)}</p>
        <div class="timeline-skeleton-list">
          <span class="timeline-skeleton-line wide"></span>
          <span class="timeline-skeleton-line"></span>
          <span class="timeline-skeleton-line short"></span>
        </div>
      </div>
    </div>
  `;
}

function setTimelineStatus(message, { error = false } = {}) {
  if (!dom.timelineStatus) return;
  if (!message) {
    dom.timelineStatus.textContent = '';
    dom.timelineStatus.classList.add('hidden');
    dom.timelineStatus.classList.remove('is-error');
    return;
  }
  dom.timelineStatus.textContent = message;
  dom.timelineStatus.classList.toggle('is-error', Boolean(error));
  dom.timelineStatus.classList.remove('hidden');
}

function updateTimelineStatus() {
  if (state.timelineBooting) {
    setTimelineStatus('Loading timeline…');
    return;
  }
  if (state.fullTimelineError) {
    setTimelineStatus(state.fullTimelineError, { error: true });
    return;
  }
  if (!state.searchMode && state.timelineCaching && !state.fullTimelineLoaded) {
    setTimelineStatus('Caching timeline…');
    return;
  }
  setTimelineStatus('');
}

function isDateLoaded(isoDate) {
  const targetIndex = getLocalIndexForDate(isoDate);
  return targetIndex !== undefined
    && state.loadedStart !== null
    && targetIndex >= state.loadedStart
    && targetIndex <= state.loadedEnd
    && (state.searchMode || isHydratedHomeDay(targetIndex));
}

function applyHomeTimelineDays(days, total = days.length) {
  state.totalDays = Number(total || 0);
  state.fullTimelineDays = Array.isArray(days) ? [...days] : [];
  state.fullTimelineLoaded = true;
  state.fullTimelineError = '';
}

function restoreHomeTimelineState() {
  state.searchMode = false;
}

async function ensureFullTimelineLoaded({ force = false } = {}) {
  if (state.fullTimelineLoaded && !force) return;
  if (state.fullTimelinePromise && !force) return state.fullTimelinePromise;

  const total = Math.max(0, Number(state.totalDays || state.bootstrap?.totalDays || 0));
  if (!total) {
    applyHomeTimelineDays([], 0);
    return;
  }

  state.timelineCaching = true;
  updateTimelineStatus();
  const promise = getTimelineChunk(0, total)
    .then((response) => {
      const responseDays = [...(response.days || [])].reverse();
      applyHomeTimelineDays(responseDays, response.total);
      setHomeSource(responseDays, { startIndex: response.startIndex, endIndex: response.endIndex, preserveWindow: true });
      return response;
    })
    .catch((error) => {
      state.fullTimelineError = 'Timeline cache did not finish. Scrolling will continue using on-demand slices.';
      throw error;
    })
    .finally(() => {
      state.timelineCaching = false;
      updateTimelineStatus();
      if (state.fullTimelinePromise === promise) state.fullTimelinePromise = null;
    });

  state.fullTimelinePromise = promise;
  return promise;
}

function setHomeSource(days, { startIndex = 0, endIndex = Math.max(-1, days.length - 1), preserveWindow = false } = {}) {
  state.homeSourceDays = Array.isArray(days) ? [...days] : [];
  state.homeSourceStartIndex = startIndex;
  state.homeSourceEndIndex = endIndex;
  state.homeSourceIndexByDate = Object.fromEntries(state.homeSourceDays.map((day, index) => [day.isoDate, index]));

  if (!preserveWindow || !state.loadedDays.length || state.searchMode) return;

  const firstIsoDate = state.loadedDays[0]?.isoDate;
  const lastIsoDate = state.loadedDays[state.loadedDays.length - 1]?.isoDate;
  const nextStart = state.homeSourceIndexByDate[firstIsoDate];
  const nextEnd = state.homeSourceIndexByDate[lastIsoDate];
  if (nextStart === undefined || nextEnd === undefined) return;
  state.loadedStart = nextStart;
  state.loadedEnd = nextEnd;
  state.loadedDays = state.homeSourceDays.slice(nextStart, nextEnd + 1);
}

function setSearchSource(days) {
  state.searchResultDays = Array.isArray(days) ? [...days] : [];
  state.searchResultIndexByDate = Object.fromEntries(state.searchResultDays.map((day, index) => [day.isoDate, index]));
}

function buildLocalTimelineResponse(startIndex, limit) {
  const total = state.fullTimelineDays.length;
  if (!total) {
    return { total: 0, startIndex: 0, endIndex: -1, hasOlder: false, hasNewer: false, days: [] };
  }

  const safeStart = clamp(Number(startIndex || 0), 0, Math.max(0, total - 1));
  const safeLimit = Math.max(1, Number(limit || timelineChunkSize()));
  const endExclusive = Math.min(total, safeStart + safeLimit);
  const days = state.fullTimelineDays
    .slice(total - endExclusive, total - safeStart)
    .reverse();

  return {
    total,
    startIndex: safeStart,
    endIndex: endExclusive - 1,
    hasOlder: safeStart > 0,
    hasNewer: endExclusive < total,
    days
  };
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
  if (state.searchAbortController) {
    state.searchAbortController.abort();
    state.searchAbortController = null;
  }
  state.chunkCache.clear();
  state.pendingChunks.clear();
  state.monthCache.clear();
  state.yearCache.clear();
  state.fullTimelineDays = [];
  state.fullTimelineLoaded = false;
  state.fullTimelinePromise = null;
  state.fullTimelineError = '';
  state.homeSourceDays = [];
  state.homeSourceIndexByDate = {};
  state.homeSourceStartIndex = 0;
  state.homeSourceEndIndex = -1;
  state.searchResultDays = [];
  state.searchResultIndexByDate = {};
  state.timelineBooting = true;
  state.loadedDays = [];
  state.loadedStart = null;
  state.loadedEnd = null;
  renderTimelineLoadingState();
  updateTimelineStatus();
  state.bootstrap = await fetchJson('/api/bootstrap', { cache: 'no-store' });
  state.totalDays = state.bootstrap.totalDays;
  renderDefaultYearSubtitle();
  renderYearCarousel();
  renderRail();
  initializeHomeSourceFromBootstrap();
  renderScrollYearMarks();
  updateTopbarDateLabel();
  const initialDate = (focusDate && state.dateIndexMap[focusDate] !== undefined) ? focusDate : (anchor?.isoDate || state.bootstrap?.lastDate);
  await ensureTimelineLoaded(initialDate);
  state.timelineBooting = false;
  updateTimelineStatus();

  if (focusDate && state.dateIndexMap[focusDate] !== undefined) {
    restoreHomeTimelineState();
    await scrollToDate(focusDate, 'auto');
    return;
  }

  if (anchor?.isoDate && state.dateIndexMap[anchor.isoDate] !== undefined) {
    restoreHomeTimelineState();
    requestAnimationFrame(() => restoreScrollAnchor(anchor));
    return;
  }

  if (state.bootstrap?.lastDate) {
    restoreHomeTimelineState();
    return;
  }

  restoreHomeTimelineState();
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
        <span class="upload-folder-item-main">${renderPhIcon('folder-plus', { variant: 'duotone' })}<input id="uploadNewFolderInput" class="upload-folder-input" type="text" value="${escapeHtml(state.uploadCreatingFolder.name || 'New Folder')}" /></span>
        <label class="upload-folder-item-meta upload-folder-confirm" aria-label="Create folder"><input id="uploadNewFolderConfirm" type="checkbox" />${renderPhIcon('check', { variant: 'bold' })}</label>
      </div>
    </div>
  ` : '';
  const icon = node.pending
    ? renderPhIcon('spinner-gap', { spin: true })
    : renderPhIcon(escapeHtml(node.icon || 'folder'), { variant: 'duotone' });
  const meta = `${node.mediaCount || 0}${modified ? ` · ${escapeHtml(modified)}` : ''}`;
  return `
    <div class="upload-folder-node depth-${depth}">
      <button class="upload-folder-item ${isSelected ? 'is-selected' : ''} ${node.pending ? 'is-pending' : ''}" type="button" style="padding-left:${12 + indent}px" data-upload-root="${rootId}" data-upload-path="${escapeHtml(node.relativePath)}">
        <span class="upload-folder-item-main">${icon}<span>${escapeHtml(node.displayPath === '.' ? '(root)' : node.label)}</span></span>
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
    return `<button class="upload-preview-card ${state.uploadXhr ? '' : 'is-removable'}" type="button" ${state.uploadXhr ? 'disabled' : ''} data-upload-remove="${item.id}" aria-label="Remove ${escapeHtml(file.name)}"><div class="upload-preview-thumb">${isVideo ? `<video src="${item.objectUrl}" muted playsinline preload="none"></video><span class="upload-preview-video">${renderPhIcon('play-fill', { variant: 'fill' })}</span>` : `<img src="${item.objectUrl}" alt="${escapeHtml(file.name)}" loading="lazy" decoding="async" />`}${state.uploadXhr ? '' : `<span class="upload-preview-remove">${renderPhIcon('x', { variant: 'bold' })}</span>`}</div><div class="upload-preview-meta"><strong title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</strong><span>EXIF date · ${escapeHtml(formatUploadDateSummary(file, state.uploadContext?.isoDate, prefix))}</span><span>Size · ${escapeHtml(formatFileSize(file.size))}</span></div><div class="upload-preview-progress"><span class="upload-preview-progress-fill" data-upload-progress="${item.id}"></span></div></button>`;
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
      ? `<video src="${item.objectUrl}" muted playsinline preload="none"></video><span class="upload-preview-video">${renderPhIcon('play-fill', { variant: 'fill' })}</span>`
      : `<img src="${item.objectUrl}" alt="${escapeHtml(file.name)}" loading="lazy" decoding="async" />`;
    return `<button class="upload-preview-card ${state.uploadXhr ? '' : 'is-removable'}" type="button" ${state.uploadXhr ? 'disabled' : ''} data-upload-remove="${item.id}" aria-label="Remove ${escapeHtml(file.name)}"><div class="upload-preview-thumb">${previewThumb}${state.uploadXhr ? '' : `<span class="upload-preview-remove">${renderPhIcon('x', { variant: 'bold' })}</span>`}</div><div class="upload-preview-meta"><strong title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</strong><span>${escapeHtml(formatUploadDateSummary(file, state.uploadContext?.isoDate, setExifDate))}</span><span>Size Â· ${escapeHtml(formatFileSize(file.size))}</span></div><div class="upload-preview-progress"><span class="upload-preview-progress-fill" data-upload-progress="${item.id}"></span></div></button>`;
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
      ? `<video src="${item.objectUrl}" muted playsinline preload="none"></video><span class="upload-preview-video">${renderPhIcon('play-fill', { variant: 'fill' })}</span>`
      : `<img src="${item.objectUrl}" alt="${escapeHtml(file.name)}" loading="lazy" decoding="async" />`;
    return `<button class="upload-preview-card ${state.uploadXhr ? '' : 'is-removable'}" type="button" ${state.uploadXhr ? 'disabled' : ''} data-upload-remove="${item.id}" aria-label="Remove ${escapeHtml(file.name)}"><div class="upload-preview-thumb">${previewThumb}${state.uploadXhr ? '' : `<span class="upload-preview-remove">${renderPhIcon('x', { variant: 'bold' })}</span>`}</div><div class="upload-preview-meta"><strong title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</strong><span>${escapeHtml(formatUploadDateSummary(file, state.uploadContext?.isoDate, setExifDate))}</span><span>Size - ${escapeHtml(formatFileSize(file.size))}</span></div><div class="upload-preview-progress"><span class="upload-preview-progress-fill" data-upload-progress="${item.id}"></span></div></button>`;
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
      <div class="upload-folder-root-label">${renderPhIcon('hard-drives', { variant: 'duotone' })} ${escapeHtml(root.rootLabel)} <span class="upload-folder-root-count">${root.tree.mediaCount || 0}</span></div>
      ${renderFolderNode(root.tree, root.rootId)}
    </div>
  `).join('');
  updateUploadFolderLabel();
  focusPendingUploadFolderInput();
}

async function openUploadModal(isoDate) {
  state.uploadContext = { isoDate };
  // dom.uploadTitle.textContent = `Add media for ${dateRailLabel(isoDate)}`;
  dom.uploadTitle.textContent = `Add media`;
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

function renderUploadPreviews() {
  if (!dom.uploadPreviewList) return;
  const files = state.uploadSelectedFiles || [];
  dom.uploadPreviewList.innerHTML = files.map((item) => {
    const file = item.file;
    const isVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(file.name);
    const displayName = uploadDisplayName(file.name);
    const previewThumb = isVideo
      ? `<video src="${item.objectUrl}" muted playsinline preload="none"></video><span class="upload-preview-video">${renderPhIcon('play-fill', { variant: 'fill' })}</span>`
      : `<img src="${item.objectUrl}" alt="${escapeHtml(file.name)}" loading="lazy" decoding="async" />`;
    return `<div class="upload-preview-card ${state.uploadXhr ? '' : 'is-removable'}"><div class="upload-preview-thumb">${previewThumb}${state.uploadXhr ? '' : `<button class="upload-preview-remove" type="button" data-upload-remove="${item.id}" aria-label="Remove ${escapeHtml(file.name)}">${renderPhIcon('x', { variant: 'bold' })}</button>`}</div><div class="upload-preview-meta"><div class="upload-preview-meta-row"><div class="upload-preview-meta-copy"><strong title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</strong><span>${escapeHtml(uploadDateSourceLabel(item))}</span><span>Size · ${escapeHtml(formatFileSize(file.size))}</span></div><button class="upload-preview-date" type="button" data-upload-date-trigger="${item.id}" aria-label="Change date for ${escapeHtml(displayName)}">${renderPhIcon('calendar-dots', { variant: 'duotone' })}<strong title="${escapeHtml(displayName)}">${escapeHtml(monthDayLabel(item.isoDate) || 'No date')}</strong></button><input class="upload-preview-date-input" type="date" data-upload-date-input="${item.id}" value="${escapeHtml(item.isoDate || '')}" /></div><div class="upload-preview-progress"><span class="upload-preview-progress-fill" data-upload-progress="${item.id}"></span></div></div></div>`;
  }).join('');
  updateUploadPreviewProgress();
}

function openUploadDatePicker(fileId) {
  const input = dom.uploadPreviewList?.querySelector(`[data-upload-date-input="${fileId}"]`);
  if (!input) return;
  if (typeof input.showPicker === 'function') input.showPicker();
  else input.click();
}

function handleUploadSharedDateToggle() {
  if (dom.uploadSetExifDate?.checked) {
    if (!isValidIsoDate(dom.uploadSharedDate?.value)) {
      dom.uploadSharedDate.value = state.uploadContext?.isoDate || state.uploadSelectedFiles[0]?.isoDate || '';
    }
    if (isValidIsoDate(dom.uploadSharedDate?.value)) applySharedUploadDate(dom.uploadSharedDate.value);
  }
  updateUploadSharedDateUi();
  renderUploadPreviews();
}

async function openUploadModal(isoDate) {
  state.uploadContext = { isoDate };
  // dom.uploadTitle.textContent = `Add media for ${dateRailLabel(isoDate)}`;
  dom.uploadTitle.textContent = `Add media`;
  if (!state.uploadXhr) {
    state.uploadProgressRatio = 0;
    dom.uploadSetExifDate.checked = false;
    if (dom.uploadSharedDate) dom.uploadSharedDate.value = isoDate || '';
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

function uploadMediaFiles() {
  const files = state.uploadSelectedFiles.length ? state.uploadSelectedFiles.map((item) => item.file) : Array.from(dom.uploadFileInput.files || []);
  if (!files.length) return;
  const fileDates = state.uploadSelectedFiles.map((item) => item.isoDate || state.uploadContext?.isoDate || '');
  const form = new FormData();
  form.append('rootId', state.uploadTarget.rootId || '0');
  form.append('relativePath', state.uploadTarget.relativePath || '');
  form.append('targetIsoDate', state.uploadContext.isoDate);
  form.append('fileDates', JSON.stringify(fileDates));
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
  const previewSrc = media.type === 'video' ? (media.previewUrl || media.thumbUrl) : media.thumbUrl;
  const previewNode = media.type === 'video'
    ? `<video class="lazy-media" data-src="${previewSrc}" muted autoplay loop playsinline preload="none" poster="${escapeHtml(media.thumbUrl || '')}" aria-hidden="true"></video>`
    : '';
  const likedIndicator = media.liked ? `<span class="media-liked-indicator" aria-hidden="true">${renderPhIcon('heart', { variant: 'fill' })}</span>` : '';
  return `
    <button class="${className} media-tile open-media ${hero ? 'hero-photo' : ''} ${media.type === 'video' ? '' : 'lazy-media lazy-media-bg'}" type="button" data-media-id="${media.id}" ${media.type === 'video' ? '' : `data-src="${previewSrc}"`}>
      <div class="media-skeleton"></div>
      ${previewNode}
      ${likedIndicator}
      ${hero ? '<div class="hero-gradient"></div>' : ''}
      ${label ? `<div class="hero-stamp">${escapeHtml(label)}</div>` : ''}
      ${media.type === 'video' ? `<div class="media-badge ${hero ? 'hero-badge' : ''}">${renderPhIcon('video-camera', { variant: 'fill' })}</div>` : ''}
      ${badge && media.type !== 'video' ? `<div class="media-badge ${hero ? 'hero-badge' : ''}">${badge}</div>` : ''}
    </button>
  `;
}

function buildStaticThumbMedia(media, { alt = '', eager = false } = {}) {
  const previewSrc = media.type === 'video' ? (media.previewUrl || media.thumbUrl) : media.thumbUrl;
  if (media.type === 'video') {
    return `<video src="${previewSrc}" muted autoplay loop playsinline preload="metadata" poster="${escapeHtml(media.thumbUrl || '')}" aria-hidden="true"></video>`;
  }
  return `<img src="${previewSrc}" alt="${escapeHtml(alt)}" ${eager ? 'loading="lazy" fetchpriority="low" decoding="async"' : ''} />`;
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
    return `<a class="journal-edit-button icon-button" href="/edit/${day.isoDate}" data-edit-date="${day.isoDate}" aria-label="Edit entry">${renderPhIcon('pencil-simple-line', { variant: 'bold' })}</a>`;
  }
  return `<a class="journal-edit-button icon-button" href="/edit/${day.isoDate}?create=1" data-create-entry-date="${day.isoDate}" aria-label="Add entry">${renderPhIcon('note', { variant: 'duotone' })}</a>`;
}

function buildUploadAction(day) {
  return `<button class="journal-edit-button icon-button" type="button" data-upload-date="${day.isoDate}" aria-label="Add media">${renderPhIcon('plus', { variant: 'bold' })}</button>`;
}

function buildGapCardHtml(newerDay, olderDay) {
  const gapDays = diffDaysBetweenIso(newerDay?.isoDate, olderDay?.isoDate) - 1;
  if (gapDays <= 0) return '';
  const startIso = addDaysToIso(olderDay.isoDate, 1);
  const endIso = addDaysToIso(newerDay.isoDate, -1);
  if (!startIso || !endIso) return '';
  const isSingleTodayGap = gapDays === 1 && startIso === endIso && startIso === state.bootstrap?.today?.isoDate;
  const missingLabel = gapDays === 1 ? monthDayLabel(startIso) : `${gapDays} missing days`;
  const actionLabel = gapDays === 1
    ? (isSingleTodayGap ? 'What happened today?' : `Record what happened ${monthDayLabel(startIso)}`)
    : `Record what happened ${monthDayLabel(startIso)} - ${monthDayLabel(endIso)}`;
  return `
    <article class="gap-block">
      <button
        class="gap-card"
        type="button"
        data-gap-range-start="${startIso}"
        data-gap-range-end="${endIso}"
        data-gap-days="${gapDays}"
        aria-label="${escapeHtml(actionLabel)}"
      >
        <span class="gap-card-icon" aria-hidden="true">${renderPhIcon('plus', { variant: 'bold' })}</span>
        <span class="gap-card-copy">
          <strong>${escapeHtml(actionLabel)}</strong>
          <span>${escapeHtml(missingLabel)}</span>
        </span>
      </button>
    </article>
  `;
}

function buildSearchPhotoStack(media) {
  const stack = media.slice(0, 4);
  return `
    <div class="search-photo-stack-wrap">
      <div class="search-photo-stack">
        ${stack.map((item, index) => `<button class="search-photo-stack-item open-media ${item.type === 'video' ? '' : 'lazy-media lazy-media-bg'}" type="button" data-media-id="${item.id}" style="--stack-index:${index}" ${item.type === 'video' ? '' : `data-src="${item.thumbUrl}"`}>${item.type === 'video'
          ? `<video class="lazy-media" data-src="${item.previewUrl || item.thumbUrl}" muted autoplay loop playsinline preload="none" poster="${escapeHtml(item.thumbUrl || '')}" aria-hidden="true"></video>`
          : ''}${item.liked ? `<span class="media-liked-indicator" aria-hidden="true">${renderPhIcon('heart', { variant: 'fill' })}</span>` : ''}</button>`).join('')}
      </div>
    </div>
  `;
}

function buildNewestGapCard(day, globalIndex = null) {
  const todayIso = state.bootstrap?.today?.isoDate;
  const newestDay = day || state.loadedDays[0];
  if (!todayIso || !newestDay?.isoDate) return null;
  if (globalIndex !== null && globalIndex !== state.totalDays - 1) return null;
  if (diffDaysBetweenIso(todayIso, newestDay.isoDate) <= 0) return null;
  return {
    html: buildGapCardHtml({ isoDate: addDaysToIso(todayIso, 1) }, newestDay),
    monthKey: todayIso.slice(0, 7),
    monthLabel: monthLabelForIso(todayIso)
  };
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
    } else {
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
          <span class="entry-card-icon" aria-hidden="true">${renderPhIcon('calendar-dots', { variant: 'duotone' })}</span>
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

function shouldShowMonthDivider(localIndex) {
  const source = activeSourceDays();
  const day = source[localIndex];
  const newerDay = localIndex > 0 ? source[localIndex - 1] : null;
  return Boolean(day && (!newerDay || day.monthKey !== newerDay.monthKey));
}

function buildTimelineUnitHtml(localIndex) {
  const source = activeSourceDays();
  const day = source[localIndex];
  if (!day) return '';
  const hydrated = state.searchMode || (isLoadedLocalIndex(localIndex) && isHydratedHomeDay(localIndex));

  const globalIndex = getGlobalIndexForLocal(localIndex);
  const newestGap = !state.searchMode && localIndex === 0 ? buildNewestGapCard(day, globalIndex) : null;
  const newestGapHtml = newestGap?.html
    ? `${newestGap.monthKey !== day.monthKey ? `<div class="month-divider"><span class="month-divider-label">${escapeHtml(newestGap.monthLabel)}</span></div>` : ''}${newestGap.html}`
    : '';
  const monthDividerHtml = shouldShowMonthDivider(localIndex)
    ? `<div class="month-divider"><span class="month-divider-label">${escapeHtml(day.monthLabel)}</span></div>`
    : '';
  const gapHtml = !state.searchMode && localIndex < source.length - 1
    ? buildGapCardHtml(day, source[localIndex + 1])
    : '';
  return `
    <section class="timeline-unit ${hydrated ? 'is-hydrated' : 'is-placeholder'}" data-source-index="${localIndex}" data-day-date="${day.isoDate}">
      <div class="timeline-unit-newest-gap">${newestGapHtml}</div>
      <div class="timeline-unit-month-divider">${monthDividerHtml}</div>
      <div class="timeline-unit-day">${timelineUnitBodyHtml(localIndex)}</div>
      <div class="timeline-unit-gap">${gapHtml}</div>
    </section>
  `;
}

function buildTimelinePlaceholderHtml(day, localIndex) {
  const frozenHeight = Math.max(estimateTimelineUnitHeight(), Math.round(estimateHeightForDay(day)));
  return `<div class="timeline-placeholder" aria-hidden="true" data-placeholder-index="${localIndex}" style="height:${frozenHeight}px"></div>`;
}

function timelineUnitBodyHtml(localIndex) {
  const source = activeSourceDays();
  const day = source[localIndex];
  if (!day) return '';
  const hydrated = state.searchMode || (isLoadedLocalIndex(localIndex) && isHydratedHomeDay(localIndex));
  return hydrated ? buildDayHtml(day) : buildTimelinePlaceholderHtml(day, localIndex);
}

function refreshTimelineUnitDecorations(localIndex) {
  const source = activeSourceDays();
  const day = source[localIndex];
  if (!day) return;
  const unit = dom.timelineFeed.querySelector(`.timeline-unit[data-source-index="${localIndex}"]`);
  if (!unit) return;

  const globalIndex = getGlobalIndexForLocal(localIndex);
  const newestGap = !state.searchMode && localIndex === 0 ? buildNewestGapCard(day, globalIndex) : null;
  const newestGapHtml = newestGap?.html
    ? `${newestGap.monthKey !== day.monthKey ? `<div class="month-divider"><span class="month-divider-label">${escapeHtml(newestGap.monthLabel)}</span></div>` : ''}${newestGap.html}`
    : '';
  const monthDividerHtml = shouldShowMonthDivider(localIndex)
    ? `<div class="month-divider"><span class="month-divider-label">${escapeHtml(day.monthLabel)}</span></div>`
    : '';
  const gapHtml = !state.searchMode && localIndex < source.length - 1
    ? buildGapCardHtml(day, source[localIndex + 1])
    : '';

  const newestGapNode = unit.querySelector('.timeline-unit-newest-gap');
  const monthDividerNode = unit.querySelector('.timeline-unit-month-divider');
  const gapNode = unit.querySelector('.timeline-unit-gap');
  if (newestGapNode) newestGapNode.innerHTML = newestGapHtml;
  if (monthDividerNode) monthDividerNode.innerHTML = monthDividerHtml;
  if (gapNode) gapNode.innerHTML = gapHtml;
}

function refreshTimelineUnitContent(localIndex) {
  const source = activeSourceDays();
  const day = source[localIndex];
  if (!day) return;
  const unit = dom.timelineFeed.querySelector(`.timeline-unit[data-source-index="${localIndex}"]`);
  if (!unit) return;
  const dayNode = unit.querySelector('.timeline-unit-day');
  if (!dayNode) return;
  const hydrated = state.searchMode || (isLoadedLocalIndex(localIndex) && isHydratedHomeDay(localIndex));
  unit.classList.toggle('is-hydrated', hydrated);
  unit.classList.toggle('is-placeholder', !hydrated);
  dayNode.innerHTML = timelineUnitBodyHtml(localIndex);
}

function estimateTimelineUnitHeight() {
  return 300;
}

function timelineHydrationWindowSize() {
  return 20;
}

function estimateHeightForDay(day) {
  if (!day?.isoDate) return estimateTimelineUnitHeight();
  return state.timelineMeasuredHeights.get(day.isoDate) || estimateTimelineUnitHeight();
}

function sumEstimatedHeights(days) {
  return Math.round((days || []).reduce((sum, day) => sum + estimateHeightForDay(day), 0));
}

function estimateHeightForDayFromSnapshot(day, measuredHeights) {
  if (!day?.isoDate) return estimateTimelineUnitHeight();
  return measuredHeights.get(day.isoDate) || estimateTimelineUnitHeight();
}

function getVirtualTopForLocalIndexFromSnapshot(localIndex, measuredHeights) {
  if (localIndex === null || localIndex === undefined || localIndex <= 0) return 0;
  const source = activeSourceDays();
  let total = 0;
  for (let index = 0; index < localIndex; index += 1) {
    total += estimateHeightForDayFromSnapshot(source[index], measuredHeights);
  }
  return total;
}

function refreshTimelineHeightMetrics({ anchor = null } = {}) {
  const units = Array.from(document.querySelectorAll('#timelineFeed .timeline-unit.is-hydrated'));
  if (!units.length) return;
  const previousMeasuredHeights = new Map(state.timelineMeasuredHeights);
  let totalHeight = 0;
  let count = 0;
  let compensationDelta = 0;
  const anchorDocumentY = timelineMarkerDocumentY();
  const nextMeasuredHeights = [];
  units.forEach((node) => {
    const localIndex = Number(node.dataset.sourceIndex);
    const day = activeSourceDays()[localIndex];
    const height = Math.max(1, Math.round(node.getBoundingClientRect().height));
    const previousHeight = estimateHeightForDayFromSnapshot(day, previousMeasuredHeights);
    if (day?.isoDate) nextMeasuredHeights.push([day.isoDate, height]);
    const virtualTop = getVirtualTopForLocalIndexFromSnapshot(localIndex, previousMeasuredHeights);
    const documentTop = (window.scrollY + dom.timelinePane.getBoundingClientRect().top + Number(dom.timelineTopSpacer.style.height.replace('px', '') || 0)) + virtualTop;
    if (!isTimelineCorrectionSuppressed() && documentTop < anchorDocumentY && previousHeight !== height) {
      compensationDelta += (height - previousHeight);
    }
    totalHeight += height;
    count += 1;
  });
  nextMeasuredHeights.forEach(([isoDate, height]) => state.timelineMeasuredHeights.set(isoDate, height));
  if (count) state.timelineAverageHeight = totalHeight / count;
  if (!isTimelineCorrectionSuppressed() && anchor) {
    restoreScrollAnchor(anchor);
    return;
  }
  if (!isTimelineCorrectionSuppressed() && compensationDelta) {
    window.scrollBy({ top: compensationDelta, behavior: 'auto' });
  }
}

function updateTimelineSpacers() {
  if (state.searchMode) {
    const source = activeSourceDays();
    const topDays = state.loadedStart === null ? [] : source.slice(0, state.loadedStart);
    const bottomDays = state.loadedEnd === null ? [] : source.slice(state.loadedEnd + 1);
    dom.timelineTopSpacer.style.height = `${sumEstimatedHeights(topDays)}px`;
    dom.timelineBottomSpacer.style.height = `${sumEstimatedHeights(bottomDays)}px`;
    return;
  }
  dom.timelineTopSpacer.style.height = '0px';
  dom.timelineBottomSpacer.style.height = '0px';
}

function renderHomeTimelineScaffold() {
  const source = state.homeSourceDays;
  if (!source.length) return false;
  let html = '';
  for (let localIndex = 0; localIndex < source.length; localIndex += 1) {
    html += buildTimelineUnitHtml(localIndex);
  }
  dom.timelineFeed.innerHTML = html;
  return true;
}

function refreshHomeTimelineWindow({ previousStart = null, previousEnd = null, indexes = null } = {}) {
  if (!state.homeSourceDays.length) return;
  const anchor = state.route.view === 'home' ? captureScrollAnchor() : null;
  const targetIndexes = new Set(Array.isArray(indexes) ? indexes : []);

  const inRange = (index, start, end) => (
    start !== null
    && end !== null
    && index >= start
    && index <= end
  );

  if (!Array.isArray(indexes)) {
    const minIndex = Math.min(
      previousStart ?? Number.POSITIVE_INFINITY,
      state.loadedStart ?? Number.POSITIVE_INFINITY
    );
    const maxIndex = Math.max(
      previousEnd ?? Number.NEGATIVE_INFINITY,
      state.loadedEnd ?? Number.NEGATIVE_INFINITY
    );

    if (Number.isFinite(minIndex) && Number.isFinite(maxIndex)) {
      for (let index = minIndex; index <= maxIndex; index += 1) {
        const wasLoaded = inRange(index, previousStart, previousEnd);
        const isLoaded = inRange(index, state.loadedStart, state.loadedEnd);
        if (wasLoaded !== isLoaded) targetIndexes.add(index);
      }
    }
  }

  targetIndexes.forEach((localIndex) => {
    refreshTimelineUnitContent(localIndex);
  });
  rebuildViewerSequence();
  setupMediaObserver();
  refreshTimelineHeightMetrics({ anchor });
  updateActiveFromScroll();
  syncScrollThumb();
}

function renderTimelineWindow() {
  const source = activeSourceDays();

  if (!source.length) {
    const todayIso = state.bootstrap?.today?.isoDate;
    if (!state.searchMode && !state.totalDays && todayIso) {
      const cardHtml = buildGapCardHtml({ isoDate: addDaysToIso(todayIso, 1) }, { isoDate: addDaysToIso(todayIso, -1) });
      dom.timelineFeed.innerHTML = `
        <div class="month-divider"><span class="month-divider-label">${escapeHtml(monthLabelForIso(todayIso))}</span></div>
        ${cardHtml}
      `;
      dom.timelineTopSpacer.style.height = '0px';
      dom.timelineBottomSpacer.style.height = '0px';
      rebuildViewerSequence();
      setupMediaObserver();
      updateActiveFromScroll();
      syncScrollThumb();
      return;
    }
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

  if (!state.searchMode) {
    if (!dom.timelineFeed.querySelector('.timeline-unit')) {
      renderHomeTimelineScaffold();
    }
    rebuildViewerSequence();
    setupMediaObserver();
    refreshTimelineHeightMetrics();
    updateTimelineSpacers();
    updateActiveFromScroll();
    syncScrollThumb();
    return;
  }

  let html = '';
  const renderStart = state.searchMode ? (state.loadedStart ?? 0) : 0;
  const renderEnd = state.searchMode ? (state.loadedEnd ?? (source.length - 1)) : (source.length - 1);
  for (let localIndex = renderStart; localIndex <= renderEnd; localIndex += 1) {
    html += buildTimelineUnitHtml(localIndex);
  }
  dom.timelineFeed.innerHTML = html;
  rebuildViewerSequence();
  setupMediaObserver();
  refreshTimelineHeightMetrics();
  updateTimelineSpacers();
  updateActiveFromScroll();
  syncScrollThumb();
}

function setVisibleWindow(start, end) {
  const source = activeSourceDays();
  if (!source.length) {
    state.loadedDays = [];
    state.loadedStart = null;
    state.loadedEnd = null;
    renderTimelineWindow();
    return;
  }

  const safeStart = clamp(start, 0, source.length - 1);
  const safeEnd = clamp(end, safeStart, source.length - 1);
  const previousStart = state.loadedStart;
  const previousEnd = state.loadedEnd;
  state.loadedStart = safeStart;
  state.loadedEnd = safeEnd;
  syncLoadedDaysFromWindow();
  if (!state.searchMode && dom.timelineFeed.querySelector('.timeline-unit')) {
    refreshHomeTimelineWindow({ previousStart, previousEnd });
    return;
  }
  renderTimelineWindow();
}

function buildWindowRangeAroundIndex(localIndex, placement = 'center') {
  const total = activeSourceTotal();
  const size = Math.min(Math.max(1, timelineHydrationWindowSize()), Math.max(1, total));
  if (placement === 'top') {
    const start = clamp(localIndex, 0, Math.max(0, total - size));
    return { start, end: Math.min(total - 1, start + size - 1) };
  }
  const start = clamp(localIndex - Math.floor(size / 2), 0, Math.max(0, total - size));
  return { start, end: Math.min(total - 1, start + size - 1) };
}

function timelineMarkerDocumentY() {
  return window.scrollY + topOffset() + 80;
}

function timelineMarkerViewportY() {
  return topOffset() + 80;
}

function getVirtualTopForLocalIndex(localIndex) {
  if (localIndex === null || localIndex === undefined || localIndex <= 0) return 0;
  const source = activeSourceDays();
  let total = 0;
  for (let index = 0; index < localIndex; index += 1) total += estimateHeightForDay(source[index]);
  return total;
}

function predictSearchLocalIndexFromScroll() {
  const source = activeSourceDays();
  if (!source.length) return null;
  const paneTop = window.scrollY + dom.timelinePane.getBoundingClientRect().top;
  const offset = Math.max(0, timelineMarkerDocumentY() - paneTop);
  let remaining = offset;
  for (let index = 0; index < source.length; index += 1) {
    const height = estimateHeightForDay(source[index]);
    if (remaining <= height) return index;
    remaining -= height;
  }
  return source.length - 1;
}

function predictActiveLocalIndexFromAnchor() {
  const domIndex = findVisibleLocalIndexFromDom();
  if (domIndex !== null && domIndex !== undefined) return domIndex;
  const source = activeSourceDays();
  if (!source.length) return null;
  const paneTop = window.scrollY + dom.timelinePane.getBoundingClientRect().top;
  const topSpacerHeight = Number(dom.timelineTopSpacer.style.height.replace('px', '') || 0);
  const offset = Math.max(0, timelineMarkerDocumentY() - paneTop - topSpacerHeight);
  let remaining = offset;
  const start = state.searchMode ? (state.loadedStart ?? 0) : 0;
  const end = state.searchMode ? (state.loadedEnd ?? (source.length - 1)) : (source.length - 1);
  for (let index = start; index <= end; index += 1) {
    const day = source[index];
    const height = estimateHeightForDay(day);
    if (remaining <= height) return index;
    remaining -= height;
  }
  return clamp(end, 0, source.length - 1);
}

function findVisibleLocalIndexFromDom() {
  const units = Array.from(document.querySelectorAll('#timelineFeed .timeline-unit'));
  if (!units.length) return null;
  const markerY = timelineMarkerViewportY();
  let nearestIndex = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const unit of units) {
    const rect = unit.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
    const localIndex = Number(unit.dataset.sourceIndex);
    if (!Number.isFinite(localIndex)) continue;
    if (rect.top <= markerY && rect.bottom >= markerY) return localIndex;
    const distance = rect.top > markerY ? rect.top - markerY : markerY - rect.bottom;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = localIndex;
    }
  }

  return nearestIndex;
}

function predictHomeGlobalIndexFromScroll() {
  if (!state.totalDays) return null;
  const domIndex = findVisibleLocalIndexFromDom();
  if (domIndex !== null && domIndex !== undefined) return getGlobalIndexForLocal(domIndex);
  if (state.homeSourceDays.length) {
    const source = state.homeSourceDays;
    const paneTop = window.scrollY + dom.timelinePane.getBoundingClientRect().top;
    const offset = Math.max(0, timelineMarkerDocumentY() - paneTop);
    let remaining = offset;
    for (let index = 0; index < source.length; index += 1) {
      const height = estimateHeightForDay(source[index]);
      if (remaining <= height) return getGlobalIndexForLocal(index);
      remaining -= height;
    }
    return getGlobalIndexForLocal(source.length - 1);
  }
  const paneTop = window.scrollY + dom.timelinePane.getBoundingClientRect().top;
  const offset = Math.max(0, timelineMarkerDocumentY() - paneTop);
  const avg = estimateTimelineUnitHeight();
  const estimatedTotalHeight = Math.max(avg, state.totalDays * avg);
  const ratio = clamp(offset / estimatedTotalHeight, 0, 1);
  return clamp(Math.round((1 - ratio) * Math.max(0, state.totalDays - 1)), 0, Math.max(0, state.totalDays - 1));
}

async function recoverIfOutrun() {
  if (!state.searchMode) return false;
  if (state.route.view !== 'home' || !activeSourceDays().length) return false;
  const units = Array.from(document.querySelectorAll('#timelineFeed .timeline-unit'));
  if (!units.length) return false;

  const markerY = topOffset() + 80;
  const firstRect = units[0].getBoundingClientRect();
  const lastRect = units[units.length - 1].getBoundingClientRect();
  const tolerance = estimateTimelineUnitHeight() * 1.5;
  const outrunAbove = markerY < firstRect.top - tolerance;
  const outrunBelow = markerY > lastRect.bottom + tolerance;
  if (!outrunAbove && !outrunBelow) return false;

  if (state.searchMode) {
    const localIndex = predictSearchLocalIndexFromScroll();
    if (localIndex === null) return false;
    const range = buildWindowRangeAroundIndex(localIndex, 'center');
    setVisibleWindow(range.start, range.end);
    return true;
  }

  if (state.fullTimelineLoaded) {
    const globalIndex = predictHomeGlobalIndexFromScroll();
    if (globalIndex === null) return false;
    const isoDate = state.indexToDate[globalIndex];
    const localIndex = isoDate ? state.homeSourceIndexByDate[isoDate] : null;
    if (localIndex === null || localIndex === undefined) return false;
    const range = buildWindowRangeAroundIndex(localIndex, 'center');
    setVisibleWindow(range.start, range.end);
    return true;
  }

  const targetGlobalIndex = predictHomeGlobalIndexFromScroll();
  if (targetGlobalIndex === null) return false;
  const chunkSize = timelineChunkSize();
  const start = Math.max(0, targetGlobalIndex - Math.floor(chunkSize / 2));
  const response = await getTimelineChunk(start, chunkSize);
  applyTimelineResponse(response, { replace: true, placement: 'center' });
  return true;
}

function reconcileWindowAroundActiveDate() {
  if (state.route.view !== 'home' || !state.loadedDays.length) return;
  const localIndex = findVisibleLocalIndexFromDom() ?? getLocalIndexForDate(state.activeDate);
  if (localIndex === undefined) return;
  const range = buildWindowRangeAroundIndex(localIndex, 'center');
  if (range.start === state.loadedStart && range.end === state.loadedEnd) return;
  setVisibleWindow(range.start, range.end);
  if (!state.searchMode) void ensureHomeRangeLoaded(range.start, range.end);
}

function enqueueMediaLoad(node) {
  if (!node || !node.dataset.src || state.mediaQueueSet.has(node)) return;
  state.mediaQueue.push(node);
  state.mediaQueueSet.add(node);
  processMediaQueue();
}

function finishMediaNode(node) {
  state.mediaQueueSet.delete(node);
  const skeleton = node.classList.contains('media-tile')
    ? node.querySelector('.media-skeleton')
    : node.parentElement?.querySelector('.media-skeleton');
  if (skeleton) {
    skeleton.classList.add('is-exiting');
    window.setTimeout(() => skeleton.remove(), 220);
  }
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

    if (node instanceof HTMLVideoElement) {
      node.onloadeddata = () => {
        node.classList.add('is-ready');
        const playPromise = node.play?.();
        if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
        done();
      };
      node.onerror = done;
      node.src = src;
      node.load();
      continue;
    }

    if (node instanceof HTMLButtonElement) {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        node.style.backgroundImage = `url("${src.replace(/"/g, '\\"')}")`;
        node.classList.add('is-ready');
        done();
      };
      image.onerror = done;
      image.src = src;
      continue;
    }

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

  document.querySelectorAll('#timelineFeed .lazy-media').forEach((node) => state.mediaObserver.observe(node));
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

function renderTimeline() {
  renderTimelineWindow();
}

function applyTimelineResponse(response, { placement = 'center', focusDate = null, focusGlobalIndex = null } = {}) {
  cacheTimelineResponse(response);
  state.totalDays = response.total;
  mergeTimelineResponseIntoHomeSource(response);
  const resolvedGlobalIndex = focusGlobalIndex ?? (focusDate ? state.dateIndexMap[focusDate] : response.endIndex);
  const localIndex = getLocalIndexForGlobalIndex(resolvedGlobalIndex);
  if (localIndex === undefined) return;
  const range = buildWindowRangeAroundIndex(localIndex, placement);
  setVisibleWindow(range.start, range.end);
}

async function ensureTimelineLoaded(anchorDate) {
  if (state.searchMode || !state.bootstrap) return;
  const targetIndex = anchorDate ? state.dateIndexMap[anchorDate] : (state.totalDays - 1);
  if (targetIndex === undefined || targetIndex < 0) return;
  const localIndex = getLocalIndexForGlobalIndex(targetIndex);
  if (localIndex === undefined) return;
  const range = buildWindowRangeAroundIndex(localIndex, 'center');
  setVisibleWindow(range.start, range.end);
  await ensureHomeRangeLoaded(range.start, range.end);
}

async function loadOlderChunk() {
  reconcileWindowAroundActiveDate();
}

async function loadNewerChunk() {
  reconcileWindowAroundActiveDate();
}

function setupSentinelObserver() {
  return;
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

  const activeLocalIndex = predictActiveLocalIndexFromAnchor();
  const source = activeSourceDays();
  const predictedDay = activeLocalIndex !== null && activeLocalIndex !== undefined ? source[activeLocalIndex] : null;
  if (!predictedDay) {
    state.activeDate = null;
    updateStickyMonth();
    updateRailActive();
    syncScrollThumb();
    updateTopbarDateLabel();
    return;
  }

  state.activeDate = predictedDay.isoDate;
  updateStickyMonth();
  updateRailActive();
  updateScrollThumbLabel();
  updateTopbarDateLabel();
}

async function ensureTimelineContainsDate(isoDate, placement = 'center') {
  const targetIndex = state.dateIndexMap[isoDate];
  if (targetIndex === undefined) return;

  const localIndex = getLocalIndexForDate(isoDate);
  if (isDateLoaded(isoDate)) {
    return;
  }

  if (!state.searchMode) {
    const nextLocalIndex = getLocalIndexForGlobalIndex(targetIndex);
    if (nextLocalIndex === undefined) return;
    const range = buildWindowRangeAroundIndex(nextLocalIndex, 'center');
    setVisibleWindow(range.start, range.end);
    await ensureHomeRangeLoaded(range.start, range.end);
    return;
  }

  if (localIndex !== undefined) {
    const range = buildWindowRangeAroundIndex(localIndex, placement);
    setVisibleWindow(range.start, range.end);
  }
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
  suppressTimelineCorrection(900);
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

function scrollToTimelineUnitIndex(index, behavior = 'auto') {
  if (state.route.view !== 'home' || state.searchMode) return false;
  const localIndex = getLocalIndexForGlobalIndex(index);
  if (localIndex === undefined) return false;

  let unit = dom.timelineFeed.querySelector(`.timeline-unit[data-source-index="${localIndex}"]`);
  if (!unit) return false;

  const range = buildWindowRangeAroundIndex(localIndex, 'center');
  if (range.start !== state.loadedStart || range.end !== state.loadedEnd) {
    setVisibleWindow(range.start, range.end);
    void ensureHomeRangeLoaded(range.start, range.end);
    unit = dom.timelineFeed.querySelector(`.timeline-unit[data-source-index="${localIndex}"]`);
    if (!unit) return false;
  }

  suppressTimelineCorrection(280);
  const top = Math.max(0, window.scrollY + unit.getBoundingClientRect().top - topOffset());
  window.scrollTo({ top, behavior });

  const isoDate = unit.dataset.dayDate || state.indexToDate[index];
  if (isoDate) state.activeDate = isoDate;
  updateStickyMonth();
  updateRailActive();
  syncScrollThumb();
  updateTopbarDateLabel();
  return true;
}

async function queueScrollHandleJump(index) {
  state.scrollPreviewIndex = index;
  syncScrollThumb();
  if (scrollToTimelineUnitIndex(index, 'auto')) return;
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

function syncMediaTileLikedState(photoId, liked) {
  document.querySelectorAll('.open-media[data-media-id]').forEach((node) => {
    if (node.dataset.mediaId !== photoId) return;
    const existing = node.querySelector('.media-liked-indicator');
    if (liked) {
      if (!existing) {
        node.insertAdjacentHTML('beforeend', `<span class="media-liked-indicator" aria-hidden="true">${renderPhIcon('heart', { variant: 'fill' })}</span>`);
      }
      return;
    }
    existing?.remove();
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

function getGapPickerInput() {
  let input = document.getElementById('timelineGapDatePicker');
  if (input) return input;
  input = document.createElement('input');
  input.type = 'date';
  input.id = 'timelineGapDatePicker';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  input.className = 'timeline-gap-picker-native';
  document.body.appendChild(input);
  return input;
}

function handleGapCardClick(card) {
  const startIso = card?.dataset.gapRangeStart || '';
  const endIso = card?.dataset.gapRangeEnd || '';
  const gapDays = Number(card?.dataset.gapDays || 0);
  if (!startIso || !endIso || gapDays <= 0) return;
  if (gapDays === 1) {
    openEditorForDate(startIso, { create: true });
    return;
  }
  const input = getGapPickerInput();
  input.min = startIso;
  input.max = endIso;
  input.value = startIso;
  input.onchange = () => {
    const selected = input.value;
    if (!selected) return;
    if (selected < startIso || selected > endIso) {
      input.value = startIso;
      return;
    }
    openEditorForDate(selected, { create: true });
  };
  input.focus();
  if (typeof input.showPicker === 'function') {
    try {
      input.showPicker();
      return;
    } catch (error) {}
  }
  input.click();
}

async function runSearch(query) {
  const term = String(query || '').trim();
  const requestId = ++state.searchRequestSeq;
  state.activeSearchRequest = requestId;
  state.searchQuery = term;
  state.scrollPreviewIndex = null;
  state.scrollHandleQueuedIndex = null;
  state.scrollHandleBusy = false;
  dom.clearSearch.classList.toggle('hidden', !term);
  if (state.searchAbortController) {
    state.searchAbortController.abort();
    state.searchAbortController = null;
  }
  if (!term) {
    restoreHomeTimelineState();
    setSearchSource([]);
    dom.yearCarouselShell?.classList.remove('hidden');
    if (dom.yearSectionTitle) dom.yearSectionTitle.textContent = 'Browse your years';
    renderDefaultYearSubtitle();
    await goHome({ push: false, restoreScroll: false });
    await ensureTimelineLoaded(state.bootstrap?.lastDate);
    if (requestId !== state.activeSearchRequest) return;
    requestAnimationFrame(() => {
      updateActiveFromScroll();
      syncScrollThumb();
    });
    return;
  }

  const controller = new AbortController();
  state.searchAbortController = controller;
  let response;
  try {
    response = await fetchJson(`/api/search?q=${encodeURIComponent(term)}`, { cache: 'no-store', signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) return;
    throw error;
  } finally {
    if (state.searchAbortController === controller) state.searchAbortController = null;
  }

  if (requestId !== state.activeSearchRequest || state.searchQuery !== term) return;

  await goHome({ push: false, restoreScroll: false });
  if (requestId !== state.activeSearchRequest || state.searchQuery !== term) return;
  state.searchMode = true;
  setSearchSource(response.days);
  dom.yearCarouselShell?.classList.add('hidden');
  if (dom.yearSectionTitle) dom.yearSectionTitle.textContent = `Search results for ${term}`;
  if (dom.yearSectionSubtitle) dom.yearSectionSubtitle.textContent = `${response.total} matching days`;
  state.activeDate = response.days[0]?.isoDate || null;
  if (response.days.length) {
    const range = buildWindowRangeAroundIndex(0, 'top');
    setVisibleWindow(range.start, range.end);
  } else {
    state.loadedDays = [];
    state.loadedStart = null;
    state.loadedEnd = null;
    renderTimeline();
  }
  state.topbarHidden = false;
  dom.body.classList.remove('topbar-hidden');
  state.mobileTopbarAnchorY = window.scrollY;
  requestAnimationFrame(() => {
    updateActiveFromScroll();
    syncScrollThumb();
    state.topbarHidden = false;
    dom.body.classList.remove('topbar-hidden');
    state.mobileTopbarAnchorY = window.scrollY;
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
      ? `<div class="cover-single">${buildStaticThumbMedia(thumbs[0], { eager: true })}</div>`
      : `<div class="cover-collage count-${thumbs.length}">${thumbs.map((thumb) => `<div class="${thumb.type === 'video' ? 'is-video' : ''}">${buildStaticThumbMedia(thumb, { eager: true })}</div>`).join('')}</div>`)
    : createCoverHtml([], { journalOnly: true });
  const addButton = !day.hasJournal && day.photoCount
    ? `<button class="day-card-add icon-button" type="button" data-create-entry-date="${day.isoDate}" aria-label="Add entry">${renderPhIcon('pencil-simple', { variant: 'bold' })}</button>`
    : '';

  return `
    <button class="explorer-card day-card ${journalOnly ? 'is-journal-only' : ''}" type="button" data-day-date="${day.isoDate}" data-month-key="${monthKey}" data-year="${year}">
      ${cover}
      ${addButton}
      <div class="card-content day-card-content ${journalOnly ? 'card-content-solid' : ''}">
        <div class="card-title">${escapeHtml(day.dateLabel || dateRailLabel(day.isoDate) || day.isoDate)}</div>
        <div class="day-card-meta">
          ${day.hasJournal ? `<span class="text-pill" aria-label="Has journal entry">${renderPhIcon('note', { variant: 'duotone' })}</span>` : ''}
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
  dom.uploadSetExifDate?.addEventListener('change', handleUploadSharedDateToggle);
  dom.uploadSharedDate?.addEventListener('change', () => {
    if (!dom.uploadSetExifDate?.checked || !isValidIsoDate(dom.uploadSharedDate?.value)) return;
    applySharedUploadDate(dom.uploadSharedDate.value);
    renderUploadPreviews();
  });
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
    if (removeButton) {
      removeUploadFile(removeButton.dataset.uploadRemove);
      return;
    }
    const dateTrigger = event.target.closest('[data-upload-date-trigger]');
    if (dateTrigger) openUploadDatePicker(dateTrigger.dataset.uploadDateTrigger);
  });
  dom.uploadPreviewList?.addEventListener('change', (event) => {
    const dateInput = event.target.closest('[data-upload-date-input]');
    if (!dateInput || !isValidIsoDate(dateInput.value)) return;
    setUploadFileDate(dateInput.dataset.uploadDateInput, dateInput.value);
    renderUploadPreviews();
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
    const gapCard = event.target.closest('[data-gap-range-start][data-gap-range-end]');
    if (gapCard) {
      event.preventDefault();
      handleGapCardClick(gapCard);
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
      return;
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
      recoverIfOutrun()
        .then((recovered) => {
          if (!recovered) reconcileWindowAroundActiveDate();
          else updateActiveFromScroll();
          syncScrollThumb();
          updateHistoryScrollY();
        })
        .catch(console.error);
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
    queueScrollHandleJump(state.scrollPreviewIndex).catch(console.error);
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
    state.scrollPreviewIndex = null;
    syncScrollThumb();
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
  renderTimelineLoadingState();
  applyTheme(state.theme);
  applyGridColumns(state.gridColumns || gridColumnBounds().base);
  state.timelineBooting = true;
  updateTimelineStatus();
  const initialState = history.state || parseInitialRoute();
  history.replaceState(initialState, '', location.href || '#');
  state.bootstrap = await fetchJson('/api/bootstrap');
  state.totalDays = state.bootstrap.totalDays;
  renderDefaultYearSubtitle();
  state.mobileTopbarAnchorY = 0;
  syncTopbarSearchState();
  updateTopbarDateLabel();
  renderYearCarousel();
  renderRail();
  initializeHomeSourceFromBootstrap();
  renderScrollYearMarks();
  attachEvents();
  const initialFocusDate = initialState?.focusDate && state.dateIndexMap[initialState.focusDate] !== undefined
    ? initialState.focusDate
    : state.bootstrap.lastDate;
  restoreHomeTimelineState();
  if (initialFocusDate) await ensureTimelineLoaded(initialFocusDate);
  else renderTimeline();
  state.timelineBooting = false;
  updateTimelineStatus();
  showScrollHandle();
  showScrollTopButton();

  await routeToState(initialState);
  updateActiveFromScroll();
  reconcileWindowAroundActiveDate();
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
