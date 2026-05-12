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
  searchLoading: false,
  searchQuery: '',
  searchUiOpen: false,
  searchInputTimer: 0,
  searchRequestSeq: 0,
  activeSearchRequest: 0,
  searchAbortController: null,
  searchRawDays: [],
  searchFolders: [],
  searchActiveFolderKeys: new Set(),
  searchDetailDate: '',
  searchDetailResultIndex: 0,
  searchResultsScrollY: 0,
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
  calendarModal: {
    isOpen: false,
    busy: false,
    context: '',
    selectedDate: '',
    visibleMonth: '',
    minDate: '',
    maxDate: '',
    title: '',
    subtitle: '',
    confirmLabel: 'Confirm',
    helperText: '',
    isDateEnabled: null,
    onConfirm: null,
    returnFocus: null,
    metadata: null
  },
  timeModal: {
    isOpen: false,
    busy: false,
    title: '',
    subtitle: '',
    confirmLabel: 'Confirm',
    helperText: '',
    selectedTime: '12:00',
    onConfirm: null,
    returnFocus: null,
    metadata: null
  },
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
  uploadProcessing: false,
  uploadSharedDateRestore: null,
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

const TIME_HOUR_VALUES = Array.from({ length: 12 }, (_, index) => String(index + 1));
const TIME_MINUTE_VALUES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));
const TIME_PERIOD_VALUES = ['AM', 'PM'];
const TIME_SPINNER_REPEAT_COUNT = 5;
const TIME_SPINNER_CENTER_REPEAT = Math.floor(TIME_SPINNER_REPEAT_COUNT / 2);
const AVAILABLE_THEMES = new Set(['light', 'dark', 'sepia', 'forest', 'ocean', 'rose']);
const MEDIA_LIKE_SAVE_DELAY_MS = 200;
const pendingMediaLikeSaves = new Map();
const mediaLikeSaveVersions = new Map();
const timeSpinnerScrollTimers = new Map();
const timeSpinnerSuppressUntil = new WeakMap();

const dom = {
  body: document.body,
  topbar: document.getElementById('topbar'),
  homeButton: document.getElementById('homeButton'),
  topbarDateLabel: document.getElementById('topbarDateLabel'),
  topbarMeta: document.getElementById('topbarMeta'),
  topbarActions: document.getElementById('topbarActions'),
  uploadTopbarButton: document.getElementById('uploadTopbarButton'),
  searchToggleButton: document.getElementById('searchToggleButton'),
  searchCloseButton: document.getElementById('searchCloseButton'),
  searchBackButton: document.getElementById('searchBackButton'),
  settingsButton: document.getElementById('settingsButton'),
  settingsHomeButton: document.getElementById('settingsHomeButton'),
  settingsTodayButton: document.getElementById('settingsTodayButton'),
  settingsJumpButton: document.getElementById('settingsJumpButton'),
  settingsUploadButton: document.getElementById('settingsUploadButton'),
  settingsModal: document.getElementById('settingsModal'),
  settingsCloseButton: document.getElementById('settingsCloseButton'),
  logoutButton: document.getElementById('logoutButton'),
  themeChoices: Array.from(document.querySelectorAll('[data-theme-choice]')),
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
  searchStatusSection: document.getElementById('searchStatusSection'),
  searchStatusEyebrow: document.getElementById('searchStatusEyebrow'),
  searchStatusTitle: document.getElementById('searchStatusTitle'),
  searchStatusSubtitle: document.getElementById('searchStatusSubtitle'),
  searchFilters: document.getElementById('searchFilters'),
  timelinePane: document.getElementById('timelinePane'),
  timelineFeed: document.getElementById('timelineFeed'),
  timelineTopSpacer: document.getElementById('timelineTopSpacer'),
  timelineBottomSpacer: document.getElementById('timelineBottomSpacer'),
  timelineStatus: document.getElementById('timelineStatus'),
  searchForm: document.getElementById('searchForm'),
  searchInput: document.getElementById('searchInput'),
  clearSearch: document.getElementById('clearSearch'),
  searchDetailView: document.getElementById('searchDetailView'),
  searchDetailNav: document.getElementById('searchDetailNav'),
  searchDetailPrevResult: document.getElementById('searchDetailPrevResult'),
  searchDetailNextResult: document.getElementById('searchDetailNextResult'),
  searchDetailBody: document.getElementById('searchDetailBody'),
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
  uploadDateModeToggle: document.getElementById('uploadDateModeToggle'),
  uploadContextDateTrigger: document.getElementById('uploadContextDateTrigger'),
  uploadFolderButton: document.getElementById('uploadFolderButton'),
  uploadFolderLabel: document.getElementById('uploadFolderLabel'),
  uploadFolderTree: document.getElementById('uploadFolderTree'),
  uploadNewFolder: document.getElementById('uploadNewFolder'),
  uploadAddFiles: document.getElementById('uploadAddFiles'),
  uploadFileInput: document.getElementById('uploadFileInput'),
  uploadFilePicker: document.querySelector('#uploadModal .upload-file-picker'),
  uploadSelectionLoading: document.getElementById('uploadSelectionLoading'),
  uploadSelectionLoadingLabel: document.querySelector('#uploadSelectionLoading span'),
  uploadCheckRow: document.querySelector('#uploadModal .upload-check-row'),
  uploadPreviewList: document.getElementById('uploadPreviewList'),
  uploadSetExifDate: document.getElementById('uploadSetExifDate'),
  uploadSharedDateControls: document.getElementById('uploadSharedDateControls'),
  uploadSharedDate: document.getElementById('uploadSharedDate'),
  uploadExifDateLabel: document.getElementById('uploadExifDateLabel'),
  uploadSubmit: document.getElementById('uploadSubmit'),
  uploadSubmitLabel: document.getElementById('uploadSubmitLabel'),
  uploadCancel: document.getElementById('uploadCancel'),
  uploadResume: document.getElementById('uploadResume'),
  uploadResumeLabel: document.getElementById('uploadResumeLabel'),
  calendarModal: document.getElementById('calendarModal'),
  calendarBackdrop: document.querySelector('#calendarModal .calendar-backdrop'),
  calendarWindow: document.querySelector('#calendarModal .calendar-window'),
  calendarTitle: document.getElementById('calendarTitle'),
  calendarSubtitle: document.getElementById('calendarSubtitle'),
  calendarPrevMonth: document.getElementById('calendarPrevMonth'),
  calendarNextMonth: document.getElementById('calendarNextMonth'),
  calendarMonthLabel: document.getElementById('calendarMonthLabel'),
  calendarGrid: document.getElementById('calendarGrid'),
  calendarFooter: document.getElementById('calendarFooter'),
  calendarSelectionLabel: document.getElementById('calendarSelectionLabel'),
  calendarHelperText: document.getElementById('calendarHelperText'),
  calendarCloseButton: document.getElementById('calendarCloseButton'),
  calendarCancelButton: document.getElementById('calendarCancelButton'),
  calendarConfirmButton: document.getElementById('calendarConfirmButton'),
  timeModal: document.getElementById('timeModal'),
  timeBackdrop: document.querySelector('#timeModal .calendar-backdrop'),
  timeWindow: document.querySelector('#timeModal .time-window'),
  timeTitle: document.getElementById('timeTitle'),
  timeSubtitle: document.getElementById('timeSubtitle'),
  timeHourLane: document.getElementById('timeHourLane'),
  timeMinuteLane: document.getElementById('timeMinuteLane'),
  timePeriodLane: document.getElementById('timePeriodLane'),
  timeSelectionLabel: document.getElementById('timeSelectionLabel'),
  timeHelperText: document.getElementById('timeHelperText'),
  timeCloseButton: document.getElementById('timeCloseButton'),
  timeCancelButton: document.getElementById('timeCancelButton'),
  timeConfirmButton: document.getElementById('timeConfirmButton'),
  viewerTagsInput: document.getElementById('viewerTagsInput'),
  viewerTagsSave: document.getElementById('viewerTagsSave')
};

function syncOverlayBodyState() {
  const viewerHidden = !mediaViewer?.isOpen?.();
  const uploadHidden = dom.uploadModal?.classList.contains('hidden');
  const calendarHidden = dom.calendarModal?.classList.contains('hidden');
  const timeHidden = dom.timeModal?.classList.contains('hidden');
  if (viewerHidden && uploadHidden && calendarHidden && timeHidden && !state.settingsOpen) {
    dom.body.classList.remove('viewer-open');
  }
}

function renderSearchDescriptionSummary(item) {
  const description = String(item?.description || '');
  if (!state.searchMode || !state.searchQuery || !item?.searchMatch) return escapeHtml(description);
  return highlightPlainText(description, state.searchQuery);
}

const mediaViewer = window.createMediaViewer({
  getItems: () => state.viewerSequence,
  onOpen: () => {
    dom.body.classList.add('viewer-open');
  },
  onClose: () => {
    syncOverlayBodyState();
  },
  onRequestClose: () => {
    closeViewer();
  },
  onItemChange: (item) => {
    if (history.state?.viewer) {
      history.replaceState({ ...history.state, viewerMediaId: item.id }, '', location.href);
    }
  },
  onStepUnavailable: async (_direction, viewer) => {
    if (state.searchMode || state.fullTimelineLoaded || !state.totalDays) return false;
    const currentId = viewer.getCurrentItem()?.id;
    await ensureFullTimelineLoaded();
    rebuildViewerSequence({ preferredMediaId: currentId, refreshOpenViewer: viewer.isOpen() });
    return true;
  },
  renderDescriptionSummary: (item) => renderSearchDescriptionSummary(item),
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
      rebuildViewerSequence();
    }
    void refreshBootstrap(payload.photo?.isoDate || item.isoDate || state.bootstrap?.lastDate || null).catch(console.error);
    return payload;
  },
  onLoadFolders: async () => fetchJson('/api/upload/folders'),
  onToggleLike: (item, liked) => {
    item.liked = Boolean(liked);
    syncViewerMediaMutation(item.id, (photo) => { photo.liked = item.liked; });
    syncMediaTileLikedState(item.id, item.liked);
    queueMediaLikeSave(item.id, item.liked);
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
    if (payload?.photo) applyClientMediaDateMutation(item, payload.photo);
    void refreshBootstrap(payload.photo?.isoDate || item.isoDate || state.bootstrap?.lastDate || null).catch(console.error);
    return payload;
  },
  onPickDate: async (item, currentIsoDate, currentTime, viewer) => {
    const maxDate = state.bootstrap?.today?.isoDate || fileDateToLocalIso(Date.now()) || '';
    openCalendarModal({
      context: 'move-media',
      title: 'Move media to a different day',
      subtitle: item?.fileName || 'Choose a date for this media.',
      confirmLabel: 'Move media',
      helperText: 'This updates the media day while keeping the current time.',
      initialDate: currentIsoDate || item?.isoDate || maxDate,
      minDate: '1900-01-01',
      maxDate,
      isDateEnabled: (isoDate) => isWithinCalendarRange(isoDate, '1900-01-01', maxDate),
      onConfirm: async (selectedDate) => {
        const payload = await fetchJson(`/api/media/${item.id}/date-time`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isoDate: selectedDate, time: currentTime || '12:00' })
        });
        if (payload?.photo) applyClientMediaDateMutation(item, payload.photo);
        void refreshBootstrap(payload.photo?.isoDate || item?.isoDate || state.bootstrap?.lastDate || null).catch(console.error);
        await viewer.reselectAfterMutation(item.id, payload, { forceDateToast: true });
      }
    });
  },
  onPickTime: async (item, currentIsoDate, currentTime, viewer) => {
    openTimeModal({
      title: 'Choose a time',
      subtitle: item?.fileName || 'Pick a capture time for this media.',
      confirmLabel: 'Use this time',
      helperText: 'This updates the capture time while keeping the selected date.',
      initialTime: currentTime || '12:00',
      onConfirm: async (selectedTime) => {
        const payload = await fetchJson(`/api/media/${item.id}/date-time`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isoDate: currentIsoDate || item.isoDate, time: selectedTime })
        });
        if (payload?.photo) applyClientMediaDateMutation(item, payload.photo);
        void refreshBootstrap(payload.photo?.isoDate || item?.isoDate || state.bootstrap?.lastDate || null).catch(console.error);
        await viewer.reselectAfterMutation(item.id, payload, { forceDateToast: true });
      }
    });
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

function fileDateToLocalCapturedAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const isoDate = fileDateToLocalIso(date);
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  const seconds = `${date.getSeconds()}`.padStart(2, '0');
  return `${isoDate}T${hours}:${minutes}:${seconds}.000Z`;
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

function monthKeyFromIso(isoDate) {
  return isValidIsoDate(isoDate) ? isoDate.slice(0, 7) : '';
}

function monthStartIso(monthKey) {
  return /^\d{4}-\d{2}$/.test(String(monthKey || '')) ? `${monthKey}-01` : '';
}

function addMonthsToMonthKey(monthKey, delta) {
  const startIso = monthStartIso(monthKey);
  const date = isoToUtcDate(startIso);
  if (!date) return '';
  date.setUTCMonth(date.getUTCMonth() + Number(delta || 0), 1);
  return [
    date.getUTCFullYear(),
    `${date.getUTCMonth() + 1}`.padStart(2, '0')
  ].join('-');
}

function daysInMonthKey(monthKey) {
  const startIso = monthStartIso(monthKey);
  const date = isoToUtcDate(startIso);
  if (!date) return 31;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

function compareIsoDates(a, b) {
  if (!isValidIsoDate(a) || !isValidIsoDate(b)) return 0;
  return a.localeCompare(b);
}

function isWithinCalendarRange(isoDate, minDate, maxDate) {
  if (!isValidIsoDate(isoDate)) return false;
  if (isValidIsoDate(minDate) && compareIsoDates(isoDate, minDate) < 0) return false;
  if (isValidIsoDate(maxDate) && compareIsoDates(isoDate, maxDate) > 0) return false;
  return true;
}

function clampIsoDate(isoDate, minDate, maxDate) {
  if (!isValidIsoDate(isoDate)) return '';
  if (isValidIsoDate(minDate) && compareIsoDates(isoDate, minDate) < 0) return minDate;
  if (isValidIsoDate(maxDate) && compareIsoDates(isoDate, maxDate) > 0) return maxDate;
  return isoDate;
}

function buildCalendarMonthDays(monthKey) {
  const firstDay = isoToUtcDate(monthStartIso(monthKey));
  if (!firstDay) return [];
  const firstWeekday = firstDay.getUTCDay();
  const firstGridDate = new Date(firstDay);
  firstGridDate.setUTCDate(firstGridDate.getUTCDate() - firstWeekday);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstGridDate);
    date.setUTCDate(firstGridDate.getUTCDate() + index);
    const isoDate = [
      date.getUTCFullYear(),
      `${date.getUTCMonth() + 1}`.padStart(2, '0'),
      `${date.getUTCDate()}`.padStart(2, '0')
    ].join('-');
    return {
      isoDate,
      inMonth: monthKeyFromIso(isoDate) === monthKey
    };
  });
}

function isCalendarDateEnabled(isoDate) {
  const modal = state.calendarModal;
  if (!modal?.isOpen) return false;
  if (!isWithinCalendarRange(isoDate, modal.minDate, modal.maxDate)) return false;
  if (typeof modal.isDateEnabled === 'function') return Boolean(modal.isDateEnabled(isoDate));
  return true;
}

function firstEnabledDateForMonth(monthKey) {
  const entries = buildCalendarMonthDays(monthKey).filter((entry) => entry.inMonth);
  return entries.find((entry) => isCalendarDateEnabled(entry.isoDate))?.isoDate || '';
}

function formatCalendarSelectionText(isoDate) {
  return isValidIsoDate(isoDate) ? dateRailLabel(isoDate) : 'Choose a date';
}

function findCalendarDaySummary(isoDate) {
  const localIndex = state.homeSourceIndexByDate[isoDate];
  const homeDay = localIndex !== undefined ? state.homeSourceDays[localIndex] : null;
  const searchIndex = state.searchResultIndexByDate[isoDate];
  const searchDay = searchIndex !== undefined ? state.searchResultDays[searchIndex] : null;
  const day = homeDay || searchDay || null;
  if (!day) return { hasJournal: false, hasMedia: false };
  return {
    hasJournal: Boolean(day.hasJournal || day.journal),
    hasMedia: Number(day.photoCount || day.photos?.length || 0) > 0
  };
}

function renderCalendarModal() {
  const modal = state.calendarModal;
  if (!dom.calendarModal || !modal.isOpen) return;
  const autoConfirm = modal.context === 'jump-date';
  dom.calendarTitle.textContent = modal.title || 'Choose a date';
  dom.calendarSubtitle.textContent = modal.subtitle || '';
  dom.calendarMonthLabel.textContent = monthLabelForIso(monthStartIso(modal.visibleMonth));
  dom.calendarConfirmButton.textContent = modal.busy ? 'Working...' : (modal.confirmLabel || 'Confirm');
  dom.calendarConfirmButton.disabled = modal.busy || !isCalendarDateEnabled(modal.selectedDate);
  dom.calendarPrevMonth.disabled = modal.busy;
  dom.calendarNextMonth.disabled = modal.busy;
  dom.calendarSelectionLabel.textContent = formatCalendarSelectionText(modal.selectedDate);
  dom.calendarHelperText.textContent = modal.helperText || '';
  dom.calendarFooter?.classList.toggle('hidden', autoConfirm);

  const todayIso = state.bootstrap?.today?.isoDate || '';
  const days = buildCalendarMonthDays(modal.visibleMonth);
  dom.calendarGrid.innerHTML = days.map(({ isoDate, inMonth }) => {
    const enabled = isCalendarDateEnabled(isoDate);
    const selected = isoDate === modal.selectedDate;
    const { hasJournal, hasMedia } = findCalendarDaySummary(isoDate);
    const classes = [
      'calendar-day',
      !inMonth ? 'is-outside-month' : '',
      selected ? 'is-selected' : '',
      isoDate === todayIso ? 'is-today' : '',
      (hasJournal || hasMedia) ? 'is-has-content' : '',
      enabled ? '' : 'is-disabled'
    ].filter(Boolean).join(' ');
    const marker = `${hasJournal ? renderPhIcon('note', { variant: 'duotone' }) : ''}${hasMedia ? renderPhIcon('images-square', { variant: 'duotone' }) : ''}`;
    return `<button class="${classes}" type="button" role="gridcell" data-calendar-date="${isoDate}" aria-selected="${selected ? 'true' : 'false'}" ${enabled ? '' : 'disabled'}><span class="calendar-day-number">${escapeHtml(String(Number(isoDate.slice(-2))))}</span><span class="calendar-day-dot" aria-hidden="true">${marker}</span></button>`;
  }).join('');
}

function focusCalendarDate(isoDate = state.calendarModal.selectedDate) {
  if (!dom.calendarGrid) return;
  const target = isValidIsoDate(isoDate)
    ? dom.calendarGrid.querySelector(`[data-calendar-date="${isoDate}"]`)
    : null;
  if (target && !target.disabled) {
    target.focus({ preventScroll: true });
    return;
  }
  const fallback = dom.calendarGrid.querySelector('.calendar-day:not(:disabled)');
  fallback?.focus({ preventScroll: true });
}

function closeCalendarModal({ restoreFocus = true } = {}) {
  if (!state.calendarModal.isOpen) return;
  const { returnFocus } = state.calendarModal;
  state.calendarModal = {
    isOpen: false,
    busy: false,
    context: '',
    selectedDate: '',
    visibleMonth: '',
    minDate: '',
    maxDate: '',
    title: '',
    subtitle: '',
    confirmLabel: 'Confirm',
    helperText: '',
    isDateEnabled: null,
    onConfirm: null,
    returnFocus: null,
    metadata: null
  };
  dom.calendarModal.classList.add('hidden');
  syncOverlayBodyState();
  if (restoreFocus && returnFocus instanceof HTMLElement && returnFocus.isConnected) {
    requestAnimationFrame(() => returnFocus.focus({ preventScroll: true }));
  }
}

function openCalendarModal({
  context = '',
  title = 'Choose a date',
  subtitle = '',
  confirmLabel = 'Confirm',
  helperText = '',
  initialDate = '',
  visibleMonth = '',
  minDate = '',
  maxDate = '',
  isDateEnabled = null,
  onConfirm = null,
  returnFocus = document.activeElement,
  metadata = null
} = {}) {
  const fallbackDate = state.bootstrap?.today?.isoDate || state.bootstrap?.lastDate || initialDate || minDate || maxDate || '';
  let selectedDate = clampIsoDate(initialDate || fallbackDate, minDate, maxDate);
  state.calendarModal = {
    isOpen: true,
    busy: false,
    context,
    selectedDate,
    visibleMonth: visibleMonth || monthKeyFromIso(selectedDate || fallbackDate) || monthKeyFromIso(minDate || maxDate || fallbackDate),
    minDate: isValidIsoDate(minDate) ? minDate : '',
    maxDate: isValidIsoDate(maxDate) ? maxDate : '',
    title,
    subtitle,
    confirmLabel,
    helperText,
    isDateEnabled,
    onConfirm,
    returnFocus,
    metadata
  };
  if (!isCalendarDateEnabled(state.calendarModal.selectedDate)) {
    const monthDefault = firstEnabledDateForMonth(state.calendarModal.visibleMonth);
    state.calendarModal.selectedDate = monthDefault || '';
  }
  renderCalendarModal();
  dom.calendarModal.classList.remove('hidden');
  dom.body.classList.add('viewer-open');
  requestAnimationFrame(() => focusCalendarDate());
}

async function confirmCalendarModal() {
  if (!state.calendarModal.isOpen || state.calendarModal.busy || !isCalendarDateEnabled(state.calendarModal.selectedDate)) return;
  const onConfirm = state.calendarModal.onConfirm;
  if (typeof onConfirm !== 'function') {
    closeCalendarModal();
    return;
  }
  state.calendarModal.busy = true;
  renderCalendarModal();
  try {
    await onConfirm(state.calendarModal.selectedDate, state.calendarModal.metadata || {});
    closeCalendarModal();
  } finally {
    if (state.calendarModal.isOpen) {
      state.calendarModal.busy = false;
      renderCalendarModal();
    }
  }
}

function navigateCalendarMonth(delta) {
  if (!state.calendarModal.isOpen || state.calendarModal.busy) return;
  const nextMonth = addMonthsToMonthKey(state.calendarModal.visibleMonth, delta);
  if (!nextMonth) return;
  state.calendarModal.visibleMonth = nextMonth;
  const currentSelectedMonth = monthKeyFromIso(state.calendarModal.selectedDate);
  if (currentSelectedMonth !== nextMonth) {
    const firstEnabled = firstEnabledDateForMonth(nextMonth);
    if (firstEnabled) state.calendarModal.selectedDate = firstEnabled;
  }
  renderCalendarModal();
  requestAnimationFrame(() => focusCalendarDate());
}

function normalizeTimeValue(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})/);
  if (!match) return '12:00';
  const hours = Math.min(23, Math.max(0, Number(match[1] || 0)));
  const minutes = Math.min(59, Math.max(0, Number(match[2] || 0)));
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function getTimeParts(value) {
  const normalized = normalizeTimeValue(value);
  const [hours24, minutes] = normalized.split(':').map(Number);
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hour12 = hours24 % 12 || 12;
  return {
    hour24: hours24,
    hour12: String(hour12),
    minute: String(minutes).padStart(2, '0'),
    period
  };
}

function composeTimeValue({ hour12 = '12', minute = '00', period = 'AM' } = {}) {
  const normalizedHour = Math.min(12, Math.max(1, Number(hour12) || 12));
  const normalizedMinute = Math.min(59, Math.max(0, Number(minute) || 0));
  const normalizedPeriod = String(period || 'AM').toUpperCase() === 'PM' ? 'PM' : 'AM';
  let hours24 = normalizedHour % 12;
  if (normalizedPeriod === 'PM') hours24 += 12;
  return `${String(hours24).padStart(2, '0')}:${String(normalizedMinute).padStart(2, '0')}`;
}

function formatTimeSelectionText(value) {
  const normalized = normalizeTimeValue(value);
  const [hours, minutes] = normalized.split(':').map(Number);
  const date = new Date(Date.UTC(2000, 0, 1, hours, minutes, 0));
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(date);
}

function timeSpinnerValuesForPart(part) {
  if (part === 'hour') return TIME_HOUR_VALUES;
  if (part === 'minute') return TIME_MINUTE_VALUES;
  if (part === 'period') return TIME_PERIOD_VALUES;
  return [];
}

function buildTimeSpinnerMarkup(part, values) {
  return Array.from({ length: TIME_SPINNER_REPEAT_COUNT }, (_, cycle) => values.map((value) => `
    <div
      class="time-spinner-option"
      data-time-option="${part}"
      data-time-cycle="${cycle}"
      data-time-value="${escapeHtml(value)}"
      role="option"
      aria-selected="false"
    >${escapeHtml(value)}</div>
  `).join('')).join('');
}

function renderTimeSpinnerLanes() {
  if (dom.timeHourLane && !dom.timeHourLane.childElementCount) {
    dom.timeHourLane.innerHTML = buildTimeSpinnerMarkup('hour', TIME_HOUR_VALUES);
  }
  if (dom.timeMinuteLane && !dom.timeMinuteLane.childElementCount) {
    dom.timeMinuteLane.innerHTML = buildTimeSpinnerMarkup('minute', TIME_MINUTE_VALUES);
  }
  if (dom.timePeriodLane && !dom.timePeriodLane.childElementCount) {
    dom.timePeriodLane.innerHTML = buildTimeSpinnerMarkup('period', TIME_PERIOD_VALUES);
  }
}

function laneForTimePart(part) {
  if (part === 'hour') return dom.timeHourLane;
  if (part === 'minute') return dom.timeMinuteLane;
  if (part === 'period') return dom.timePeriodLane;
  return null;
}

function optionOffsetForCenter(lane, option) {
  return Math.max(0, option.offsetTop - ((lane.clientHeight - option.offsetHeight) / 2));
}

function suppressTimeLaneScroll(lane, duration = 140) {
  if (!lane) return;
  timeSpinnerSuppressUntil.set(lane, performance.now() + duration);
}

function scrollTimeLaneToOption(lane, option, { behavior = 'auto', suppress = true } = {}) {
  if (!lane || !option) return;
  if (suppress) suppressTimeLaneScroll(lane);
  lane.scrollTo({ top: optionOffsetForCenter(lane, option), behavior });
}

function syncTimeLaneSelectionClasses(part, selectedValue) {
  const lane = laneForTimePart(part);
  if (!lane) return;
  lane.querySelectorAll('[data-time-option]').forEach((option) => {
    const isSelected = option.dataset.timeValue === selectedValue
      && Number(option.dataset.timeCycle || 0) === TIME_SPINNER_CENTER_REPEAT;
    option.classList.toggle('is-selected', isSelected);
    option.setAttribute('aria-selected', isSelected ? 'true' : 'false');
  });
}

function syncTimeModalSelectionUi() {
  const parts = getTimeParts(state.timeModal.selectedTime);
  dom.timeSelectionLabel.textContent = formatTimeSelectionText(state.timeModal.selectedTime);
  syncTimeLaneSelectionClasses('hour', parts.hour12);
  syncTimeLaneSelectionClasses('minute', parts.minute);
  syncTimeLaneSelectionClasses('period', parts.period);
}

function centerTimeLaneOnValue(part, value, { behavior = 'auto' } = {}) {
  const lane = laneForTimePart(part);
  if (!lane) return;
  const options = Array.from(lane.querySelectorAll(`[data-time-option="${part}"]`)).filter((option) => option.dataset.timeValue === String(value));
  const target = options[TIME_SPINNER_CENTER_REPEAT] || options[Math.floor(options.length / 2)] || options[0];
  if (!target) return;
  scrollTimeLaneToOption(lane, target, { behavior, suppress: true });
}

function syncTimeSpinnerLanesToSelected({ behavior = 'auto' } = {}) {
  const parts = getTimeParts(state.timeModal.selectedTime);
  centerTimeLaneOnValue('hour', parts.hour12, { behavior });
  centerTimeLaneOnValue('minute', parts.minute, { behavior });
  centerTimeLaneOnValue('period', parts.period, { behavior });
  syncTimeModalSelectionUi();
}

function centeredTimeOptionForLane(lane) {
  if (!lane) return null;
  const center = lane.scrollTop + (lane.clientHeight / 2);
  let closest = null;
  let closestDistance = Infinity;
  lane.querySelectorAll('[data-time-option]').forEach((option) => {
    const optionCenter = option.offsetTop + (option.offsetHeight / 2);
    const distance = Math.abs(optionCenter - center);
    if (distance < closestDistance) {
      closest = option;
      closestDistance = distance;
    }
  });
  return closest;
}

function updateSelectedTimeForLaneValue(part, value) {
  const parts = getTimeParts(state.timeModal.selectedTime);
  if (part === 'hour') parts.hour12 = value;
  if (part === 'minute') parts.minute = value;
  if (part === 'period') parts.period = value;
  state.timeModal.selectedTime = composeTimeValue(parts);
  syncTimeModalSelectionUi();
}

function recenterTimeLane(part, value) {
  centerTimeLaneOnValue(part, value, { behavior: 'auto' });
}

function snapTimeLaneToClosest(lane, part) {
  const option = centeredTimeOptionForLane(lane);
  if (!option) return;
  const value = option.dataset.timeValue || '';
  updateSelectedTimeForLaneValue(part, value);
  scrollTimeLaneToOption(lane, option, { behavior: 'smooth', suppress: true });
  const cycle = Number(option.dataset.timeCycle || 0);
  if (cycle !== TIME_SPINNER_CENTER_REPEAT) {
    window.setTimeout(() => recenterTimeLane(part, value), 140);
  }
}

function scheduleTimeLaneSnap(lane, part) {
  const existingTimer = timeSpinnerScrollTimers.get(part);
  if (existingTimer) window.clearTimeout(existingTimer);
  const timer = window.setTimeout(() => {
    timeSpinnerScrollTimers.delete(part);
    snapTimeLaneToClosest(lane, part);
  }, 80);
  timeSpinnerScrollTimers.set(part, timer);
}

function shiftTimePart(part, delta) {
  const values = timeSpinnerValuesForPart(part);
  if (!values.length) return;
  const parts = getTimeParts(state.timeModal.selectedTime);
  const currentValue = part === 'hour' ? parts.hour12 : part === 'minute' ? parts.minute : parts.period;
  const currentIndex = values.indexOf(currentValue);
  const nextIndex = (currentIndex + delta + values.length) % values.length;
  updateSelectedTimeForLaneValue(part, values[nextIndex]);
  centerTimeLaneOnValue(part, values[nextIndex], { behavior: 'auto' });
}

function renderTimeModal() {
  if (!state.timeModal.isOpen || !dom.timeModal) return;
  renderTimeSpinnerLanes();
  dom.timeTitle.textContent = state.timeModal.title || 'Choose a time';
  dom.timeSubtitle.textContent = state.timeModal.subtitle || '';
  dom.timeHelperText.textContent = state.timeModal.helperText || '';
  dom.timeConfirmButton.textContent = state.timeModal.busy ? 'Working...' : (state.timeModal.confirmLabel || 'Confirm');
  dom.timeConfirmButton.disabled = state.timeModal.busy;
  syncTimeModalSelectionUi();
}

function closeTimeModal({ restoreFocus = true } = {}) {
  if (!state.timeModal.isOpen) return;
  const { returnFocus } = state.timeModal;
  state.timeModal = {
    isOpen: false,
    busy: false,
    title: '',
    subtitle: '',
    confirmLabel: 'Confirm',
    helperText: '',
    selectedTime: '12:00',
    onConfirm: null,
    returnFocus: null,
    metadata: null
  };
  timeSpinnerScrollTimers.forEach((timer) => window.clearTimeout(timer));
  timeSpinnerScrollTimers.clear();
  dom.timeModal.classList.add('hidden');
  syncOverlayBodyState();
  if (restoreFocus && returnFocus instanceof HTMLElement && returnFocus.isConnected) {
    requestAnimationFrame(() => returnFocus.focus({ preventScroll: true }));
  }
}

function openTimeModal({
  title = 'Choose a time',
  subtitle = '',
  confirmLabel = 'Confirm',
  helperText = '',
  initialTime = '12:00',
  onConfirm = null,
  returnFocus = document.activeElement,
  metadata = null
} = {}) {
  state.timeModal = {
    isOpen: true,
    busy: false,
    title,
    subtitle,
    confirmLabel,
    helperText,
    selectedTime: normalizeTimeValue(initialTime),
    onConfirm,
    returnFocus,
    metadata
  };
  renderTimeModal();
  dom.timeModal.classList.remove('hidden');
  dom.body.classList.add('viewer-open');
  requestAnimationFrame(() => {
    syncTimeSpinnerLanesToSelected({ behavior: 'auto' });
    dom.timeHourLane?.focus({ preventScroll: true });
  });
}

async function confirmTimeModal() {
  if (!state.timeModal.isOpen || state.timeModal.busy) return;
  const onConfirm = state.timeModal.onConfirm;
  if (typeof onConfirm !== 'function') {
    closeTimeModal();
    return;
  }
  state.timeModal.busy = true;
  renderTimeModal();
  try {
    await onConfirm(normalizeTimeValue(state.timeModal.selectedTime), state.timeModal.metadata || {});
    closeTimeModal();
  } finally {
    if (state.timeModal.isOpen) {
      state.timeModal.busy = false;
      renderTimeModal();
    }
  }
}

function openJumpDateModal({ returnFocus = document.activeElement } = {}) {
  const minDate = state.bootstrap?.firstDate || '';
  const maxDate = state.bootstrap?.lastDate || '';
  openCalendarModal({
    context: 'jump-date',
    title: 'Jump to a date',
    subtitle: 'Browse to an existing day in your timeline.',
    confirmLabel: 'Jump to date',
    helperText: 'Only days that already have timeline content can be selected.',
    initialDate: state.activeDate || maxDate || minDate,
    visibleMonth: monthKeyFromIso(state.activeDate || maxDate || minDate),
    minDate,
    maxDate,
    isDateEnabled: (isoDate) => state.dateIndexMap[isoDate] !== undefined,
    onConfirm: async (selectedDate) => {
      await scrollToDate(selectedDate, 'auto');
    },
    returnFocus
  });
}

function openUploadForDateModal({ returnFocus = document.activeElement } = {}) {
  const maxDate = state.bootstrap?.today?.isoDate || fileDateToLocalIso(Date.now()) || '';
  const initialDate = topbarUploadDate() || maxDate;
  openCalendarModal({
    context: 'upload-media',
    title: 'Choose an upload date',
    subtitle: 'Pick the day these files belong to.',
    confirmLabel: 'Upload media',
    helperText: 'This opens the upload flow for the selected day.',
    initialDate,
    visibleMonth: monthKeyFromIso(initialDate),
    minDate: '1900-01-01',
    maxDate,
    isDateEnabled: (isoDate) => isWithinCalendarRange(isoDate, '1900-01-01', maxDate),
    onConfirm: async (selectedDate) => {
      beginUploadSelection(selectedDate);
    },
    returnFocus
  });
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
  if (item?.dateSource === 'shared') return 'Shared Book of Life datestamp';
  if (item?.dateSource === 'manual') return 'Custom Book of Life date';
  return 'Upload context date';
}

function uploadTimeValue(item) {
  const match = String(item?.capturedAt || '').match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : '12:00';
}

function buildUploadCapturedAt(isoDate, timeValue = '12:00', fallbackCapturedAt = '') {
  if (!isValidIsoDate(isoDate)) return '';
  const normalizedTime = /^\d{2}:\d{2}$/.test(String(timeValue || ''))
    ? normalizeTimeValue(timeValue)
    : (String(fallbackCapturedAt || '').match(/T(\d{2}:\d{2})/)?.[1] || '12:00');
  return `${isoDate}T${normalizedTime}:00.000Z`;
}

function formatUploadDateTimeLabel(item) {
  if (!isValidIsoDate(item?.isoDate)) return 'No date selected';
  return `${dateRailLabel(item.isoDate)} at ${formatTimeSelectionText(uploadTimeValue(item))}`;
}

function uploadHasOriginalOverride(item) {
  if (!item) return false;
  return item.isoDate !== item.originalIsoDate || uploadTimeValue(item) !== uploadTimeValue({ capturedAt: item.originalCapturedAt });
}

function uploadDateTriggerLabel(item) {
  return isValidIsoDate(item?.isoDate) ? dateRailLabel(item.isoDate) : 'Choose date';
}

function uploadTimeTriggerLabel(item) {
  return formatTimeSelectionText(uploadTimeValue(item));
}

function formatUploadDimensions(item) {
  const width = Number(item?.width || 0);
  const height = Number(item?.height || 0);
  if (!width || !height) return '';
  return `${width} × ${height}`;
}

function formatUploadStats(item) {
  const parts = [formatUploadDimensions(item), formatFileSize(item?.file?.size)];
  return parts.filter(Boolean).join(' · ') || '—';
}

async function extractUploadMetadataDate(file, fallbackIsoDate) {
  const exifr = window.exifr;
  const isImage = /^image\//.test(file?.type || '') || /\.(jpg|jpeg|png|webp|avif|heic|heif|tif|tiff)$/i.test(file?.name || '');
  if (isImage && exifr?.parse) {
    try {
      const exif = await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] });
      const exifDate = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate;
      const exifIsoDate = fileDateToLocalIso(exifDate);
      const exifCapturedAt = fileDateToLocalCapturedAt(exifDate);
      if (exifIsoDate) return { isoDate: exifIsoDate, capturedAt: exifCapturedAt, dateSource: 'exif' };
    } catch (error) {}
  }
  const modifiedIsoDate = fileDateToLocalIso(file?.lastModified);
  const modifiedCapturedAt = fileDateToLocalCapturedAt(file?.lastModified);
  if (modifiedIsoDate) return { isoDate: modifiedIsoDate, capturedAt: modifiedCapturedAt, dateSource: 'last-modified' };
  return {
    isoDate: fallbackIsoDate || '',
    capturedAt: buildUploadCapturedAt(fallbackIsoDate || '', '12:00'),
    dateSource: 'context'
  };
}

async function extractUploadMediaDimensions(file, objectUrl) {
  const isVideo = /^video\//.test(file?.type || '') || /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(file?.name || '');
  if (isVideo) {
    await new Promise((resolve) => {
      const video = document.createElement('video');
      const done = () => resolve();
      video.preload = 'metadata';
      video.onloadedmetadata = done;
      video.onerror = done;
      video.src = objectUrl;
    });
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.src = objectUrl;
    await new Promise((resolve) => {
      probe.onloadedmetadata = () => resolve();
      probe.onerror = () => resolve();
    });
    return { width: Number(probe.videoWidth || 0), height: Number(probe.videoHeight || 0) };
  }
  await new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = objectUrl;
  });
  const probe = new Image();
  probe.src = objectUrl;
  await new Promise((resolve) => {
    probe.onload = () => resolve();
    probe.onerror = () => resolve();
  });
  return { width: Number(probe.naturalWidth || 0), height: Number(probe.naturalHeight || 0) };
}

function createSelectedUploadFile(file) {
  const fallbackIsoDate = state.uploadContext?.isoDate || '';
  const fallbackCapturedAt = buildUploadCapturedAt(fallbackIsoDate, '12:00');
  return {
    id: `upload-${Date.now()}-${state.uploadFileSeq += 1}`,
    file,
    objectUrl: URL.createObjectURL(file),
    isoDate: fallbackIsoDate,
    capturedAt: fallbackCapturedAt,
    originalIsoDate: fallbackIsoDate,
    originalCapturedAt: fallbackCapturedAt,
    originalDateSource: 'context',
    dateSource: 'context'
  };
}

function revokeUploadSelectionFiles(files = state.uploadSelectedFiles) {
  files.forEach((item) => {
    if (item?.objectUrl) URL.revokeObjectURL(item.objectUrl);
  });
}

function clearUploadSelection({ preserveProcessing = false } = {}) {
  revokeUploadSelectionFiles();
  state.uploadSelectedFiles = [];
  state.uploadProgressRatio = 0;
  if (!preserveProcessing) state.uploadProcessing = false;
  state.uploadSharedDateRestore = null;
  setUploadPreparing(false);
  if (dom.uploadFileInput) dom.uploadFileInput.value = '';
}

function updateUploadButtonLabel() {
  if (!dom.uploadSubmitLabel) return;
  const count = state.uploadSelectedFiles.length;
  dom.uploadSubmitLabel.textContent = count ? `Upload ${count} file${count === 1 ? '' : 's'}` : 'Upload';
}

function updateUploadDateToggleLabel() {
  if (dom.uploadDateModeToggle) {
    dom.uploadDateModeToggle.textContent = dom.uploadSetExifDate?.checked ? 'Uploading for' : 'Original file date';
  }
}

function updateUploadSharedDateTriggerLabel() {
  if (!dom.uploadSharedDate) return;
  if (!dom.uploadSharedDate.value) {
    dom.uploadSharedDate.value = state.uploadContext?.isoDate || state.uploadSelectedFiles[0]?.isoDate || '';
  }
  if (dom.uploadContextDateTrigger) {
    dom.uploadContextDateTrigger.textContent = uploadDateTriggerLabel({ isoDate: dom.uploadSharedDate.value });
  }
}

function updateUploadSharedDateUi() {
  if (dom.uploadSharedDate && !dom.uploadSharedDate.value) dom.uploadSharedDate.value = state.uploadContext?.isoDate || state.uploadSelectedFiles[0]?.isoDate || '';
  if (dom.uploadContextDateTrigger) dom.uploadContextDateTrigger.hidden = !Boolean(dom.uploadSetExifDate?.checked);
  updateUploadSharedDateTriggerLabel();
  updateUploadDateToggleLabel();
}

function setUploadContextDate(isoDate) {
  if (!isValidIsoDate(isoDate)) return;
  if (!state.uploadContext) state.uploadContext = { isoDate };
  else state.uploadContext.isoDate = isoDate;
  if (dom.uploadSharedDate) dom.uploadSharedDate.value = isoDate;
  if (dom.uploadSetExifDate?.checked) {
    applySharedUploadDate(isoDate);
    renderUploadPreviews();
  }
  updateUploadSharedDateUi();
}

function applySharedUploadDate(isoDate) {
  if (!isValidIsoDate(isoDate)) return;
  state.uploadSelectedFiles = state.uploadSelectedFiles.map((item) => ({
    ...item,
    isoDate,
    capturedAt: buildUploadCapturedAt(isoDate, uploadTimeValue(item), item.capturedAt),
    dateSource: 'shared'
  }));
}

function setUploadFileDate(fileId, isoDate) {
  if (!isValidIsoDate(isoDate)) return;
  state.uploadSelectedFiles = state.uploadSelectedFiles.map((item) => (
    item.id === fileId
      ? { ...item, isoDate, capturedAt: buildUploadCapturedAt(isoDate, uploadTimeValue(item), item.capturedAt), dateSource: 'manual' }
      : item
  ));
  if (dom.uploadSetExifDate?.checked && dom.uploadSharedDate?.value && dom.uploadSharedDate.value !== isoDate) {
    dom.uploadSetExifDate.checked = false;
    restoreUploadSharedDates();
  }
  updateUploadSharedDateUi();
}

function setUploadFileTime(fileId, timeValue) {
  const normalizedTime = normalizeTimeValue(timeValue);
  state.uploadSelectedFiles = state.uploadSelectedFiles.map((item) => (
    item.id === fileId
      ? { ...item, capturedAt: buildUploadCapturedAt(item.isoDate, normalizedTime, item.capturedAt), dateSource: 'manual' }
      : item
  ));
}

function resetUploadFileDateTime(fileId) {
  state.uploadSelectedFiles = state.uploadSelectedFiles.map((item) => (
    item.id === fileId
      ? {
          ...item,
          isoDate: item.originalIsoDate,
          capturedAt: item.originalCapturedAt,
          dateSource: item.originalDateSource || 'context'
        }
      : item
  ));
}

function openNativeUploadPicker(selector) {
  const input = dom.uploadPreviewList?.querySelector(selector);
  if (!input || input.disabled) return;
  if (typeof input.showPicker === 'function') input.showPicker();
  else input.click();
}

function captureUploadSharedRestoreState() {
  state.uploadSharedDateRestore = state.uploadSelectedFiles.map((item) => ({
    id: item.id,
    isoDate: item.isoDate,
    capturedAt: item.capturedAt,
    dateSource: item.dateSource
  }));
}

function restoreUploadSharedDates() {
  if (!Array.isArray(state.uploadSharedDateRestore)) return;
  const restoreMap = new Map(state.uploadSharedDateRestore.map((item) => [item.id, item]));
  state.uploadSelectedFiles = state.uploadSelectedFiles.map((item) => {
    const restore = restoreMap.get(item.id);
    return restore ? { ...item, isoDate: restore.isoDate, capturedAt: restore.capturedAt, dateSource: restore.dateSource } : item;
  });
  state.uploadSharedDateRestore = null;
}

function setUploadPreparing(preparing) {
  state.uploadPreparing = Boolean(preparing);
  dom.uploadSelectionLoading?.classList.toggle('hidden', !state.uploadPreparing);
  if (dom.uploadSelectionLoadingLabel) {
    dom.uploadSelectionLoadingLabel.textContent = state.uploadProcessing ? 'Finishing upload...' : 'Preparing previews...';
  }
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
  const item = state.uploadSelectedFiles.find((entry) => entry.id === fileId);
  if (!item) return;
  if (!window.confirm(`Remove ${uploadDisplayName(item.file?.name || 'this file')} from the upload list?`)) return;
  const nextFiles = [];
  let removed = null;
  state.uploadSelectedFiles.forEach((item) => {
    if (item.id === fileId && !removed) removed = item;
    else nextFiles.push(item);
  });
  if (removed?.objectUrl) URL.revokeObjectURL(removed.objectUrl);
  state.uploadSelectedFiles = nextFiles;
  if (Array.isArray(state.uploadSharedDateRestore)) {
    state.uploadSharedDateRestore = state.uploadSharedDateRestore.filter((entry) => entry.id !== fileId);
  }
  if (!state.uploadSelectedFiles.length) {
    if (dom.uploadFileInput) dom.uploadFileInput.value = '';
    closeUploadModal();
    return;
  }
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
      const dimensions = await extractUploadMediaDimensions(file, item.objectUrl);
      item.isoDate = metadata.isoDate;
      item.capturedAt = metadata.capturedAt || buildUploadCapturedAt(metadata.isoDate || state.uploadContext?.isoDate || '', '12:00');
      item.width = dimensions.width;
      item.height = dimensions.height;
      item.originalIsoDate = item.isoDate;
      item.originalCapturedAt = item.capturedAt;
      item.originalDateSource = metadata.dateSource;
      item.dateSource = metadata.dateSource;
      if (dom.uploadSetExifDate?.checked && isValidIsoDate(dom.uploadSharedDate?.value)) {
        item.isoDate = dom.uploadSharedDate.value;
        item.capturedAt = buildUploadCapturedAt(dom.uploadSharedDate.value, uploadTimeValue(item), item.capturedAt);
        item.dateSource = 'shared';
      }
      return item;
    }));
    if (Array.isArray(state.uploadSharedDateRestore)) {
      state.uploadSharedDateRestore.push(...batch.map((item) => ({
        id: item.id,
        isoDate: item.originalIsoDate,
        capturedAt: item.originalCapturedAt,
        dateSource: item.originalDateSource
      })));
    }
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

function setTopbarHomeButton({ searchUiOpen = state.searchUiOpen, searchDetailOpen = state.route.view === 'search-detail' } = {}) {
  if (!dom.homeButton) return;
  if (searchUiOpen) {
    dom.homeButton.classList.add('is-search-back');
    dom.homeButton.setAttribute('aria-label', searchDetailOpen ? 'Back to search results' : 'Exit search');
    dom.homeButton.innerHTML = `<span class="topbar-brand-mark" aria-hidden="true">${renderPhIcon('caret-left', { variant: 'bold' })}</span>`;
    return;
  }
  dom.homeButton.classList.remove('is-search-back');
  dom.homeButton.setAttribute('aria-label', 'Go to newest entry');
  dom.homeButton.innerHTML = `<span class="topbar-brand-mark" aria-hidden="true">${renderPhIcon('book-open', { variant: 'fill' })}<span class="topbar-brand-name">Book of Life</span></span>`;
}

function searchTopbarMetaLabel() {
  if (state.route.view === 'search-detail') {
    const total = getSearchDetailHits().length;
    return total ? `${Math.min(state.searchDetailResultIndex + 1, total)} of ${total} matches` : 'No matches';
  }
  if (state.searchLoading) return 'Searching...';
  if (!state.searchMode || !state.searchQuery) return '';
  const total = activeSourceTotal();
  return `${total} result${total === 1 ? '' : 's'}`;
}

function updateTopbarDateLabel() {
  if (!dom.topbarDateLabel) return;
  const searchUiOpen = state.searchUiOpen;
  const searchDetailOpen = state.route.view === 'search-detail';
  setTopbarHomeButton({ searchUiOpen, searchDetailOpen });
  if (searchUiOpen) {
    const title = searchDetailOpen
      ? (getSearchDayByDate(state.searchDetailDate)?.dateLabel || 'Search result')
      : (state.searchQuery ? 'Search' : 'Search your memories');
    dom.topbarDateLabel.textContent = title;
    dom.topbarDateLabel.disabled = true;
    dom.topbarDateLabel.setAttribute('aria-label', title);
    if (dom.topbarMeta) {
      const meta = searchTopbarMetaLabel();
      dom.topbarMeta.textContent = meta;
      dom.topbarMeta.classList.toggle('hidden', !meta);
    }
    return;
  }
  dom.topbarDateLabel.disabled = false;
  dom.topbarDateLabel.setAttribute('aria-label', 'Jump to a specific date');
  dom.topbarDateLabel.innerHTML = `${renderPhIcon('calendar-dots', { variant: 'duotone' })}<span>${escapeHtml(currentTopbarDateLabel())}</span>`;
  if (dom.topbarMeta) {
    dom.topbarMeta.textContent = '';
    dom.topbarMeta.classList.add('hidden');
  }
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
  dom.uploadWindow?.classList.toggle('is-processing', Boolean(state.uploadProcessing));
  dom.uploadWindow?.classList.toggle('is-preparing', Boolean(state.uploadPreparing));
  dom.uploadAddFiles?.classList.toggle('hidden', Boolean(state.uploadXhr || state.uploadProcessing));
  if (dom.uploadSubmit) dom.uploadSubmit.hidden = !state.uploadSelectedFiles.length && !state.uploadXhr && !state.uploadProcessing;
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
  return Math.ceil(dom.topbar?.offsetHeight || (isMobileViewport() ? 78 : 104));
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
  state.theme = AVAILABLE_THEMES.has(theme) ? theme : 'light';
  dom.body.dataset.theme = state.theme;
  localStorage.setItem('lifeserver-theme', state.theme);
  dom.themeChoices.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.themeChoice === state.theme);
  });
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
    photoCount: Number(item?.photoCount || 0),
    photos: [],
    journal: null,
    hasJournal: Boolean(item?.hasJournal),
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

function activeScrollTotal() {
  return state.searchMode ? activeSourceTotal() : state.totalDays;
}

function getGlobalIndexForLocal(localIndex) {
  if (localIndex === null || localIndex === undefined || localIndex < 0) return null;
  const source = activeSourceDays();
  const day = source[localIndex];
  if (!day) return null;
  if (state.searchMode) return localIndex;
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
  state.searchLoading = false;
  state.searchQuery = '';
  state.searchRawDays = [];
  state.searchResultDays = [];
  state.searchResultIndexByDate = {};
  state.searchFolders = [];
  state.searchActiveFolderKeys.clear();
  state.searchDetailDate = '';
  state.searchDetailResultIndex = 0;
  state.searchResultsScrollY = 0;
  state.route = { view: 'home', scrollY: state.homeScrollY || 0 };
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

function activeSearchFolderKeys() {
  return [...state.searchActiveFolderKeys];
}

function cloneSearchDayWithFilters(day, folderKeys) {
  const matchedMedia = Array.isArray(day?.matchedMedia) ? day.matchedMedia : [];
  const countMediaMatches = (items) => items.reduce((sum, item) => sum + Math.max(1, Number(item.searchMatchCount || 0)), 0);
  if (!folderKeys.length) {
    return {
      ...day,
      matchedMedia: [...matchedMedia],
      matchedMediaCount: matchedMedia.length,
      matchCount: Number(day?.journalMatchCount || 0) + countMediaMatches(matchedMedia)
    };
  }
  const filteredMedia = matchedMedia.filter((item) => folderKeys.includes(`${item.folderRootId || ''}::${item.folder || '.'}`));
  if (!filteredMedia.length) return null;
  return {
    ...day,
    matchedMedia: filteredMedia,
    matchedMediaCount: filteredMedia.length,
    matchCount: Number(day?.journalMatchCount || 0) + countMediaMatches(filteredMedia)
  };
}

function applySearchFilters({ preserveWindow = false } = {}) {
  const folderKeys = activeSearchFolderKeys();
  const nextDays = state.searchRawDays
    .map((day) => cloneSearchDayWithFilters(day, folderKeys))
    .filter(Boolean);
  setSearchSource(nextDays);
  state.loadedStart = nextDays.length ? 0 : null;
  state.loadedEnd = nextDays.length ? nextDays.length - 1 : null;
  state.loadedDays = nextDays.length ? [...nextDays] : [];
  if (!preserveWindow) state.activeDate = nextDays[0]?.isoDate || null;
  rebuildViewerSequence();
  renderSearchStatus();
}

function renderSearchStatus() {
  const show = state.searchMode || state.searchLoading || Boolean(state.searchQuery);
  dom.searchStatusSection?.classList.toggle('hidden', !show);
  dom.searchStatusEyebrow?.classList.toggle('hidden', !state.searchLoading);
  if (!show) {
    if (dom.searchStatusTitle) dom.searchStatusTitle.textContent = '';
    if (dom.searchStatusSubtitle) dom.searchStatusSubtitle.textContent = '';
    if (dom.searchFilters) dom.searchFilters.innerHTML = '';
    return;
  }
  const total = activeSourceTotal();
  if (dom.searchStatusTitle) {
    dom.searchStatusTitle.textContent = state.searchLoading
      ? 'Searching your memories'
      : `${total} matching result${total === 1 ? '' : 's'} for "${state.searchQuery}"`;
  }
  if (dom.searchStatusSubtitle) {
    if (state.searchLoading) {
      dom.searchStatusSubtitle.textContent = 'Looking through entries and media descriptions.';
    } else if (!total) {
      dom.searchStatusSubtitle.textContent = 'No matches found. Try another phrase or clear your folder filters.';
    } else if (state.searchActiveFolderKeys.size) {
      dom.searchStatusSubtitle.textContent = `${state.searchActiveFolderKeys.size} folder filter${state.searchActiveFolderKeys.size === 1 ? '' : 's'} active.`;
    } else {
      dom.searchStatusSubtitle.textContent = 'Journal text and media descriptions are included.';
    }
  }
  if (!dom.searchFilters) return;
  const filters = (state.searchFolders || []).map((folder) => {
    const active = state.searchActiveFolderKeys.has(folder.key);
    return `<button class="search-filter-chip ${active ? 'is-active' : ''}" type="button" data-search-folder="${escapeHtml(folder.key)}">${escapeHtml(folder.label)}<span>${folder.count}</span></button>`;
  }).join('');
  dom.searchFilters.innerHTML = filters ? `<div class="search-filter-row">${filters}</div>` : '';
}

function toggleSearchFolder(folderKey) {
  if (!folderKey) return;
  if (state.searchActiveFolderKeys.has(folderKey)) state.searchActiveFolderKeys.delete(folderKey);
  else state.searchActiveFolderKeys.add(folderKey);
  state.searchResultsScrollY = 0;
  applySearchFilters();
  if (activeSourceTotal()) {
    const range = buildWindowRangeAroundIndex(0, 'top');
    setVisibleWindow(range.start, range.end);
  } else {
    renderTimeline();
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
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
  syncOverlayBodyState();
}

function syncTopbarSearchState() {
  dom.body.classList.toggle('search-bar-open', state.searchUiOpen);
  dom.body.classList.toggle('search-ui-open', state.searchUiOpen);
  dom.body.classList.toggle('search-is-idle', state.searchUiOpen && !state.searchLoading && !state.searchMode && !state.searchQuery);
  dom.body.classList.toggle('search-detail-open', state.route.view === 'search-detail');
  dom.searchForm?.classList.toggle('hidden', !state.searchUiOpen);
  dom.searchBackButton?.classList.add('hidden');
  dom.searchDetailNav?.classList.toggle('hidden', state.route.view !== 'search-detail');
  dom.topbarActions?.classList.toggle('hidden', state.searchUiOpen);
  dom.clearSearch?.classList.add('hidden');
  dom.searchCloseButton?.classList.toggle('hidden', !(dom.searchInput?.value || '').trim());
  dom.yearSection?.classList.toggle('hidden', state.searchUiOpen || state.searchMode);
  updateTopbarDateLabel();
}

function openSearchBar() {
  if (!state.searchUiOpen && state.route.view === 'home') state.homeScrollY = window.scrollY;
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
  const shouldClear = clear && (dom.searchInput?.value || state.searchQuery || state.searchMode);
  state.searchUiOpen = false;
  dom.searchDetailView?.classList.add('hidden');
  if (shouldClear && dom.searchInput) {
    dom.searchInput.value = '';
    restoreHomeTimelineState();
    await goHome({ push: false, restoreScroll: false, scrollY: state.homeScrollY || 0 });
    await ensureTimelineLoaded(state.bootstrap?.lastDate);
    window.scrollTo({ top: state.homeScrollY || 0, behavior: 'auto' });
    renderTimeline();
    renderDefaultYearSubtitle();
    renderSearchStatus();
  } else if (!shouldClear) {
    restoreHomeTimelineState();
    await goHome({ push: false, restoreScroll: false, scrollY: state.homeScrollY || 0 });
    await ensureTimelineLoaded(state.bootstrap?.lastDate);
    window.scrollTo({ top: state.homeScrollY || 0, behavior: 'auto' });
    renderTimeline();
    renderDefaultYearSubtitle();
    renderSearchStatus();
  }
  syncTopbarSearchState();
  updateTopbarDateLabel();
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
  dom.uploadPreviewList.innerHTML = dom.uploadPreviewList.innerHTML.replace(/<input class="upload-preview-date-input"[^>]*>/g, '');
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
  dom.uploadPreviewList.innerHTML = dom.uploadPreviewList.innerHTML.replace(/<input class="upload-preview-date-input"[^>]*>/g, '');
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
  dom.uploadPreviewList.innerHTML = dom.uploadPreviewList.innerHTML.replace(/<input class="upload-preview-date-input"[^>]*>/g, '');
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
  dom.uploadTitle.textContent = `Upload media`;
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
  state.uploadProcessing = false;
  if (state.uploadXhr) {
    dom.uploadModal.classList.add('hidden');
    dom.uploadResumeLabel.textContent = dom.uploadSubmitLabel?.textContent || 'Uploading…';
    dom.uploadResume?.classList.remove('hidden');
    syncOverlayBodyState();
    return;
  }
  state.uploadContext = null;
  state.uploadCreatingFolder = null;
  clearUploadSelection();
  renderUploadPreviews();
  dom.uploadModal.classList.add('hidden');
  dom.uploadResume?.classList.add('hidden');
  updateUploadUiState();
  syncOverlayBodyState();
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
  const sharedOverrideActive = Boolean(dom.uploadSetExifDate?.checked);
  dom.uploadPreviewList.innerHTML = files.map((item) => {
    const file = item.file;
    const isVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(file.name);
    const displayName = uploadDisplayName(file.name);
    const previewThumb = isVideo
      ? `<video src="${item.objectUrl}" muted playsinline preload="none"></video><span class="upload-preview-video">${renderPhIcon('play-fill', { variant: 'fill' })}</span>`
      : `<img src="${item.objectUrl}" alt="${escapeHtml(file.name)}" loading="lazy" decoding="async" />`;
    const controlsDisabled = state.uploadXhr || sharedOverrideActive;
    return `<div class="upload-preview-card ${state.uploadXhr ? '' : 'is-removable'}"><div class="upload-preview-thumb">${previewThumb}${state.uploadXhr ? '' : `<button class="upload-preview-remove" type="button" data-upload-remove="${item.id}" aria-label="Remove ${escapeHtml(file.name)}">${renderPhIcon('x', { variant: 'bold' })}</button>`}</div><div class="upload-preview-meta"><div class="upload-preview-meta-row"><div class="upload-preview-meta-copy"><strong title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</strong></div><div class="upload-preview-fields"><button class="upload-preview-trigger" type="button" data-upload-date-trigger="${item.id}" ${controlsDisabled ? 'disabled' : ''}>${escapeHtml(uploadDateTriggerLabel(item))}</button><span class="upload-preview-connector">at</span><button class="upload-preview-trigger" type="button" data-upload-time-trigger="${item.id}" ${controlsDisabled ? 'disabled' : ''}>${escapeHtml(uploadTimeTriggerLabel(item))}</button>${uploadHasOriginalOverride(item) && !controlsDisabled ? `<button class="upload-preview-reset" type="button" data-upload-reset="${item.id}" aria-label="Reset date and time for ${escapeHtml(displayName)}">${renderPhIcon('arrow-counter-clockwise', { variant: 'bold' })}</button>` : ''}<input class="upload-preview-picker-input" type="date" data-upload-date-input="${item.id}" value="${escapeHtml(item.isoDate || '')}" ${controlsDisabled ? 'disabled' : ''} /><input class="upload-preview-picker-input" type="time" data-upload-time-input="${item.id}" value="${escapeHtml(uploadTimeValue(item))}" step="60" ${controlsDisabled ? 'disabled' : ''} /></div><div class="upload-preview-stats">${escapeHtml(formatUploadStats(item))}</div></div><div class="upload-preview-progress"><span class="upload-preview-progress-fill" data-upload-progress="${item.id}"></span></div></div></div>`;
  }).join('');
  if (dom.uploadAddFiles) dom.uploadPreviewList.appendChild(dom.uploadAddFiles);
  updateUploadPreviewProgress();
}

function handleUploadSharedDateToggle() {
  if (dom.uploadSetExifDate?.checked) {
    captureUploadSharedRestoreState();
    if (!isValidIsoDate(dom.uploadSharedDate?.value)) dom.uploadSharedDate.value = state.uploadContext?.isoDate || state.uploadSelectedFiles[0]?.isoDate || '';
    if (isValidIsoDate(dom.uploadSharedDate?.value)) applySharedUploadDate(dom.uploadSharedDate.value);
  } else {
    restoreUploadSharedDates();
  }
  updateUploadSharedDateUi();
  renderUploadPreviews();
}

async function openUploadModal(isoDate) {
  state.uploadContext = { isoDate };
  // dom.uploadTitle.textContent = `Add media for ${dateRailLabel(isoDate)}`;
  dom.uploadTitle.textContent = `Upload media`;
  if (!state.uploadXhr) {
    state.uploadProgressRatio = 0;
    state.uploadProcessing = false;
    dom.uploadSetExifDate.checked = false;
    if (dom.uploadSharedDate) dom.uploadSharedDate.value = isoDate || '';
    state.uploadSharedDateRestore = null;
    updateUploadSharedDateTriggerLabel();
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
  form.append('fileDateTimes', JSON.stringify(state.uploadSelectedFiles.map((item) => ({
    isoDate: item.isoDate || state.uploadContext?.isoDate || '',
    capturedAt: buildUploadCapturedAt(item.isoDate || state.uploadContext?.isoDate || '', uploadTimeValue(item), item.capturedAt)
  }))));
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
    state.uploadProcessing = true;
    dom.uploadSubmit.disabled = false;
    dom.uploadCancel?.classList.add('hidden');
    let payload = {};
    try { payload = JSON.parse(xhr.responseText || '{}'); } catch (error) {}
    if (xhr.status < 200 || xhr.status >= 300) {
      state.uploadProcessing = false;
      updateUploadUiState();
      if (dom.uploadSubmitLabel) dom.uploadSubmitLabel.textContent = payload.error || 'Upload failed';
      renderUploadFolderTree();
      updateUploadPreviewProgress();
      return;
    }
    dom.uploadSubmit.style.setProperty('--upload-progress', '100%');
    if (dom.uploadSubmitLabel) dom.uploadSubmitLabel.textContent = 'Finishing upload...';
    clearUploadSelection({ preserveProcessing: true });
    setUploadPreparing(true);
    updateUploadUiState();
    renderUploadFolderTree();
    renderUploadPreviews();
    await refreshBootstrap(payload.isoDate || state.uploadContext.isoDate);
    closeUploadModal();
  });
  xhr.addEventListener('abort', () => {
    state.uploadXhr = null;
    state.uploadProgressRatio = 0;
    state.uploadProcessing = false;
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
    state.uploadProcessing = false;
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
  const fileDateTimes = state.uploadSelectedFiles.map((item) => ({
    isoDate: item.isoDate || state.uploadContext?.isoDate || '',
    capturedAt: buildUploadCapturedAt(item.isoDate || state.uploadContext?.isoDate || '', uploadTimeValue(item), item.capturedAt)
  }));
  const form = new FormData();
  form.append('rootId', state.uploadTarget.rootId || '0');
  form.append('relativePath', state.uploadTarget.relativePath || '');
  form.append('targetIsoDate', state.uploadContext.isoDate);
  form.append('setExifDate', dom.uploadSetExifDate.checked ? '1' : '0');
  form.append('fileDates', JSON.stringify(fileDates));
  form.append('fileDateTimes', JSON.stringify(fileDateTimes));
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
    state.uploadProcessing = true;
    dom.uploadSubmit.disabled = false;
    dom.uploadCancel?.classList.add('hidden');
    let payload = {};
    try { payload = JSON.parse(xhr.responseText || '{}'); } catch (error) {}
    if (xhr.status < 200 || xhr.status >= 300) {
      state.uploadProcessing = false;
      updateUploadUiState();
      if (dom.uploadSubmitLabel) dom.uploadSubmitLabel.textContent = payload.error || 'Upload failed';
      renderUploadFolderTree();
      updateUploadPreviewProgress();
      return;
    }
    dom.uploadSubmit.style.setProperty('--upload-progress', '100%');
    if (dom.uploadSubmitLabel) dom.uploadSubmitLabel.textContent = 'Finishing upload...';
    clearUploadSelection({ preserveProcessing: true });
    setUploadPreparing(true);
    updateUploadUiState();
    renderUploadFolderTree();
    renderUploadPreviews();
    await refreshBootstrap(payload.isoDate || state.uploadContext.isoDate);
    closeUploadModal();
  });
  xhr.addEventListener('abort', () => {
    state.uploadXhr = null;
    state.uploadProgressRatio = 0;
    state.uploadProcessing = false;
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
    state.uploadProcessing = false;
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
    const tail = !state.searchMode && index === previewLines.length - 1 ? `<button class="expand-inline" type="button" data-journal-toggle="${day.isoDate}">Read more</button>` : '';
    return `<span class="journal-preview-line">${safeLine}${tail}</span>`;
  }).join('');

  return `
    <section class="journal-wrap">
      ${!expanded ? `<div class="journal-preview">${previewHtml}</div>` : ''}
      ${expanded ? `<div class="journal-body">${highlightJournalHtml(journal.fullHtml, highlightQuery)}</div><div class="expand-row"><button class="collapse-link" type="button" data-journal-toggle="${day.isoDate}">Show less</button></div>` : ''}
    </section>
  `;
}

function searchMatchLabel(day) {
  const count = Number(day?.matchCount || 0);
  return `${count} match${count === 1 ? '' : 'es'} found`;
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
  const searchCompact = state.searchMode;
  const media = searchCompact ? (day.matchedMedia || []) : (day.photos || []);
  let mediaHtml = '';
  const entryActionHtml = searchCompact
    ? `<button class="journal-edit-button icon-button" type="button" data-open-search-detail="${day.isoDate}" aria-label="Open search result">${renderPhIcon('arrow-right', { variant: 'bold' })}</button>`
    : buildEntryAction(day);
  const uploadActionHtml = searchCompact ? '' : buildUploadAction(day);

  if (media.length) {
    mediaHtml = `<div class="photo-grid">${media.map((item) => buildMediaTile(item, 'photo-grid-button', { badge: item.searchMatch ? '<span class="media-badge-dot"></span>' : '' })).join('')}</div>`;
  }

  const muted = searchCompact
    ? searchMatchLabel(day)
    : (day.photoCount ? `${day.photoCount} media` : (day.journal ? formatWordCount(day.journal.wordCount ?? 0) : ''));
  const cardAttrs = searchCompact
    ? ` role="button" tabindex="0" data-open-search-detail="${day.isoDate}" aria-label="${escapeHtml(`Open search result for ${day.dateLabel}`)}"`
    : '';

  return `
    <article class="day-block" data-day-date="${day.isoDate}" data-day-index="${state.dateIndexMap[day.isoDate] ?? ''}" data-month-label="${escapeHtml(day.monthLabel)}">
      <section class="entry-card ${searchCompact ? 'is-search-result' : ''}"${cardAttrs}>
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

function viewerSourceDays() {
  if (state.searchMode) return state.loadedDays;
  if (state.fullTimelineLoaded && state.fullTimelineDays.length) return state.fullTimelineDays;
  return state.loadedDays;
}

function rebuildViewerSequence({ preferredMediaId = null, refreshOpenViewer = false, forceDateToast = false } = {}) {
  const fallbackMediaId = preferredMediaId || mediaViewer.getCurrentItem()?.id || null;
  state.viewerSequence = viewerSourceDays().flatMap((day) => (state.searchMode ? (day.matchedMedia || []) : (day.photos || [])).map((photo) => photo));
  if (!refreshOpenViewer || !mediaViewer.isOpen()) return;
  if (!state.viewerSequence.length) {
    mediaViewer.close({ animate: false });
    return;
  }
  const currentIndex = mediaViewer.getCurrentIndex();
  const preferredIndex = fallbackMediaId
    ? state.viewerSequence.findIndex((photo) => photo.id === fallbackMediaId)
    : currentIndex;
  mediaViewer.refresh({
    preferredIndex: preferredIndex >= 0 ? preferredIndex : Math.min(currentIndex, state.viewerSequence.length - 1),
    forceDateToast
  });
}

function shouldShowMonthDivider(localIndex) {
  const source = activeSourceDays();
  const day = source[localIndex];
  const newerDay = localIndex > 0 ? source[localIndex - 1] : null;
  return Boolean(day && (!newerDay || day.monthKey !== newerDay.monthKey));
}

function buildTimelineUnitHeaderHtml(day, localIndex, globalIndex) {
  const newestGap = !state.searchMode && localIndex === 0 ? buildNewestGapCard(day, globalIndex) : null;
  const monthDividerHtml = shouldShowMonthDivider(localIndex)
    ? `<div class="month-divider"><span class="month-divider-label">${escapeHtml(day.monthLabel)}</span></div>`
    : '';
  const newestGapOwnDividerHtml = newestGap?.html && newestGap.monthKey !== day.monthKey
    ? `<div class="month-divider"><span class="month-divider-label">${escapeHtml(newestGap.monthLabel)}</span></div>`
    : '';
  const newestGapCardHtml = newestGap?.html || '';

  return {
    newestGapHtml: newestGapOwnDividerHtml ? `${newestGapOwnDividerHtml}${newestGapCardHtml}` : newestGapCardHtml,
    monthDividerHtml
  };
}

function buildTimelineUnitHtml(localIndex) {
  const source = activeSourceDays();
  const day = source[localIndex];
  if (!day) return '';
  const hydrated = state.searchMode || (isLoadedLocalIndex(localIndex) && isHydratedHomeDay(localIndex));

  const globalIndex = getGlobalIndexForLocal(localIndex);
  const { newestGapHtml, monthDividerHtml } = buildTimelineUnitHeaderHtml(day, localIndex, globalIndex);
  const gapHtml = !state.searchMode && localIndex < source.length - 1
    ? buildGapCardHtml(day, source[localIndex + 1])
    : '';
  return `
    <section class="timeline-unit ${hydrated ? 'is-hydrated' : 'is-placeholder'}" data-source-index="${localIndex}" data-day-date="${day.isoDate}">
      <div class="timeline-unit-month-divider">${monthDividerHtml}</div>
      <div class="timeline-unit-newest-gap">${newestGapHtml}</div>
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
  const { newestGapHtml, monthDividerHtml } = buildTimelineUnitHeaderHtml(day, localIndex, globalIndex);
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
  return 10;
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

function refreshTimelineHeightMetrics({ anchor = null } = {}) {
  const units = Array.from(document.querySelectorAll('#timelineFeed .timeline-unit.is-hydrated'));
  if (!units.length) return;
  const previousMeasuredHeights = new Map(state.timelineMeasuredHeights);
  let totalHeight = 0;
  let count = 0;
  let compensationDelta = 0;
  const anchorDocumentY = timelineMarkerDocumentY();
  const nextMeasuredHeights = [];
  let virtualTop = 0;
  units.forEach((node) => {
    const localIndex = Number(node.dataset.sourceIndex);
    const day = activeSourceDays()[localIndex];
    const height = Math.max(1, Math.round(node.getBoundingClientRect().height));
    const previousHeight = estimateHeightForDayFromSnapshot(day, previousMeasuredHeights);
    if (day?.isoDate) nextMeasuredHeights.push([day.isoDate, height]);
    const documentTop = (window.scrollY + dom.timelinePane.getBoundingClientRect().top + Number(dom.timelineTopSpacer.style.height.replace('px', '') || 0)) + virtualTop;
    if (!isTimelineCorrectionSuppressed() && documentTop < anchorDocumentY && previousHeight !== height) {
      compensationDelta += (height - previousHeight);
    }
    totalHeight += height;
    count += 1;
    virtualTop += previousHeight;
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

  if (state.searchMode) {
    state.loadedStart = 0;
    state.loadedEnd = source.length - 1;
    syncLoadedDaysFromWindow();
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
  if (state.searchMode) return false;
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
  if (state.searchMode) return;
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
  if (!state.mediaObserver) {
    state.mediaObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        enqueueMediaLoad(entry.target);
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '120px 0px 120px 0px' });
  }

  document.querySelectorAll('#timelineFeed .lazy-media').forEach((node) => {
    if (node.dataset.mediaObserved === '1') return;
    state.mediaObserver.observe(node);
    node.dataset.mediaObserved = '1';
  });
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
  const isoDate = state.searchMode
    ? (indexOverride !== null ? activeSourceDays()[indexOverride]?.isoDate : state.activeDate)
    : (indexOverride !== null ? state.indexToDate[indexOverride] : state.activeDate);
  dom.scrollThumbLabel.textContent = monthChipLabel(isoDate);
}

function syncScrollThumbPosition(indexOverride = null) {
  const activeIndex = indexOverride !== null
    ? indexOverride
    : (state.searchMode
      ? getLocalIndexForDate(state.activeDate)
      : (state.activeDate && state.dateIndexMap[state.activeDate] !== undefined ? state.dateIndexMap[state.activeDate] : null));
  const total = activeScrollTotal();
  if (activeIndex === null || activeIndex === undefined || total <= 1) {
    dom.scrollHandle.style.top = '50%';
    return;
  }
  const minY = Math.max(topOffset() + 18, 88);
  const maxY = window.innerHeight - 88;
  const span = Math.max(140, maxY - minY);
  const ratio = 1 - (activeIndex / Math.max(1, total - 1));
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
  const positionRatio = clamp((clientY - minY) / Math.max(1, maxY - minY), 0, 1);
  const ratio = 1 - positionRatio;
  const total = activeScrollTotal();
  return clamp(Math.round(ratio * Math.max(0, total - 1)), 0, Math.max(0, total - 1));
}

async function jumpToIndex(index, behavior = 'auto') {
  if (state.searchMode) {
    const localIndex = clamp(index, 0, Math.max(0, activeSourceTotal() - 1));
    const range = buildWindowRangeAroundIndex(localIndex, 'center');
    setVisibleWindow(range.start, range.end);
    requestAnimationFrame(() => {
      const unit = dom.timelineFeed.querySelector(`.timeline-unit[data-source-index="${localIndex}"]`);
      if (!unit) return;
      const top = Math.max(0, window.scrollY + unit.getBoundingClientRect().top - topOffset());
      window.scrollTo({ top, behavior });
      state.activeDate = unit.dataset.dayDate || state.activeDate;
      syncScrollThumb();
    });
    return;
  }
  const isoDate = state.indexToDate[index];
  if (!isoDate) return;
  await goHome({ push: false });
  await scrollToDate(isoDate, behavior);
}

function scrollToTimelineUnitIndex(index, behavior = 'auto') {
  if (state.route.view !== 'home') return false;
  if (state.searchMode) {
    const localIndex = clamp(index, 0, Math.max(0, activeSourceTotal() - 1));
    let unit = dom.timelineFeed.querySelector(`.timeline-unit[data-source-index="${localIndex}"]`);
    const range = buildWindowRangeAroundIndex(localIndex, 'center');
    if (range.start !== state.loadedStart || range.end !== state.loadedEnd) {
      setVisibleWindow(range.start, range.end);
      unit = dom.timelineFeed.querySelector(`.timeline-unit[data-source-index="${localIndex}"]`);
    }
    if (!unit) return false;
    suppressTimelineCorrection(280);
    const top = Math.max(0, window.scrollY + unit.getBoundingClientRect().top - topOffset());
    window.scrollTo({ top, behavior });
    const isoDate = unit.dataset.dayDate;
    if (isoDate) state.activeDate = isoDate;
    syncScrollThumb();
    updateTopbarDateLabel();
    return true;
  }
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
  state.loadedDays.forEach((day) => {
    (day.photos || []).forEach((photo) => {
      if (photo.id === photoId) mutator(photo);
    });
    (day.matchedMedia || []).forEach((photo) => {
      if (photo.id === photoId) mutator(photo);
    });
  });
  state.viewerSequence.forEach((photo) => {
    if (photo.id === photoId) mutator(photo);
  });
}

function sortClientDayPhotos(photos) {
  return photos.slice().sort((a, b) => String(b.capturedAt || '').localeCompare(String(a.capturedAt || '')) || String(a.fileName || '').localeCompare(String(b.fileName || '')));
}

function rebuildViewerSequenceFromLoadedDays() {
  rebuildViewerSequence();
}

function movePhotoWithinLoadedDays(previousPhoto, nextPhoto) {
  if (!previousPhoto?.id || !nextPhoto?.id) return false;
  const sourceDay = state.loadedDays.find((day) => day.isoDate === previousPhoto.isoDate);
  const targetDay = state.loadedDays.find((day) => day.isoDate === nextPhoto.isoDate);

  if (!sourceDay && !targetDay) return false;
  if (sourceDay && !targetDay && previousPhoto.isoDate !== nextPhoto.isoDate) return false;

  if (sourceDay) {
    sourceDay.photos = sourceDay.photos.filter((photo) => photo.id !== previousPhoto.id);
    sourceDay.photoCount = sourceDay.photos.length;
  }

  const destinationDay = targetDay || sourceDay;
  if (!destinationDay) return false;
  destinationDay.photos = sortClientDayPhotos([
    ...destinationDay.photos.filter((photo) => photo.id !== nextPhoto.id),
    nextPhoto
  ]);
  destinationDay.photoCount = destinationDay.photos.length;

  rebuildViewerSequenceFromLoadedDays();
  return true;
}

function buildClientPhotoFromPayload(currentPhoto, payloadPhoto) {
  if (!payloadPhoto) return null;
  return {
    ...currentPhoto,
    ...payloadPhoto,
    thumbUrl: payloadPhoto.thumbUrl || `/media/thumb/${payloadPhoto.id}`,
    previewUrl: payloadPhoto.previewUrl || (payloadPhoto.type === 'video' ? `/media/preview/${payloadPhoto.id}` : ''),
    fullUrl: payloadPhoto.fullUrl || `/media/full/${payloadPhoto.id}`,
    dateLabel: payloadPhoto.dateLabel || dateRailLabel(payloadPhoto.isoDate)
  };
}

function applyClientMediaDateMutation(previousPhoto, payloadPhoto) {
  const currentPhoto = state.viewerSequence.find((photo) => photo.id === previousPhoto?.id) || previousPhoto;
  const nextPhoto = buildClientPhotoFromPayload(currentPhoto, payloadPhoto);
  if (!nextPhoto) return null;

  const movedWithinLoadedDays = movePhotoWithinLoadedDays(currentPhoto, nextPhoto);
  if (!movedWithinLoadedDays) {
    syncViewerMediaMutation(currentPhoto.id, (photo) => Object.assign(photo, nextPhoto));
    state.viewerSequence = state.viewerSequence.map((photo) => (photo.id === currentPhoto.id ? { ...photo, ...nextPhoto } : photo));
  }

  return nextPhoto;
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

function queueMediaLikeSave(photoId, liked) {
  const existing = pendingMediaLikeSaves.get(photoId);
  if (existing) window.clearTimeout(existing.timerId);
  const version = (mediaLikeSaveVersions.get(photoId) || 0) + 1;
  mediaLikeSaveVersions.set(photoId, version);

  const timerId = window.setTimeout(async () => {
    const pending = pendingMediaLikeSaves.get(photoId);
    if (!pending || pending.timerId !== timerId) return;

    pendingMediaLikeSaves.delete(photoId);
    try {
      const payload = await fetchJson(`/api/media/${photoId}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ liked: pending.liked })
      });
      if (mediaLikeSaveVersions.get(photoId) !== pending.version) return;
      const persistedLiked = Boolean(payload?.liked);
      syncViewerMediaMutation(photoId, (photo) => { photo.liked = persistedLiked; });
      syncMediaTileLikedState(photoId, persistedLiked);
    } catch (error) {
      console.error('Failed to persist like state.', error);
    }
  }, MEDIA_LIKE_SAVE_DELAY_MS);

  pendingMediaLikeSaves.set(photoId, {
    liked: Boolean(liked),
    version,
    timerId
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
  if (!state.searchMode && !state.fullTimelineLoaded && state.totalDays > 0) {
    void ensureFullTimelineLoaded()
      .then(() => rebuildViewerSequence({ preferredMediaId: mediaId, refreshOpenViewer: mediaViewer.isOpen() }))
      .catch(() => {});
  }
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

  const localIndex = activeSourceIndexByDate()[isoDate];
  if (
    !state.searchMode
    && Number.isInteger(localIndex)
    && dom.timelineFeed.querySelector('.timeline-unit')
  ) {
    refreshHomeTimelineWindow({ indexes: [localIndex] });
  } else {
    renderTimeline();
  }

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

function handleGapCardClick(card) {
  const startIso = card?.dataset.gapRangeStart || '';
  const endIso = card?.dataset.gapRangeEnd || '';
  const gapDays = Number(card?.dataset.gapDays || 0);
  if (!startIso || !endIso || gapDays <= 0) return;
  if (gapDays === 1) {
    openEditorForDate(startIso, { create: true });
    return;
  }
  const todayIso = state.bootstrap?.today?.isoDate || '';
  openCalendarModal({
    context: 'create-entry',
    title: 'Choose an entry date',
    subtitle: `Gap from ${monthDayLabel(startIso)} to ${monthDayLabel(endIso)}`,
    confirmLabel: 'Create entry',
    helperText: 'Pick one of the missing days to start a journal entry.',
    initialDate: isWithinCalendarRange(todayIso, startIso, endIso) ? todayIso : startIso,
    minDate: startIso,
    maxDate: endIso,
    isDateEnabled: (isoDate) => isWithinCalendarRange(isoDate, startIso, endIso),
    onConfirm: async (selectedDate) => {
      openEditorForDate(selectedDate, { create: true });
    }
  });
}

async function runSearch(query) {
  const term = String(query || '').trim();
  const previousDetailDate = state.route.view === 'search-detail' ? state.searchDetailDate : '';
  const previousDetailIndex = state.route.view === 'search-detail' ? state.searchDetailResultIndex : 0;
  const requestId = ++state.searchRequestSeq;
  state.activeSearchRequest = requestId;
  state.searchQuery = term;
  state.searchLoading = Boolean(term);
  syncTopbarSearchState();
  state.scrollPreviewIndex = null;
  state.scrollHandleQueuedIndex = null;
  state.scrollHandleBusy = false;
  dom.clearSearch.classList.toggle('hidden', !term);
  renderSearchStatus();
  if (state.searchAbortController) {
    state.searchAbortController.abort();
    state.searchAbortController = null;
  }
  if (!term) {
    state.searchLoading = false;
    restoreHomeTimelineState();
    syncTopbarSearchState();
    dom.yearCarouselShell?.classList.remove('hidden');
    if (dom.yearSectionTitle) dom.yearSectionTitle.textContent = 'Browse your years';
    renderDefaultYearSubtitle();
    renderSearchStatus();
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
    state.searchLoading = false;
    syncTopbarSearchState();
    renderSearchStatus();
    throw error;
  } finally {
    if (state.searchAbortController === controller) state.searchAbortController = null;
  }

  if (requestId !== state.activeSearchRequest || state.searchQuery !== term) return;

  state.searchLoading = false;
  state.searchMode = true;
  syncTopbarSearchState();
  state.searchRawDays = Array.isArray(response.days) ? [...response.days] : [];
  state.searchFolders = Array.isArray(response.folders) ? [...response.folders] : [];
  state.searchActiveFolderKeys.clear();
  applySearchFilters({ preserveWindow: Boolean(previousDetailDate) });
  dom.yearCarouselShell?.classList.add('hidden');
  if (dom.yearSectionTitle) dom.yearSectionTitle.textContent = 'Book of Life';
  renderDefaultYearSubtitle();
  if (previousDetailDate && getSearchDayByDate(previousDetailDate)) {
    state.activeDate = previousDetailDate;
    openSearchDetail(previousDetailDate, { push: false, resultIndex: previousDetailIndex });
  } else if (state.searchResultDays.length) {
    await goHome({ push: false, restoreScroll: false });
    if (requestId !== state.activeSearchRequest || state.searchQuery !== term) return;
    state.activeDate = state.searchResultDays[0]?.isoDate || null;
    setVisibleWindow(0, state.searchResultDays.length - 1);
  } else {
    await goHome({ push: false, restoreScroll: false });
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
  renderSearchStatus();
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
  dom.searchDetailView.classList.add('hidden');
  dom.explorerView.classList.add('hidden');
  dom.body.classList.remove('explorer-open');
  if (!state.searchMode) dom.yearCarouselShell?.classList.remove('hidden');
}

function showSearchDetailView() {
  dom.searchDetailView.classList.remove('hidden');
  dom.homeView.classList.add('hidden');
  dom.explorerView.classList.add('hidden');
  dom.body.classList.add('explorer-open');
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function showExplorerView() {
  dom.explorerView.classList.remove('hidden');
  dom.searchDetailView.classList.add('hidden');
  dom.homeView.classList.add('hidden');
  dom.body.classList.add('explorer-open');
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function getSearchDayByDate(isoDate) {
  const localIndex = state.searchResultIndexByDate[isoDate];
  return localIndex === undefined ? null : state.searchResultDays[localIndex];
}

function getSearchDetailHits() {
  return Array.from(dom.searchDetailBody?.querySelectorAll('.search-hit') || []);
}

function focusSearchDetailResult(index = state.searchDetailResultIndex) {
  const day = getSearchDayByDate(state.searchDetailDate);
  const targets = getSearchDetailTargets(day);
  if (!targets.length) return;
  state.searchDetailResultIndex = clamp(index, 0, targets.length - 1);
  dom.searchDetailSubtitle.textContent = `${searchMatchLabel(day || { matchCount: 0 })} • result ${state.searchDetailResultIndex + 1} of ${targets.length}`;
  dom.searchDetailPrevResult.disabled = state.searchDetailResultIndex <= 0;
  dom.searchDetailNextResult.disabled = state.searchDetailResultIndex >= targets.length - 1;
  document.querySelectorAll('[data-search-result-target]').forEach((node, nodeIndex) => {
    node.classList.toggle('is-active-search-target', nodeIndex === state.searchDetailResultIndex);
  });
  const target = document.querySelector(`[data-search-result-target="${targets[state.searchDetailResultIndex].key}"]`);
  target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function buildSearchDetailBody(day) {
  if (!day) return '<div class="empty-state"><h2>Search result not found</h2><p>Return to the search results and try again.</p></div>';
  const mediaGrid = (day.matchedMedia || []).length
    ? `<div class="photo-grid">${day.matchedMedia.map((item) => `<div class="search-detail-media-card" data-search-result-target="${item.id}">${buildMediaTile(item, 'photo-grid-button', { badge: '<span class="media-badge-dot"></span>' })}<p class="search-detail-media-caption">${highlightPlainText(item.description || item.fileName || '', state.searchQuery)}</p></div>`).join('')}</div>`
    : '<p class="search-detail-empty">No matching media descriptions in this entry.</p>';
  const journalHtml = day.journal
    ? `<section class="search-detail-section ${day.journalMatch ? 'is-result-section' : ''}" ${day.journalMatch ? 'data-search-result-target="journal"' : ''}>
        <div class="search-detail-section-head">
          <h3>Journal</h3>
          ${day.journalMatch ? `<span class="search-detail-pill">Match</span>` : ''}
        </div>
        <div class="journal-wrap"><div class="journal-body">${highlightJournalHtml(day.journal.fullHtml, state.searchQuery)}</div></div>
      </section>`
    : '';
  return `
    <article class="search-detail-entry">
      ${journalHtml}
      <section class="search-detail-section">
        <div class="search-detail-section-head">
          <h3>Matched media</h3>
          <span class="search-detail-pill">${day.matchedMediaCount || 0}</span>
        </div>
        ${mediaGrid}
      </section>
    </article>
  `;
}

function renderSearchDetail() {
  const day = getSearchDayByDate(state.searchDetailDate);
  const targets = getSearchDetailTargets(day);
  dom.searchDetailTitle.textContent = day?.dateLabel || 'Search result';
  dom.searchDetailSubtitle.textContent = `${searchMatchLabel(day || { matchCount: 0 })}${targets.length ? ` • result ${Math.min(state.searchDetailResultIndex + 1, targets.length)} of ${targets.length}` : ''}`;
  dom.searchDetailBody.innerHTML = buildSearchDetailBody(day);
  dom.searchDetailPrevResult.disabled = targets.length <= 1 || state.searchDetailResultIndex <= 0;
  dom.searchDetailNextResult.disabled = targets.length <= 1 || state.searchDetailResultIndex >= Math.max(0, targets.length - 1);
  focusSearchDetailResult(state.searchDetailResultIndex);
}

function openSearchDetail(isoDate, { push = true, resultIndex = 0 } = {}) {
  const day = getSearchDayByDate(isoDate);
  if (!day) return;
  state.searchResultsScrollY = window.scrollY;
  state.searchDetailDate = isoDate;
  state.searchDetailResultIndex = resultIndex;
  renderSearchDetail();
  showSearchDetailView();
  syncTopbarSearchState();
  state.route = { view: 'search-detail', entryDate: isoDate, resultIndex, scrollY: state.searchResultsScrollY };
  if (push) history.pushState({ view: 'search-detail', entryDate: isoDate, resultIndex, scrollY: state.searchResultsScrollY }, '', `#search-${isoDate}`);
}

function buildSearchDetailBody(day) {
  if (!day) return '<div class="empty-state"><h2>Search result not found</h2><p>Return to the search results and try again.</p></div>';
  const mediaGrid = (day.matchedMedia || []).length
    ? `<div class="photo-grid">${day.matchedMedia.map((item) => `<div class="search-detail-media-card">${buildMediaTile(item, 'photo-grid-button', { badge: '<span class="media-badge-dot"></span>' })}<p class="search-detail-media-caption">${highlightPlainText(item.description || item.fileName || '', state.searchQuery)}</p></div>`).join('')}</div>`
    : '<p class="search-detail-empty">No matching media descriptions in this entry.</p>';
  const journalHtml = day.journal
    ? `<section class="search-detail-section">
        <div class="search-detail-section-head">
          <h3>Journal</h3>
        </div>
        <div class="journal-wrap"><div class="journal-body">${highlightJournalHtml(day.journal.fullHtml, state.searchQuery)}</div></div>
      </section>`
    : '';
  return `
    <article class="search-detail-entry">
      ${journalHtml}
      <section class="search-detail-section">
        <div class="search-detail-section-head">
          <h3>Matched media</h3>
        </div>
        ${mediaGrid}
      </section>
    </article>
  `;
}

function focusSearchDetailResult(index = state.searchDetailResultIndex) {
  const day = getSearchDayByDate(state.searchDetailDate);
  const hits = Array.from(dom.searchDetailBody?.querySelectorAll('.search-hit') || []);
  if (!hits.length) {
    dom.searchDetailSubtitle.textContent = searchMatchLabel(day || { matchCount: 0 });
    dom.searchDetailPrevResult.disabled = true;
    dom.searchDetailNextResult.disabled = true;
    return;
  }
  state.searchDetailResultIndex = clamp(index, 0, hits.length - 1);
  dom.searchDetailSubtitle.textContent = `${state.searchDetailResultIndex + 1} of ${hits.length} matches`;
  dom.searchDetailPrevResult.disabled = state.searchDetailResultIndex <= 0;
  dom.searchDetailNextResult.disabled = state.searchDetailResultIndex >= hits.length - 1;
  hits.forEach((node, nodeIndex) => {
    node.classList.toggle('is-active-search-hit', nodeIndex === state.searchDetailResultIndex);
  });
  hits[state.searchDetailResultIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function renderSearchDetail() {
  const day = getSearchDayByDate(state.searchDetailDate);
  dom.searchDetailTitle.textContent = day?.dateLabel || 'Search result';
  dom.searchDetailSubtitle.textContent = searchMatchLabel(day || { matchCount: 0 });
  dom.searchDetailBody.innerHTML = buildSearchDetailBody(day);
  focusSearchDetailResult(state.searchDetailResultIndex);
}

function buildSearchDetailBody(day) {
  if (!day) return '<div class="empty-state"><h2>Search result not found</h2><p>Return to the search results and try again.</p></div>';
  const mediaGrid = (day.matchedMedia || []).length
    ? `<div class="photo-grid search-detail-grid">${day.matchedMedia.map((item) => `<div class="search-detail-media-card">${buildMediaTile(item, 'photo-grid-button', { badge: '<span class="media-badge-dot"></span>' })}<p class="search-detail-media-caption">${highlightPlainText(item.description || item.fileName || '', state.searchQuery)}</p></div>`).join('')}</div>`
    : '<p class="search-detail-empty">No matching media descriptions in this entry.</p>';
  const journalHtml = day.journal
    ? `<section class="search-detail-section">
        <div class="search-detail-section-head">
          <h3>Journal</h3>
        </div>
        <div class="journal-wrap"><div class="journal-body">${highlightJournalHtml(day.journal.fullHtml, state.searchQuery)}</div></div>
      </section>`
    : '';
  return `
    <article class="search-detail-entry">
      ${journalHtml}
      <section class="search-detail-section">
        <div class="search-detail-section-head">
          <h3>Matched media</h3>
        </div>
        ${mediaGrid}
      </section>
    </article>
  `;
}

function focusSearchDetailResult(index = state.searchDetailResultIndex) {
  const hits = getSearchDetailHits();
  if (!hits.length) {
    dom.searchDetailPrevResult.disabled = true;
    dom.searchDetailNextResult.disabled = true;
    updateTopbarDateLabel();
    return;
  }
  state.searchDetailResultIndex = clamp(index, 0, hits.length - 1);
  dom.searchDetailPrevResult.disabled = state.searchDetailResultIndex <= 0;
  dom.searchDetailNextResult.disabled = state.searchDetailResultIndex >= hits.length - 1;
  hits.forEach((node, nodeIndex) => {
    node.classList.toggle('is-active-search-hit', nodeIndex === state.searchDetailResultIndex);
  });
  updateTopbarDateLabel();
  hits[state.searchDetailResultIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function renderSearchDetail() {
  dom.searchDetailBody.innerHTML = buildSearchDetailBody(getSearchDayByDate(state.searchDetailDate));
  focusSearchDetailResult(state.searchDetailResultIndex);
}

function closeSearchDetail({ restoreScroll = true } = {}) {
  showHomeView();
  state.route = { view: 'home', scrollY: state.searchResultsScrollY || 0 };
  syncTopbarSearchState();
  if (!restoreScroll) return;
  window.scrollTo({ top: state.searchResultsScrollY || 0, behavior: 'auto' });
  requestAnimationFrame(() => {
    updateActiveFromScroll();
    syncScrollThumb();
  });
}

function openSearchDetail(isoDate, { push = true, resultIndex = 0 } = {}) {
  const day = getSearchDayByDate(isoDate);
  if (!day) return;
  if (state.route.view !== 'search-detail') state.searchResultsScrollY = window.scrollY;
  state.searchDetailDate = isoDate;
  state.searchDetailResultIndex = resultIndex;
  state.route = { view: 'search-detail', entryDate: isoDate, resultIndex, scrollY: state.searchResultsScrollY };
  renderSearchDetail();
  showSearchDetailView();
  syncTopbarSearchState();
  if (push) history.pushState({ view: 'search-detail', entryDate: isoDate, resultIndex, scrollY: state.searchResultsScrollY }, '', `#search-${isoDate}`);
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
    if (!state.searchMode && nextScrollY <= 8 && state.bootstrap?.lastDate) {
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
  if (route.view === 'search-detail') {
    openSearchDetail(route.entryDate, { push: false, resultIndex: Number(route.resultIndex || 0) });
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
    if (state.searchUiOpen) {
      state.topbarHidden = false;
      dom.body.classList.remove('topbar-hidden');
      return;
    }
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
    if (state.searchUiOpen) {
      if (state.route.view === 'search-detail') {
        closeSearchDetail();
        return;
      }
      closeSearchBar({ clear: true }).catch(console.error);
      return;
    }
    goToNewestTop().catch(console.error);
  });

  dom.uploadTopbarButton?.addEventListener('click', triggerTopbarUpload);
  dom.topbarDateLabel?.addEventListener('click', () => {
    if (state.searchUiOpen) return;
    openJumpDateModal({ returnFocus: dom.topbarDateLabel });
  });
  dom.searchToggleButton?.addEventListener('click', openSearchBar);
  dom.searchBackButton?.addEventListener('click', () => {
    if (state.route.view === 'search-detail') return closeSearchDetail();
    closeSearchBar({ clear: true }).catch(console.error);
  });
  dom.searchCloseButton?.addEventListener('click', () => {
    if (!dom.searchInput?.value.trim()) return;
    dom.searchInput.value = '';
    syncTopbarSearchState();
    runSearch('').catch(console.error);
    dom.searchInput?.focus();
  });
  dom.searchDetailPrevResult?.addEventListener('click', () => focusSearchDetailResult(state.searchDetailResultIndex - 1));
  dom.searchDetailNextResult?.addEventListener('click', () => focusSearchDetailResult(state.searchDetailResultIndex + 1));
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
  dom.settingsJumpButton?.addEventListener('click', () => {
    closeSettings();
    openJumpDateModal({ returnFocus: dom.settingsButton });
  });
  dom.settingsUploadButton?.addEventListener('click', () => {
    closeSettings();
    openUploadForDateModal({ returnFocus: dom.settingsButton });
  });
  dom.themeChoices.forEach((button) => {
    button.addEventListener('click', () => setThemeChoice(button.dataset.themeChoice));
  });
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
    syncTopbarSearchState();
    window.clearTimeout(state.searchInputTimer);
    state.searchInputTimer = window.setTimeout(() => {
      runSearch(dom.searchInput.value).catch(console.error);
    }, 180);
  });
  dom.searchInput.addEventListener('search', () => runSearch(dom.searchInput.value).catch(console.error));
  dom.clearSearch.addEventListener('click', () => {
    dom.searchInput.value = '';
    syncTopbarSearchState();
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
  dom.uploadDateModeToggle?.addEventListener('click', () => {
    if (!dom.uploadSetExifDate) return;
    dom.uploadSetExifDate.checked = !dom.uploadSetExifDate.checked;
    handleUploadSharedDateToggle();
  });
  dom.uploadContextDateTrigger?.addEventListener('click', () => {
    if (!dom.uploadSharedDate) return;
    if (typeof dom.uploadSharedDate.showPicker === 'function') dom.uploadSharedDate.showPicker();
    else dom.uploadSharedDate.click();
  });
  dom.uploadSharedDate?.addEventListener('change', () => {
    if (!isValidIsoDate(dom.uploadSharedDate?.value)) return;
    setUploadContextDate(dom.uploadSharedDate.value);
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
    const resetButton = event.target.closest('[data-upload-reset]');
    if (resetButton) {
      resetUploadFileDateTime(resetButton.dataset.uploadReset);
      renderUploadPreviews();
      updateUploadUiState();
      return;
    }
    const dateTrigger = event.target.closest('[data-upload-date-trigger]');
    if (dateTrigger) {
      openNativeUploadPicker(`[data-upload-date-input="${dateTrigger.dataset.uploadDateTrigger}"]`);
      return;
    }
    const timeTrigger = event.target.closest('[data-upload-time-trigger]');
    if (timeTrigger) {
      openNativeUploadPicker(`[data-upload-time-input="${timeTrigger.dataset.uploadTimeTrigger}"]`);
    }
  });
  dom.uploadPreviewList?.addEventListener('change', (event) => {
    const dateInput = event.target.closest('[data-upload-date-input]');
    if (dateInput && isValidIsoDate(dateInput.value)) {
      setUploadFileDate(dateInput.dataset.uploadDateInput, dateInput.value);
      renderUploadPreviews();
      updateUploadUiState();
      return;
    }
    const timeInput = event.target.closest('[data-upload-time-input]');
    if (timeInput) {
      setUploadFileTime(timeInput.dataset.uploadTimeInput, timeInput.value);
      renderUploadPreviews();
      updateUploadUiState();
    }
  });
  dom.calendarCloseButton?.addEventListener('click', () => closeCalendarModal());
  dom.calendarCancelButton?.addEventListener('click', () => closeCalendarModal());
  dom.calendarBackdrop?.addEventListener('click', () => closeCalendarModal());
  dom.calendarPrevMonth?.addEventListener('click', () => navigateCalendarMonth(-1));
  dom.calendarNextMonth?.addEventListener('click', () => navigateCalendarMonth(1));
  dom.calendarConfirmButton?.addEventListener('click', () => {
    confirmCalendarModal().catch(console.error);
  });
  dom.calendarGrid?.addEventListener('click', (event) => {
    const dateButton = event.target.closest('[data-calendar-date]');
    if (!dateButton || dateButton.disabled) return;
    state.calendarModal.selectedDate = dateButton.dataset.calendarDate || '';
    if (monthKeyFromIso(state.calendarModal.selectedDate) !== state.calendarModal.visibleMonth) {
      state.calendarModal.visibleMonth = monthKeyFromIso(state.calendarModal.selectedDate);
    }
    renderCalendarModal();
    if (state.calendarModal.context === 'jump-date') {
      confirmCalendarModal().catch(console.error);
      return;
    }
    focusCalendarDate(state.calendarModal.selectedDate);
  });
  dom.calendarWindow?.addEventListener('keydown', (event) => {
    if (!state.calendarModal.isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCalendarModal();
      return;
    }
    const activeDateButton = document.activeElement?.closest?.('[data-calendar-date]');
    if (!activeDateButton) return;
    const currentDate = activeDateButton.dataset.calendarDate || state.calendarModal.selectedDate;
    let nextDate = '';
    if (event.key === 'ArrowLeft') nextDate = addDaysToIso(currentDate, -1);
    if (event.key === 'ArrowRight') nextDate = addDaysToIso(currentDate, 1);
    if (event.key === 'ArrowUp') nextDate = addDaysToIso(currentDate, -7);
    if (event.key === 'ArrowDown') nextDate = addDaysToIso(currentDate, 7);
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (isCalendarDateEnabled(currentDate)) {
        state.calendarModal.selectedDate = currentDate;
        renderCalendarModal();
        if (state.calendarModal.context === 'jump-date') {
          confirmCalendarModal().catch(console.error);
        }
      }
      return;
    }
    if (!nextDate) return;
    event.preventDefault();
    state.calendarModal.visibleMonth = monthKeyFromIso(nextDate) || state.calendarModal.visibleMonth;
    if (isCalendarDateEnabled(nextDate)) state.calendarModal.selectedDate = nextDate;
    renderCalendarModal();
    focusCalendarDate(nextDate);
  });
  dom.timeCloseButton?.addEventListener('click', () => closeTimeModal());
  dom.timeCancelButton?.addEventListener('click', () => closeTimeModal());
  dom.timeBackdrop?.addEventListener('click', () => closeTimeModal());
  dom.timeConfirmButton?.addEventListener('click', () => {
    confirmTimeModal().catch(console.error);
  });
  [dom.timeHourLane, dom.timeMinuteLane, dom.timePeriodLane].forEach((lane) => {
    lane?.addEventListener('scroll', () => {
      if (!state.timeModal.isOpen || state.timeModal.busy) return;
      const suppressedUntil = timeSpinnerSuppressUntil.get(lane) || 0;
      if (performance.now() < suppressedUntil) return;
      scheduleTimeLaneSnap(lane, lane.dataset.timeLane || '');
    });
    lane?.addEventListener('click', (event) => {
      const option = event.target.closest('[data-time-option]');
      if (!option || state.timeModal.busy) return;
      const part = option.dataset.timeOption || lane.dataset.timeLane || '';
      updateSelectedTimeForLaneValue(part, option.dataset.timeValue || '');
      centerTimeLaneOnValue(part, option.dataset.timeValue || '', { behavior: 'smooth' });
      lane.focus({ preventScroll: true });
    });
  });
  dom.timeWindow?.addEventListener('keydown', (event) => {
    if (!state.timeModal.isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeTimeModal();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      confirmTimeModal().catch(console.error);
      return;
    }
    const activeLane = document.activeElement?.closest?.('[data-time-lane]');
    if (!activeLane) return;
    const activePart = activeLane.dataset.timeLane || 'hour';
    const laneOrder = [dom.timeHourLane, dom.timeMinuteLane, dom.timePeriodLane].filter(Boolean);
    const laneIndex = laneOrder.indexOf(activeLane);
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      shiftTimePart(activePart, -1);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      shiftTimePart(activePart, 1);
      return;
    }
    if (event.key === 'ArrowRight' && laneIndex >= 0) {
      event.preventDefault();
      laneOrder[(laneIndex + 1) % laneOrder.length]?.focus({ preventScroll: true });
      return;
    }
    if (event.key === 'ArrowLeft' && laneIndex >= 0) {
      event.preventDefault();
      laneOrder[(laneIndex - 1 + laneOrder.length) % laneOrder.length]?.focus({ preventScroll: true });
    }
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
    const searchFolder = event.target.closest('[data-search-folder]');
    if (searchFolder) {
      event.preventDefault();
      toggleSearchFolder(searchFolder.dataset.searchFolder);
      return;
    }
    const mediaButton = event.target.closest('.open-media');
    if (mediaButton) {
      openViewerById(mediaButton.dataset.mediaId);
      return;
    }
    const searchDetail = event.target.closest('[data-open-search-detail]');
    if (searchDetail) {
      event.preventDefault();
      openSearchDetail(searchDetail.dataset.openSearchDetail);
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

  document.addEventListener('keydown', (event) => {
    const entryCard = event.target.closest?.('[data-open-search-detail]');
    if (!entryCard) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openSearchDetail(entryCard.dataset.openSearchDetail);
    }
  });
  dom.searchDetailBody?.addEventListener('click', (event) => {
    const target = event.target.closest('.search-hit');
    if (!target) return;
    const targets = Array.from(dom.searchDetailBody.querySelectorAll('.search-hit'));
    const index = targets.indexOf(target);
    if (index >= 0) focusSearchDetailResult(index);
  });

  let scrollRaf = 0;
  window.addEventListener('scroll', () => {
    showScrollHandle();
    showScrollTopButton();
    updateMobileTopbar();
    if (state.searchMode && state.route.view === 'home') state.searchResultsScrollY = window.scrollY;
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
    if (event.key === 'Escape' && state.timeModal.isOpen) {
      closeTimeModal();
      return;
    }
    if (event.key === 'Escape' && state.calendarModal.isOpen) {
      closeCalendarModal();
      return;
    }
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
      <h2>Book of Life could not start</h2>
      <p>${escapeHtml(error.message || 'Unknown startup error')}</p>
    </div>
  `;
});
