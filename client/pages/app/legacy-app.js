import { createMediaViewer, renderPhIcon as sharedRenderPhIcon } from '../../components/viewer/create-media-viewer.js';
import { buildJustifiedGalleryRows, galleryMediaAspectRatio } from '../../domain/gallery-layout/index.js';

const requestIdle = window.requestIdleCallback || function requestIdleFallback(callback) {
  return window.setTimeout(() => callback({ timeRemaining: () => 10 }), 120);
};

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

const renderPhIcon = sharedRenderPhIcon;

const UPLOAD_TARGET_STORAGE_KEY = 'lifeserver-upload-target-v1';
const GALLERY_LAYOUT_STORAGE_KEY = 'lifeserver-gallery-layout-v1';
const FOLDER_VIEW_MODE_STORAGE_KEY = 'lifeserver-folder-view-mode-v1';
const TIMELINE_MEDIA_SCALE_STORAGE_KEY = 'lifeserver-timeline-media-scale-v1';
const GALLERY_MEDIA_SCALE_STORAGE_KEY = 'lifeserver-gallery-media-scale-v1';
const BACKGROUND_STORAGE_KEY = 'lifeserver-background';

function loadStoredGalleryLayoutMode() {
  const value = String(localStorage.getItem(GALLERY_LAYOUT_STORAGE_KEY) || 'grid');
  return ['grid', 'ratio'].includes(value) ? value : 'grid';
}

function loadStoredFolderViewMode() {
  const value = String(localStorage.getItem(FOLDER_VIEW_MODE_STORAGE_KEY) || 'hybrid');
  if (value === 'small-grid' || value === 'large-grid') return 'grid';
  return ['list', 'hybrid', 'grid'].includes(value) ? value : 'hybrid';
}

function loadStoredMediaScale(storageKey) {
  const value = Number(localStorage.getItem(storageKey) || 0);
  return Number.isFinite(value) ? clamp(Math.round(value), mediaScaleBounds().min, mediaScaleBounds().max) : mediaScaleBounds().base;
}

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

function loadStoredBackgroundPreset() {
  const value = String(localStorage.getItem(BACKGROUND_STORAGE_KEY) || 'none');
  return ['none', 'paper', 'sunrise', 'forest', 'ocean'].includes(value) ? value : 'none';
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
  entryDetailDate: '',
  entryDetailDay: null,
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
  explorerMode: 'default',
  activeView: 'home',
  sideTabsCollapsed: localStorage.getItem('lifeserver-side-tabs-collapsed') === '1',
  homeScrollY: 0,
  monthCache: new Map(),
  yearCache: new Map(),
  calendarViewMonth: '',
  calendarViewDate: '',
  calendarScrollRaf: 0,
  calendarRenderStart: null,
  calendarRenderEnd: null,
  calendarRenderMonthKey: '',
  calendarMonthMeta: [],
  calendarWeekRows: [],
  calendarSummaryMap: new Map(),
  calendarRenderedWeeks: new Map(),
  calendarCellHeight: 0,
  galleryIndexDays: [],
  galleryDays: [],
  galleryTotal: 0,
  galleryLoadedStart: null,
  galleryLoadedEnd: null,
  galleryRenderStart: null,
  galleryRenderEnd: null,
  galleryPendingChunks: new Map(),
  galleryIndexPromise: null,
  galleryScrollRaf: 0,
  galleryObserver: null,
  galleryMeasuredHeights: new Map(),
  galleryMeasureSignature: '',
  galleryAverageHeight: 420,
  galleryLayoutMode: loadStoredGalleryLayoutMode(),
  galleryCorrectionSuppressedUntil: 0,
  galleryPointers: new Map(),
  galleryPinchStartDistance: null,
  galleryPinchStartScale: loadStoredMediaScale(GALLERY_MEDIA_SCALE_STORAGE_KEY),
  galleryMediaScale: loadStoredMediaScale(GALLERY_MEDIA_SCALE_STORAGE_KEY),
  folderBrowse: null,
  folderReadyPromise: null,
  folderReadyError: '',
  folderViewMode: loadStoredFolderViewMode(),
  folderViewSelection: { rootId: '0', relativePath: '.' },
  settingsOpen: false,
  settingsPanel: 'account',
  authEnabled: false,
  sessionUsername: '',
  desktopCloudSignedIn: true,
  desktopSettings: null,
  desktopCloudStatus: null,
  desktopOnboardingStatus: null,
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
  timelinePinchStartScale: loadStoredMediaScale(TIMELINE_MEDIA_SCALE_STORAGE_KEY),
  timelineMeasuredHeights: new Map(),
  timelineAverageHeight: 280,
  timelineCorrectionSuppressedUntil: 0,
  theme: localStorage.getItem('lifeserver-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  backgroundPreset: loadStoredBackgroundPreset(),
  timelineMediaScale: loadStoredMediaScale(TIMELINE_MEDIA_SCALE_STORAGE_KEY),
  openScalePanel: null
};

const TIME_HOUR_VALUES = Array.from({ length: 12 }, (_, index) => String(index + 1));
const TIME_MINUTE_VALUES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));
const TIME_PERIOD_VALUES = ['AM', 'PM'];
const TIME_SPINNER_REPEAT_COUNT = 5;
const TIME_SPINNER_CENTER_REPEAT = Math.floor(TIME_SPINNER_REPEAT_COUNT / 2);
const AVAILABLE_THEMES = new Set(['light', 'dark', 'sepia', 'forest', 'ocean', 'rose']);
const AVAILABLE_BACKGROUNDS = new Set(['none', 'paper', 'sunrise', 'forest', 'ocean']);
const MEDIA_LIKE_SAVE_DELAY_MS = 200;
const pendingMediaLikeSaves = new Map();
const mediaLikeSaveVersions = new Map();
const timeSpinnerScrollTimers = new Map();
const timeSpinnerSuppressUntil = new WeakMap();
const GALLERY_GRID_MIN_WIDTH = 196;
const GALLERY_RATIO_ROW_HEIGHT = 190;
const GALLERY_RATIO_ROW_GAP = 8;
const GALLERY_RATIO_MIN_ROW_HEIGHT = 110;
const GALLERY_RATIO_MAX_ROW_HEIGHT = 340;
const GALLERY_GROUP_MAX_WIDTH = 1040;

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
  settingsPanelTabs: document.getElementById('settingsPanelTabs'),
  settingsPanelButtons: Array.from(document.querySelectorAll('[data-settings-panel]')),
  settingsSections: Array.from(document.querySelectorAll('[data-settings-section]')),
  settingsProfileAvatar: document.getElementById('settingsProfileAvatar'),
  settingsProfileName: document.getElementById('settingsProfileName'),
  settingsProfileEmail: document.getElementById('settingsProfileEmail'),
  settingsAccountAvatar: document.getElementById('settingsAccountAvatar'),
  settingsAccountName: document.getElementById('settingsAccountName'),
  settingsAccountEmail: document.getElementById('settingsAccountEmail'),
  settingsAccountLibrary: document.getElementById('settingsAccountLibrary'),
  changePasswordButton: document.getElementById('changePasswordButton'),
  logoutButton: document.getElementById('logoutButton'),
  themeChoices: Array.from(document.querySelectorAll('[data-theme-choice]')),
  backgroundChoices: Array.from(document.querySelectorAll('[data-background-choice]')),
  settingsDevicesStatus: document.getElementById('settingsDevicesStatus'),
  settingsDeviceNameInput: document.getElementById('settingsDeviceNameInput'),
  settingsHostAvailabilityInput: document.getElementById('settingsHostAvailabilityInput'),
  settingsJournalMirrorPathInput: document.getElementById('settingsJournalMirrorPathInput'),
  settingsUploadDestinationInput: document.getElementById('settingsUploadDestinationInput'),
  settingsPickJournalMirror: document.getElementById('settingsPickJournalMirror'),
  settingsPickUploadDestination: document.getElementById('settingsPickUploadDestination'),
  settingsHostSummary: document.getElementById('settingsHostSummary'),
  settingsMediaFolders: document.getElementById('settingsMediaFolders'),
  settingsAddMediaFolder: document.getElementById('settingsAddMediaFolder'),
  settingsSaveDevicesButton: document.getElementById('settingsSaveDevicesButton'),
  settingsSyncNowButton: document.getElementById('settingsSyncNowButton'),
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
  timelineSubtitle: document.getElementById('timelineSubtitle'),
  searchStatusSection: document.getElementById('searchStatusSection'),
  searchStatusEyebrow: document.getElementById('searchStatusEyebrow'),
  searchStatusTitle: document.getElementById('searchStatusTitle'),
  searchStatusSubtitle: document.getElementById('searchStatusSubtitle'),
  searchFilters: document.getElementById('searchFilters'),
  timelinePane: document.getElementById('timelinePane'),
  timelineFeed: document.getElementById('timelineFeed'),
  timelineScaleToggle: document.getElementById('timelineScaleToggle'),
  timelineScalePanel: document.getElementById('timelineScalePanel'),
  timelineScaleSlider: document.getElementById('timelineScaleSlider'),
  timelineTopSpacer: document.getElementById('timelineTopSpacer'),
  timelineBottomSpacer: document.getElementById('timelineBottomSpacer'),
  timelineStatus: document.getElementById('timelineStatus'),
  searchForm: document.getElementById('searchForm'),
  searchInput: document.getElementById('searchInput'),
  clearSearch: document.getElementById('clearSearch'),
  viewTabs: document.getElementById('viewTabs'),
  viewTabsToggle: document.getElementById('viewTabsToggle'),
  sideHomeButton: document.getElementById('sideHomeButton'),
  sideTodayButton: document.getElementById('sideTodayButton'),
  viewTabButtons: Array.from(document.querySelectorAll('[data-app-view]')),
  galleryView: document.getElementById('galleryView'),
  gallerySubtitle: document.getElementById('gallerySubtitle'),
  galleryFilters: document.getElementById('galleryFilters'),
  galleryLayoutToggle: document.getElementById('galleryLayoutToggle'),
  galleryScaleToggle: document.getElementById('galleryScaleToggle'),
  galleryScalePanel: document.getElementById('galleryScalePanel'),
  galleryScaleSlider: document.getElementById('galleryScaleSlider'),
  galleryPane: document.getElementById('galleryPane'),
  galleryFeed: document.getElementById('galleryFeed'),
  galleryTopSpacer: document.getElementById('galleryTopSpacer'),
  galleryBottomSpacer: document.getElementById('galleryBottomSpacer'),
  searchDetailView: document.getElementById('searchDetailView'),
  searchDetailNav: document.getElementById('searchDetailNav'),
  searchDetailPrevResult: document.getElementById('searchDetailPrevResult'),
  searchDetailNextResult: document.getElementById('searchDetailNextResult'),
  searchDetailBody: document.getElementById('searchDetailBody'),
  entryDetailView: document.getElementById('entryDetailView'),
  entryDetailBody: document.getElementById('entryDetailBody'),
  calendarView: document.getElementById('calendarView'),
  calendarViewSubtitle: document.getElementById('calendarViewSubtitle'),
  calendarViewPrevMonth: document.getElementById('calendarViewPrevMonth'),
  calendarViewNextMonth: document.getElementById('calendarViewNextMonth'),
  calendarViewToday: document.getElementById('calendarViewToday'),
  calendarViewMonthLabel: document.getElementById('calendarViewMonthLabel'),
  calendarViewGrid: document.getElementById('calendarViewGrid'),
  calendarDayPanel: document.getElementById('calendarDayPanel'),
  foldersView: document.getElementById('foldersView'),
  foldersSubtitle: document.getElementById('foldersSubtitle'),
  foldersTree: document.getElementById('foldersTree'),
  folderBreadcrumbs: document.getElementById('folderBreadcrumbs'),
  folderViewControls: document.getElementById('folderViewControls'),
  folderWorkspace: document.getElementById('folderWorkspace'),
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

const mediaViewer = createMediaViewer({
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
        displayUrl: payload.photo.displayUrl || `/media/display/${payload.photo.id}`,
        downloadUrl: payload.photo.downloadUrl || `/media/download/${payload.photo.id}`,
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
  onLoadCloudOriginalStatus: async (item) => {
    const payload = await fetchJson(`/api/media/${item.id}/cloud`, { cache: 'no-store' });
    item.cloudOriginal = payload.cloud || {};
    syncViewerMediaMutation(item.id, (photo) => { photo.cloudOriginal = item.cloudOriginal; });
    return item.cloudOriginal;
  },
  onToggleCloudOriginal: async (item, syncOriginal) => {
    const payload = await fetchJson(`/api/media/${item.id}/cloud`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ syncOriginal })
    });
    item.cloudOriginal = payload.cloud || {};
    syncViewerMediaMutation(item.id, (photo) => { photo.cloudOriginal = item.cloudOriginal; });
    return item.cloudOriginal;
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
  return fetch(url, options).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      redirectToLogin();
      throw new Error(payload.error || 'Unauthorized');
    }
    if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
    return payload;
  });
}

function postJson(url, body, options = {}) {
  return fetchJson(url, {
    ...options,
    method: options.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: JSON.stringify(body)
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
  if (view === 'entry-detail') return `entry:${route?.entryDate ?? ''}`;
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

function longDateLabel(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date);
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

function openTodayEditor() {
  const today = state.bootstrap?.today;
  const isoDate = today?.isoDate || fileDateToLocalIso(Date.now());
  openEditorForDate(isoDate, { create: !today?.hasJournal });
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
      const exifDate = exif?.ModifyDate || exif?.DateTimeOriginal || exif?.CreateDate;
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

function applyBackgroundPreset(preset) {
  state.backgroundPreset = AVAILABLE_BACKGROUNDS.has(preset) ? preset : 'none';
  dom.body.dataset.background = state.backgroundPreset;
  localStorage.setItem(BACKGROUND_STORAGE_KEY, state.backgroundPreset);
  dom.backgroundChoices.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.backgroundChoice === state.backgroundPreset);
  });
}

function setThemeChoice(theme) {
  applyTheme(theme);
}

function setBackgroundChoice(preset) {
  applyBackgroundPreset(preset);
}

function setSettingsPanel(panel) {
  state.settingsPanel = ['account', 'appearance', 'devices'].includes(panel) ? panel : 'account';
  dom.settingsPanelButtons.forEach((button) => {
    const active = button.dataset.settingsPanel === state.settingsPanel;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  dom.settingsSections.forEach((section) => {
    section.classList.toggle('hidden', section.dataset.settingsSection !== state.settingsPanel);
  });
  if (state.settingsPanel === 'devices') {
    loadDesktopSettings().catch((error) => setSettingsDevicesStatus(error.message));
  }
}

function initialsFromName(value) {
  const words = String(value || 'Book of Life').trim().split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join('');
  return initials || 'BoL';
}

function desktopDisplayName() {
  return state.desktopSettings?.deviceName || state.sessionUsername || state.desktopCloudStatus?.email || 'Book of Life';
}

function accountEmailLabel() {
  return state.desktopCloudStatus?.email || state.desktopSettings?.cloudSession?.email || state.sessionUsername || 'Local library';
}

function updateSettingsProfileUi() {
  const displayName = desktopDisplayName();
  const email = accountEmailLabel();
  const libraryName = state.desktopSettings?.libraryName || 'Book of Life';
  const deviceName = state.desktopSettings?.deviceName || 'This desktop';
  const initials = initialsFromName(displayName);
  if (dom.settingsProfileAvatar) dom.settingsProfileAvatar.textContent = initials;
  if (dom.settingsAccountAvatar) dom.settingsAccountAvatar.textContent = initials;
  if (dom.settingsProfileName) dom.settingsProfileName.textContent = displayName;
  if (dom.settingsProfileEmail) dom.settingsProfileEmail.textContent = email;
  if (dom.settingsAccountName) dom.settingsAccountName.textContent = displayName;
  if (dom.settingsAccountEmail) dom.settingsAccountEmail.textContent = email;
  if (dom.settingsAccountLibrary) {
    const signedIn = state.desktopCloudStatus?.signedIn ? 'Cloud connected' : 'Device local';
    dom.settingsAccountLibrary.textContent = `${libraryName} · ${deviceName} · ${signedIn}`;
  }
}

function gridColumnBounds() {
  return isMobileViewport() ? { min: 1, max: 5, base: 2 } : { min: 2, max: 7, base: 4 };
}

function mediaScaleBounds() {
  return { min: 1, max: 5, base: 3 };
}

function mediaScaleColumnOffset(scale) {
  return Math.round((mediaScaleBounds().base - normalizeMediaScale(scale)) * 1.5);
}

function normalizeMediaScale(scale) {
  const bounds = mediaScaleBounds();
  const numeric = Number(scale || bounds.base);
  return clamp(Math.round(numeric), bounds.min, bounds.max);
}

function timelineGridColumnsForScale(scale = state.timelineMediaScale) {
  const bounds = gridColumnBounds();
  return clamp(bounds.base + mediaScaleColumnOffset(scale), bounds.min, bounds.max);
}

function applyTimelineMediaScale(scale) {
  const nextScale = normalizeMediaScale(scale);
  state.timelineMediaScale = nextScale;
  state.timelinePinchStartScale = nextScale;
  localStorage.setItem(TIMELINE_MEDIA_SCALE_STORAGE_KEY, String(nextScale));
  dom.body.style.setProperty('--timeline-grid-columns', String(timelineGridColumnsForScale(nextScale)));
}

function setTimelineMediaScale(scale) {
  const nextScale = normalizeMediaScale(scale);
  if (nextScale === state.timelineMediaScale) return false;
  const timelineVisible = dom.timelineSection && !dom.timelineSection.classList.contains('hidden');
  const anchor = timelineVisible ? captureScrollAnchor() : null;
  applyTimelineMediaScale(nextScale);
  syncMediaScaleControls();
  if (timelineVisible) {
    suppressTimelineCorrection(700);
    requestAnimationFrame(() => {
      refreshTimelineHeightMetrics({ anchor });
      updateActiveFromScroll();
      syncScrollThumb();
    });
  }
  return true;
}

function stepTimelineMediaScale(delta) {
  const current = normalizeMediaScale(state.timelineMediaScale);
  const next = clamp(current + delta, mediaScaleBounds().min, mediaScaleBounds().max);
  if (next === current) return false;
  setTimelineMediaScale(next);
  return true;
}

function galleryGridColumnsForWidth(width, scale = state.galleryMediaScale) {
  const safeWidth = Math.max(320, width || dom.galleryFeed?.clientWidth || dom.galleryPane?.clientWidth || 960);
  const nextScale = normalizeMediaScale(scale);
  let base = 5;
  let min = 2;
  let max = 8;
  if (safeWidth < 620) {
    base = 3;
    min = 1;
    max = 5;
  } else if (safeWidth < 980) {
    base = 4;
    min = 2;
    max = 7;
  }
  return clamp(base + mediaScaleColumnOffset(nextScale), min, max);
}

function galleryRatioForMedia(media) {
  if (media?.__entryPreview) return 0.8;
  return galleryMediaAspectRatio(media);
}

function galleryTargetRowHeight(scale = state.galleryMediaScale) {
  const nextScale = normalizeMediaScale(scale);
  return clamp(GALLERY_RATIO_ROW_HEIGHT + ((nextScale - mediaScaleBounds().base) * 45), 100, 340);
}

function galleryLayoutContentWidth(width = null) {
  const rawWidth = Number(width || dom.galleryFeed?.clientWidth || dom.galleryPane?.clientWidth || 960);
  return Math.max(1, Math.min(GALLERY_GROUP_MAX_WIDTH, Math.floor(rawWidth || 960)));
}

function createGalleryRatioRows(media, width = null) {
  return buildJustifiedGalleryRows(media, {
    containerWidth: galleryLayoutContentWidth(width),
    gap: GALLERY_RATIO_ROW_GAP,
    targetRowHeight: galleryTargetRowHeight(),
    minRowHeight: GALLERY_RATIO_MIN_ROW_HEIGHT,
    maxRowHeight: GALLERY_RATIO_MAX_ROW_HEIGHT,
    getAspectRatio: galleryRatioForMedia
  });
}

function syncGalleryMeasurementScope(width = null) {
  const signature = [
    state.galleryLayoutMode,
    normalizeMediaScale(state.galleryMediaScale),
    galleryLayoutContentWidth(width)
  ].join(':');
  if (signature === state.galleryMeasureSignature) return;
  state.galleryMeasureSignature = signature;
  state.galleryMeasuredHeights.clear();
}

function applyGalleryMediaScale(scale) {
  const nextScale = normalizeMediaScale(scale);
  state.galleryMediaScale = nextScale;
  state.galleryPinchStartScale = nextScale;
  localStorage.setItem(GALLERY_MEDIA_SCALE_STORAGE_KEY, String(nextScale));
}

function mediaScaleControl(view) {
  if (view === 'gallery') {
    return {
      toggle: dom.galleryScaleToggle,
      panel: dom.galleryScalePanel,
      slider: dom.galleryScaleSlider,
      scale: state.galleryMediaScale,
      label: 'gallery'
    };
  }
  return {
    toggle: dom.timelineScaleToggle,
    panel: dom.timelineScalePanel,
    slider: dom.timelineScaleSlider,
    scale: state.timelineMediaScale,
    label: 'timeline'
  };
}

function setOpenScalePanel(view = null) {
  state.openScalePanel = view;
  ['gallery', 'timeline'].forEach((key) => {
    const control = mediaScaleControl(key);
    if (!control.toggle || !control.panel) return;
    const isOpen = view === key;
    control.toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    control.toggle.classList.toggle('is-active', isOpen);
    control.toggle.closest('.media-scale-control')?.classList.toggle('is-open', isOpen);
    control.panel.classList.toggle('hidden', !isOpen);
  });
}

function syncMediaScaleControls() {
  const timelineColumns = timelineGridColumnsForScale();
  const galleryColumns = galleryGridColumnsForWidth();
  [
    { view: 'gallery', title: `Adjust gallery media size (${galleryColumns} across)` },
    { view: 'timeline', title: `Adjust timeline media size (${timelineColumns} across)` }
  ].forEach(({ view, title }) => {
    const control = mediaScaleControl(view);
    if (!control.toggle || !control.slider) return;
    control.slider.value = String(control.scale);
    control.toggle.setAttribute('aria-label', title);
    control.toggle.setAttribute('title', title);
  });
}

function setGalleryMediaScale(scale) {
  const nextScale = normalizeMediaScale(scale);
  if (nextScale === state.galleryMediaScale) return false;
  applyGalleryMediaScale(nextScale);
  syncMediaScaleControls();
  rerenderGalleryWithAnchor();
  return true;
}

function stepGalleryMediaScale(delta) {
  const current = normalizeMediaScale(state.galleryMediaScale);
  const next = clamp(current + delta, mediaScaleBounds().min, mediaScaleBounds().max);
  if (next === current) return false;
  setGalleryMediaScale(next);
  return true;
}

function syncGalleryFilterUi() {
  if (!dom.galleryLayoutToggle) return;
  const nextMode = state.galleryLayoutMode === 'grid' ? 'ratio' : 'grid';
  const label = nextMode === 'ratio' ? 'Switch to ratio layout' : 'Switch to grid layout';
  dom.galleryLayoutToggle.setAttribute('aria-label', label);
  dom.galleryLayoutToggle.setAttribute('title', label);
  dom.galleryLayoutToggle.dataset.nextGalleryLayout = nextMode;
  dom.galleryLayoutToggle.innerHTML = nextMode === 'ratio'
  ? '<i class="ph-duotone ph-image-square"></i>'
  : '<i class="ph-duotone ph-panorama"></i>'
}

function applyGalleryPreferences() {
  dom.body.dataset.galleryLayout = state.galleryLayoutMode;
  dom.body.style.setProperty('--gallery-grid-min-width', `${GALLERY_GRID_MIN_WIDTH}px`);
  dom.body.style.setProperty('--gallery-row-height', `${galleryTargetRowHeight()}px`);
  dom.body.style.setProperty('--gallery-grid-columns', String(galleryGridColumnsForWidth(dom.galleryFeed?.clientWidth || dom.galleryPane?.clientWidth || 960)));
  syncGalleryFilterUi();
  syncMediaScaleControls();
}

function suppressGalleryCorrection(durationMs = 520) {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  state.galleryCorrectionSuppressedUntil = now + durationMs;
}

function isGalleryCorrectionSuppressed() {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  return now < (state.galleryCorrectionSuppressedUntil || 0);
}

function rerenderGalleryWithAnchor() {
  if (state.activeView !== 'gallery') {
    applyGalleryPreferences();
    return;
  }
  const anchor = captureGalleryAnchor();
  suppressGalleryCorrection(700);
  applyGalleryPreferences();
  renderGalleryView({ force: true });
  requestAnimationFrame(() => {
    restoreGalleryAnchor(anchor);
    refreshGalleryHeightMetrics({ anchor });
    updateActiveGalleryFromScroll();
    syncScrollThumb();
  });
}

function setGalleryLayoutMode(mode) {
  const next = ['grid', 'ratio'].includes(mode) ? mode : 'grid';
  if (next === state.galleryLayoutMode) return;
  state.galleryLayoutMode = next;
  localStorage.setItem(GALLERY_LAYOUT_STORAGE_KEY, next);
  rerenderGalleryWithAnchor();
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

function setActiveView(view) {
  const nextView = ['home', 'gallery', 'timeline', 'calendar', 'folders'].includes(view) ? view : 'home';
  state.activeView = nextView;
  if (nextView !== 'gallery' && state.openScalePanel === 'gallery') setOpenScalePanel(null);
  if (nextView !== 'timeline' && state.openScalePanel === 'timeline') setOpenScalePanel(null);
  dom.body.dataset.activeView = nextView;
  dom.sideHomeButton?.classList.toggle('is-active', nextView === 'home');
  dom.viewTabButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.appView === nextView);
  });
  dom.yearSection?.classList.toggle('hidden', state.searchUiOpen || state.searchMode || nextView !== 'home');
  dom.timelineSection?.classList.toggle('hidden', !state.searchMode && nextView !== 'timeline');
}

function syncSideTabsState() {
  dom.body.classList.toggle('side-tabs-collapsed', state.sideTabsCollapsed);
  dom.viewTabs?.classList.toggle('is-collapsed', state.sideTabsCollapsed);
  dom.viewTabsToggle?.setAttribute('aria-expanded', state.sideTabsCollapsed ? 'false' : 'true');
  dom.viewTabsToggle?.setAttribute('aria-label', state.sideTabsCollapsed ? 'Expand navigation' : 'Collapse navigation');
  localStorage.setItem('lifeserver-side-tabs-collapsed', state.sideTabsCollapsed ? '1' : '0');
}

function gallerySourceEntries() {
  if (state.searchMode) {
    return state.searchResultDays
      .filter(Boolean)
      .map((day, index) => ({
        day,
        galleryIndex: index,
        homeIndex: index,
        photoCount: Number((day?.matchedMedia || []).length || 0),
        galleryMedia: day?.matchedMedia || []
      }))
      .filter((entry) => entry.photoCount > 0);
  }

  const entries = [];
  state.homeSourceDays.forEach((day, homeIndex) => {
    const photoCount = Number(day?.photoCount || day?.photos?.length || 0);
    if (photoCount <= 0) return;
    entries.push({
      day,
      galleryIndex: entries.length,
      homeIndex,
      photoCount,
      galleryMedia: day?.photos || []
    });
  });
  return entries;
}

function galleryChunkSize() {
  return Math.max(8, timelineChunkSize());
}

function estimateGalleryGroupHeight(entry) {
  const day = entry?.day || entry;
  const isoDate = day?.isoDate;
  const width = galleryLayoutContentWidth();
  syncGalleryMeasurementScope(width);
  if (isoDate && state.galleryMeasuredHeights.has(isoDate)) return state.galleryMeasuredHeights.get(isoDate);
  const media = entry?.galleryMedia || day?.photos || [];
  const headerHeight = 92;
  if (state.galleryLayoutMode === 'ratio') {
    const rows = createGalleryRatioRows(media, width);
    if (!rows.length) return headerHeight + galleryTargetRowHeight();
    const rowHeights = rows.reduce((sum, row) => sum + row.height, 0);
    return headerHeight + rowHeights + Math.max(0, rows.length - 1) * GALLERY_RATIO_ROW_GAP;
  }
  const columns = galleryGridColumnsForWidth(Math.max(320, width));
  const gap = 6;
  const tileSize = Math.max(120, Math.floor((width - ((columns - 1) * gap)) / columns));
  return headerHeight + Math.ceil(Math.max(1, media.length) / columns) * tileSize + Math.max(0, Math.ceil(Math.max(1, media.length) / columns) - 1) * gap;
}

function estimateGalleryRangeHeight(entries, start, end) {
  if (end < start) return 0;
  let height = 0;
  for (let index = start; index <= end; index += 1) {
    height += estimateGalleryGroupHeight(entries[index]);
  }
  return Math.round(height);
}

function buildGalleryWindowRangeAroundIndex(localIndex, placement = 'center', entries = gallerySourceEntries()) {
  const total = entries.length;
  const size = Math.min(Math.max(1, galleryChunkSize()), Math.max(1, total));
  if (placement === 'top') {
    const start = clamp(localIndex, 0, Math.max(0, total - size));
    return { start, end: Math.min(total - 1, start + size - 1) };
  }
  const start = clamp(localIndex - Math.floor(size / 2), 0, Math.max(0, total - size));
  return { start, end: Math.min(total - 1, start + size - 1) };
}

function galleryMarkerDocumentY() {
  return window.scrollY + topOffset() + 80;
}

function galleryMarkerViewportY() {
  return topOffset() + 80;
}

function findVisibleGalleryIndexFromDom() {
  const units = Array.from(document.querySelectorAll('#galleryFeed .gallery-unit'));
  if (!units.length) return null;
  const markerY = galleryMarkerViewportY();
  let nearestIndex = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const unit of units) {
    const rect = unit.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
    const localIndex = Number(unit.dataset.galleryIndex);
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

function predictGalleryIndexFromAnchor(entries = gallerySourceEntries()) {
  const domIndex = findVisibleGalleryIndexFromDom();
  if (domIndex !== null && domIndex !== undefined) return domIndex;
  if (!entries.length) return null;
  const paneTop = window.scrollY + dom.galleryPane.getBoundingClientRect().top;
  const topSpacerHeight = Number(dom.galleryTopSpacer.style.height.replace('px', '') || 0);
  const offset = Math.max(0, galleryMarkerDocumentY() - paneTop - topSpacerHeight);
  let remaining = offset;
  const start = state.galleryLoadedStart ?? 0;
  const end = state.galleryLoadedEnd ?? (entries.length - 1);
  for (let index = start; index <= end; index += 1) {
    const height = estimateGalleryGroupHeight(entries[index]);
    if (remaining <= height) return index;
    remaining -= height;
  }
  return clamp(end, 0, entries.length - 1);
}

function predictGalleryIndexFromScroll(entries = gallerySourceEntries()) {
  if (!entries.length) return null;
  const paneTop = window.scrollY + dom.galleryPane.getBoundingClientRect().top;
  const offset = Math.max(0, galleryMarkerDocumentY() - paneTop);
  let remaining = offset;
  for (let index = 0; index < entries.length; index += 1) {
    const height = estimateGalleryGroupHeight(entries[index]);
    if (remaining <= height) return index;
    remaining -= height;
  }
  return entries.length - 1;
}

function captureGalleryAnchor() {
  const index = findVisibleGalleryIndexFromDom();
  if (index === null || index === undefined) return null;
  const unit = dom.galleryFeed?.querySelector(`.gallery-unit[data-gallery-index="${index}"]`);
  if (!unit) return null;
  return { galleryIndex: index, top: unit.getBoundingClientRect().top };
}

function restoreGalleryAnchor(anchor) {
  if (!anchor) return;
  const unit = dom.galleryFeed?.querySelector(`.gallery-unit[data-gallery-index="${anchor.galleryIndex}"]`);
  if (!unit) return;
  window.scrollBy({ top: unit.getBoundingClientRect().top - anchor.top, behavior: 'auto' });
}

async function ensureGalleryRangeLoaded(entries, start, end) {
  if (state.searchMode || end < start) return false;
  const targetEntries = entries.slice(start, end + 1).filter((entry) => !entry.day?.__hydrated);
  if (!targetEntries.length) return false;
  const minHomeIndex = Math.min(...targetEntries.map((entry) => entry.homeIndex));
  const maxHomeIndex = Math.max(...targetEntries.map((entry) => entry.homeIndex));
  return ensureHomeRangeLoaded(minHomeIndex, maxHomeIndex);
}

function updateGallerySpacers(entries = gallerySourceEntries()) {
  if (!entries.length || state.galleryLoadedStart === null || state.galleryLoadedEnd === null) {
    dom.galleryTopSpacer.style.height = '0px';
    dom.galleryBottomSpacer.style.height = '0px';
    return;
  }
  dom.galleryTopSpacer.style.height = `${estimateGalleryRangeHeight(entries, 0, state.galleryLoadedStart - 1)}px`;
  dom.galleryBottomSpacer.style.height = `${estimateGalleryRangeHeight(entries, state.galleryLoadedEnd + 1, entries.length - 1)}px`;
}

function refreshGalleryHeightMetrics({ anchor = null, entries = gallerySourceEntries() } = {}) {
  const groups = Array.from(document.querySelectorAll('#galleryFeed .gallery-unit.is-hydrated .gallery-group[data-gallery-index]'));
  if (!groups.length) return;
  const previousMeasuredHeights = new Map(state.galleryMeasuredHeights);
  let totalHeight = 0;
  let count = 0;
  let compensationDelta = 0;
  const anchorDocumentY = galleryMarkerDocumentY();
  let virtualTop = 0;
  groups.forEach((node) => {
    const localIndex = Number(node.dataset.galleryIndex);
    const entry = entries[localIndex];
    const height = Math.max(1, Math.round(node.getBoundingClientRect().height));
    const previousHeight = entry?.day?.isoDate ? (previousMeasuredHeights.get(entry.day.isoDate) || estimateGalleryGroupHeight(entry)) : estimateGalleryGroupHeight(entry);
    if (entry?.day?.isoDate) state.galleryMeasuredHeights.set(entry.day.isoDate, height);
    const documentTop = (window.scrollY + dom.galleryPane.getBoundingClientRect().top + Number(dom.galleryTopSpacer.style.height.replace('px', '') || 0)) + virtualTop;
    if (!isGalleryCorrectionSuppressed() && documentTop < anchorDocumentY && previousHeight !== height) {
      compensationDelta += (height - previousHeight);
    }
    totalHeight += height;
    count += 1;
    virtualTop += previousHeight;
  });
  if (count) state.galleryAverageHeight = totalHeight / count;
  updateGallerySpacers(entries);
  if (!isGalleryCorrectionSuppressed() && anchor) {
    restoreGalleryAnchor(anchor);
    return;
  }
  if (!isGalleryCorrectionSuppressed() && compensationDelta) {
    window.scrollBy({ top: compensationDelta, behavior: 'auto' });
  }
}

function buildGalleryRatioRows(media, width) {
  return createGalleryRatioRows(media, width);
}

function buildGalleryEntryPreviewTile(day, { className = '', style = '' } = {}) {
  if (!day?.journal) return '';
  const previewLines = day?.journal ? buildPreviewLines(day.journal, 180, 3) : [];
  const previewHtml = previewLines.length
    ? previewLines.map((line) => `<span>${highlightPlainText(line || '', state.searchMode ? state.searchQuery : '')}</span>`).join('')
    : '<span>Open this entry</span>';
  return `
    <a class="photo-grid-button media-tile gallery-entry-preview-tile ${className}" href="/entry/${day.isoDate}" data-open-entry-detail="${day.isoDate}" aria-label="Open entry for ${escapeHtml(day.dateLabel)}" ${style ? `style="${style}"` : ''}>
      <span class="gallery-entry-preview-copy">
        <span class="gallery-entry-preview-lines">${previewHtml}</span>
      </span>
    </a>
  `;
}

function buildGalleryMediaLayoutHtml(entry) {
  const day = entry.day;
  const media = entry.galleryMedia || [];
  const entryPreviewTile = buildGalleryEntryPreviewTile(day);
  if (state.galleryLayoutMode === 'ratio') {
    const width = galleryLayoutContentWidth();
    syncGalleryMeasurementScope(width);
    const ratioItems = day?.journal ? [{ __entryPreview: true, day }, ...media] : media;
    const rows = buildGalleryRatioRows(ratioItems, width);
    return `
      <div class="gallery-photo-grid is-ratio">
        ${rows.map((row) => `
          <div class="gallery-ratio-row ${row.justified ? 'is-justified' : 'is-ragged'}" style="height:${row.height}px;width:${row.justified ? '100%' : `${row.width}px`}">
            ${row.items.map(({ item, width: tileWidth }) => (
              item.__entryPreview
                ? buildGalleryEntryPreviewTile(item.day, {
                    className: 'gallery-ratio-tile',
                    style: `width:${tileWidth}px;height:${row.height}px;flex:0 0 ${tileWidth}px;`
                  })
                : buildMediaTile(item, 'photo-grid-button gallery-ratio-tile', {
                    badge: item.searchMatch ? '<span class="media-badge-dot"></span>' : '',
                    style: `width:${tileWidth}px;height:${row.height}px;flex:0 0 ${tileWidth}px;`
                  })
            )).join('')}
          </div>
        `).join('')}
      </div>
    `;
  }
  return `<div class="photo-grid gallery-photo-grid">${entryPreviewTile}${media.map((item) => buildMediaTile(item, 'photo-grid-button', { badge: item.searchMatch ? '<span class="media-badge-dot"></span>' : '' })).join('')}</div>`;
}

function buildGalleryPlaceholderHtml(entry, localIndex) {
  const estimate = estimateGalleryGroupHeight(entry);
  return `<section class="gallery-group gallery-group-placeholder" data-gallery-index="${localIndex}" aria-hidden="true" style="height:${estimate}px"></section>`;
}

function buildGalleryGroupHtml(entry, localIndex) {
  const day = entry.day;
  const media = entry.galleryMedia || [];
  if (!media.length) return '';
  return `
    <section class="gallery-group" data-gallery-index="${localIndex}">
      <div class="gallery-group-head">
        <a class="gallery-entry-link" href="/entry/${day.isoDate}" data-open-entry-detail="${day.isoDate}" aria-label="Open entry for ${escapeHtml(day.dateLabel)}">
          <span>${escapeHtml(day.dateLabel)}</span>
          ${renderPhIcon('caret-right', { variant: 'bold' })}
        </a>
      </div>
      ${buildGalleryMediaLayoutHtml(entry)}
    </section>
  `;
}

function buildGalleryUnitHtml(entry, localIndex) {
  const hydrated = state.searchMode || entry?.day?.__hydrated;
  const body = hydrated ? buildGalleryGroupHtml(entry, localIndex) : buildGalleryPlaceholderHtml(entry, localIndex);
  return `<div class="gallery-unit ${hydrated ? 'is-hydrated' : 'is-placeholder'}" data-gallery-index="${localIndex}" data-gallery-date="${escapeHtml(entry?.day?.isoDate || '')}">${body}</div>`;
}

function createGalleryUnitNode(entry, localIndex) {
  const template = document.createElement('template');
  template.innerHTML = buildGalleryUnitHtml(entry, localIndex).trim();
  return template.content.firstElementChild;
}

function refreshGalleryUnitNode(unit, entry, localIndex) {
  if (!unit) return;
  const hydrated = state.searchMode || entry?.day?.__hydrated;
  unit.dataset.galleryIndex = String(localIndex);
  unit.dataset.galleryDate = entry?.day?.isoDate || '';
  unit.classList.toggle('is-hydrated', hydrated);
  unit.classList.toggle('is-placeholder', !hydrated);
  unit.innerHTML = hydrated ? buildGalleryGroupHtml(entry, localIndex) : buildGalleryPlaceholderHtml(entry, localIndex);
}

function syncGalleryWindowDom(entries, renderStart, renderEnd, { force = false } = {}) {
  if (state.searchMode || force) {
    let html = '';
    for (let localIndex = renderStart; localIndex <= renderEnd; localIndex += 1) {
      html += buildGalleryUnitHtml(entries[localIndex], localIndex);
    }
    dom.galleryFeed.innerHTML = html;
    return;
  }

  let units = Array.from(dom.galleryFeed.querySelectorAll('.gallery-unit[data-gallery-index]'));
  if (!units.length) {
    const fragment = document.createDocumentFragment();
    for (let localIndex = renderStart; localIndex <= renderEnd; localIndex += 1) {
      fragment.appendChild(createGalleryUnitNode(entries[localIndex], localIndex));
    }
    dom.galleryFeed.innerHTML = '';
    dom.galleryFeed.appendChild(fragment);
    return;
  }

  let currentStart = Number(units[0].dataset.galleryIndex);
  let currentEnd = Number(units[units.length - 1].dataset.galleryIndex);
  if (!Number.isFinite(currentStart) || !Number.isFinite(currentEnd) || renderEnd < currentStart || renderStart > currentEnd) {
    let html = '';
    for (let localIndex = renderStart; localIndex <= renderEnd; localIndex += 1) {
      html += buildGalleryUnitHtml(entries[localIndex], localIndex);
    }
    dom.galleryFeed.innerHTML = html;
    return;
  }

  while (dom.galleryFeed.firstElementChild && Number(dom.galleryFeed.firstElementChild.dataset.galleryIndex) < renderStart) {
    dom.galleryFeed.firstElementChild.remove();
  }
  while (dom.galleryFeed.lastElementChild && Number(dom.galleryFeed.lastElementChild.dataset.galleryIndex) > renderEnd) {
    dom.galleryFeed.lastElementChild.remove();
  }

  units = Array.from(dom.galleryFeed.querySelectorAll('.gallery-unit[data-gallery-index]'));
  currentStart = units.length ? Number(units[0].dataset.galleryIndex) : renderEnd + 1;
  currentEnd = units.length ? Number(units[units.length - 1].dataset.galleryIndex) : renderStart - 1;

  const prependFragment = document.createDocumentFragment();
  for (let localIndex = currentStart - 1; localIndex >= renderStart; localIndex -= 1) {
    prependFragment.insertBefore(createGalleryUnitNode(entries[localIndex], localIndex), prependFragment.firstChild);
  }
  if (prependFragment.childNodes.length) {
    dom.galleryFeed.prepend(prependFragment);
  }

  for (let localIndex = currentEnd + 1; localIndex <= renderEnd; localIndex += 1) {
    dom.galleryFeed.appendChild(createGalleryUnitNode(entries[localIndex], localIndex));
  }

  units = Array.from(dom.galleryFeed.querySelectorAll('.gallery-unit[data-gallery-index]'));
  units.forEach((unit) => {
    const localIndex = Number(unit.dataset.galleryIndex);
    if (!Number.isFinite(localIndex) || localIndex < renderStart || localIndex > renderEnd) return;
    const hydrated = state.searchMode || entries[localIndex]?.day?.__hydrated;
    const isHydrated = unit.classList.contains('is-hydrated');
    if (hydrated !== isHydrated) {
      refreshGalleryUnitNode(unit, entries[localIndex], localIndex);
    }
  });
}

function renderGalleryWindow({ force = false } = {}) {
  if (!dom.galleryFeed) return;
  const entries = gallerySourceEntries();
  const total = entries.length;
  applyGalleryPreferences();
  if (!total) {
    state.galleryLoadedStart = null;
    state.galleryLoadedEnd = null;
    dom.galleryTopSpacer.style.height = '0px';
    dom.galleryBottomSpacer.style.height = '0px';
    dom.galleryFeed.innerHTML = '<div class="empty-state"><h2>No media to show</h2><p>Try a different search or upload media to start the gallery.</p></div>';
    return;
  }

  if (state.searchMode) {
    state.galleryLoadedStart = 0;
    state.galleryLoadedEnd = total - 1;
  } else if (state.galleryLoadedStart === null || state.galleryLoadedEnd === null) {
    const initialIndex = predictGalleryIndexFromScroll(entries) ?? 0;
    const range = buildGalleryWindowRangeAroundIndex(initialIndex, 'center', entries);
    state.galleryLoadedStart = range.start;
    state.galleryLoadedEnd = range.end;
  } else {
    state.galleryLoadedStart = clamp(state.galleryLoadedStart, 0, total - 1);
    state.galleryLoadedEnd = clamp(state.galleryLoadedEnd, state.galleryLoadedStart, total - 1);
  }

  const renderStart = state.galleryLoadedStart ?? 0;
  const renderEnd = state.galleryLoadedEnd ?? (total - 1);
  state.galleryRenderStart = renderStart;
  state.galleryRenderEnd = renderEnd;
  syncGalleryWindowDom(entries, renderStart, renderEnd, { force });
  updateGallerySpacers(entries);
  rebuildViewerSequence();
  setupMediaObserver();
  requestAnimationFrame(() => refreshGalleryHeightMetrics({ entries }));
}

function setGalleryVisibleWindow(start, end) {
  const entries = gallerySourceEntries();
  if (!entries.length) {
    state.galleryLoadedStart = null;
    state.galleryLoadedEnd = null;
    renderGalleryWindow();
    return;
  }
  const safeStart = clamp(start, 0, entries.length - 1);
  const safeEnd = clamp(end, safeStart, entries.length - 1);
  state.galleryLoadedStart = safeStart;
  state.galleryLoadedEnd = safeEnd;
  renderGalleryWindow({ force: false });
}

function updateActiveGalleryFromScroll() {
  const entries = gallerySourceEntries();
  const activeLocalIndex = predictGalleryIndexFromAnchor(entries);
  const entry = activeLocalIndex !== null && activeLocalIndex !== undefined ? entries[activeLocalIndex] : null;
  state.activeDate = entry?.day?.isoDate || null;
  updateStickyMonth();
  updateRailActive();
  updateScrollThumbLabel();
  updateTopbarDateLabel();
}

async function recoverGalleryIfOutrun() {
  if (state.searchMode || state.route.view !== 'home' || state.activeView !== 'gallery') return false;
  const entries = gallerySourceEntries();
  const units = Array.from(document.querySelectorAll('#galleryFeed .gallery-unit'));
  if (!entries.length || !units.length) return false;
  const markerY = galleryMarkerViewportY();
  const firstRect = units[0].getBoundingClientRect();
  const lastRect = units[units.length - 1].getBoundingClientRect();
  const tolerance = estimateGalleryGroupHeight(entries[0]) * 0.8;
  const outrunAbove = markerY < firstRect.top - tolerance;
  const outrunBelow = markerY > lastRect.bottom + tolerance;
  if (!outrunAbove && !outrunBelow) return false;
  const localIndex = predictGalleryIndexFromScroll(entries);
  if (localIndex === null) return false;
  const range = buildGalleryWindowRangeAroundIndex(localIndex, 'center', entries);
  setGalleryVisibleWindow(range.start, range.end);
  await ensureGalleryRangeLoaded(entries, range.start, range.end);
  return true;
}

function reconcileGalleryWindowAroundActiveDate() {
  if (state.searchMode || state.route.view !== 'home' || state.activeView !== 'gallery') return;
  const entries = gallerySourceEntries();
  if (!entries.length) return;
  const localIndex = findVisibleGalleryIndexFromDom() ?? entries.findIndex((entry) => entry?.day?.isoDate === state.activeDate);
  if (localIndex === null || localIndex === undefined || localIndex < 0) return;
  const range = buildGalleryWindowRangeAroundIndex(localIndex, 'center', entries);
  if (range.start === state.galleryLoadedStart && range.end === state.galleryLoadedEnd) return;
  setGalleryVisibleWindow(range.start, range.end);
  if (!state.searchMode) void ensureGalleryRangeLoaded(entries, range.start, range.end);
}

function getCalendarSourceDay(isoDate) {
  if (!isoDate) return null;
  if (state.searchMode) {
    const index = activeSourceIndexByDate()[isoDate];
    return index === undefined ? null : activeSourceDays()[index];
  }
  const fullDay = state.fullTimelineDays.find((day) => day.isoDate === isoDate);
  if (fullDay) return fullDay;
  const loadedDay = state.loadedDays.find((day) => day.isoDate === isoDate);
  if (loadedDay) return loadedDay;
  const index = activeSourceIndexByDate()[isoDate];
  return index === undefined ? null : activeSourceDays()[index];
}

function hydrateCalendarDay(isoDate) {
  if (!isoDate || state.searchMode || state.fullTimelineLoaded) return;
  const localIndex = state.homeSourceIndexByDate[isoDate];
  if (localIndex === undefined || isHydratedHomeDay(localIndex)) return;
  void ensureHomeRangeLoaded(localIndex, localIndex).catch(console.error);
}

function buildCalendarDaySummaryMap() {
  return new Map(activeSourceDays().map((day) => [day.isoDate, day]));
}

function calendarCellMedia(day) {
  if (!day) return null;
  const media = state.searchMode ? (day.matchedMedia || []) : (day.photos || []);
  return media[0] || null;
}

function calendarJournalPreviewHtml(day, { maxChars = 150, maxLines = 2 } = {}) {
  if (!day?.journal) return '';
  const lines = buildPreviewLines(day.journal, maxChars, maxLines)
    .map((line) => `<span class="calendar-journal-line">${highlightPlainText(line || '', state.searchMode ? state.searchQuery : '')}</span>`)
    .join('');
  return lines ? `<div class="calendar-journal-preview">${lines}</div>` : '';
}

async function browseFolder(rootId, relativePath = '.', { preserveSelection = false } = {}) {
  const payload = await fetchJson(`/api/folders/browse?rootId=${encodeURIComponent(rootId || '0')}&path=${encodeURIComponent(relativePath === '.' ? '' : relativePath || '')}`, { cache: 'no-store' });
  state.folderBrowse = payload;
  if (!preserveSelection) {
    state.folderViewSelection = {
      rootId: payload.rootId || String(rootId || '0'),
      relativePath: payload.relativePath || '.'
    };
  }
  rebuildViewerSequence();
  return payload;
}

async function ensureFoldersReady() {
  if (state.folderReadyPromise) return state.folderReadyPromise;
  state.folderReadyPromise = (async () => {
    if (!state.folderRoots.length) await loadUploadFolders();
    if (state.searchMode) return;
    const selection = state.folderViewSelection || { rootId: state.folderRoots[0]?.rootId || '0', relativePath: '.' };
    if (selection.rootId === '__roots__') return;
    if (state.folderBrowse && state.folderBrowse.rootId === selection.rootId && state.folderBrowse.relativePath === selection.relativePath) return;
    await browseFolder(selection.rootId, selection.relativePath || '.');
  })().catch((error) => {
    state.folderReadyError = error?.message || 'Folders could not load.';
    throw error;
  }).finally(() => {
    state.folderReadyPromise = null;
  });
  return state.folderReadyPromise;
}

function preloadFolders() {
  if (state.searchMode || state.folderReadyPromise) return;
  state.folderReadyError = '';
  void ensureFoldersReady().then(() => {
    if (state.activeView === 'folders') renderFoldersView();
  }).catch((error) => {
    console.error(error);
    if (state.activeView === 'folders') renderFoldersView();
  });
}

function activeScrollTotal() {
  if (state.activeView === 'gallery') return gallerySourceEntries().length;
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
  if (!state.searchMode && state.activeView === 'calendar') {
    renderCalendarView({ preserveGridScroll: true, alignMonth: false });
  } else if (!state.searchMode && state.activeView === 'gallery' && dom.galleryFeed.querySelector('.gallery-unit')) {
    renderGalleryWindow();
  } else if (!state.searchMode && dom.timelineFeed.querySelector('.timeline-unit')) {
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
  state.route = { view: 'home', scrollY: state.homeScrollY || 0, activeView: state.activeView };
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
      if (state.activeView === 'gallery') void ensureGalleryWindowRendered().catch(console.error);
      if (state.activeView === 'calendar') renderCalendarView({ preserveGridScroll: true, alignMonth: false });
      rebuildViewerSequence();
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
    if (state.activeView === 'timeline') {
      const range = buildWindowRangeAroundIndex(0, 'top');
      setVisibleWindow(range.start, range.end);
    } else {
      renderActiveBrowseView();
    }
  } else {
    renderActiveBrowseView();
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

function openSettings({ pushHistory = true } = {}) {
  if (state.settingsOpen) return;
  state.settingsOpen = true;
  dom.settingsModal.classList.remove('hidden');
  dom.body.classList.add('viewer-open');
  setSettingsPanel(state.settingsPanel || 'account');
  loadDesktopSettings().catch((error) => setSettingsDevicesStatus(error.message));
  if (pushHistory) {
    const base = history.state?.viewer ? { ...history.state } : { ...(history.state || {}), ...(state.route || {}) };
    pushAppHistory({ ...base, settingsOpen: true });
  }
}

function closeSettings({ fromHistory = false } = {}) {
  if (!state.settingsOpen) return;
  if (!fromHistory && history.state?.settingsOpen) {
    history.back();
    return;
  }
  state.settingsOpen = false;
  dom.settingsModal.classList.add('hidden');
  syncOverlayBodyState();
}

function setSettingsDevicesStatus(message) {
  if (dom.settingsDevicesStatus) dom.settingsDevicesStatus.textContent = message || '';
}

function desktopFolderTemplate(folder = {}) {
  return {
    id: folder.id || `media-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label: folder.label || '',
    path: folder.path || '',
    enabled: folder.enabled !== false,
    cloudPolicy: folder.cloudPolicy || 'derivatives'
  };
}

function renderSettingsMediaFolders() {
  if (!dom.settingsMediaFolders) return;
  const folders = Array.isArray(state.desktopSettings?.mediaFolders) ? state.desktopSettings.mediaFolders : [];
  const availabilityRoots = Array.isArray(state.desktopMediaAvailability?.roots) ? state.desktopMediaAvailability.roots : [];
  const availabilityByPath = new Map(availabilityRoots.map((root) => [root.path, root]));
  dom.settingsMediaFolders.innerHTML = folders.map((folder) => `
    <div class="settings-media-folder" data-folder-id="${escapeHtml(folder.id)}">
      <label>
        Label
        <input data-field="label" value="${escapeHtml(folder.label || '')}" />
      </label>
      <label class="settings-path-field">
        Folder path
        <span>
          <input data-field="path" value="${escapeHtml(folder.path || '')}" />
          <button class="icon-button" type="button" data-action="pick-folder" title="Choose folder"><i class="ph-bold ph-folder-open"></i></button>
        </span>
      </label>
      <label>
        Cloud policy
        <select data-field="cloudPolicy">
          <option value="metadata-only">Metadata only</option>
          <option value="derivatives">Thumbnails/previews</option>
          <option value="selected-originals">Selected originals</option>
          <option value="all-originals">All originals</option>
        </select>
      </label>
      <label class="settings-inline-check">
        <input data-field="enabled" type="checkbox" ${folder.enabled !== false ? 'checked' : ''} />
        Enabled
      </label>
      ${(() => {
        const status = availabilityByPath.get(folder.path);
        if (!status) return '';
        if (status.warningCount) return `<p class="settings-folder-warning"><i class="ph-duotone ph-warning"></i><span>${escapeHtml(String(status.warningCount))} media original${status.warningCount === 1 ? '' : 's'} need attention.</span></p>`;
        if (status.available === false) return '';
        return `<p class="settings-folder-ok"><i class="ph-duotone ph-check-circle"></i><span>Available</span></p>`;
      })()}
      <button class="settings-remove-button" type="button" data-action="remove-folder"><i class="ph-bold ph-trash"></i><span>Remove</span></button>
    </div>
  `).join('');
  dom.settingsMediaFolders.querySelectorAll('.settings-media-folder').forEach((row) => {
    const folder = folders.find((item) => item.id === row.dataset.folderId) || {};
    row.querySelector('[data-field="cloudPolicy"]').value = folder.cloudPolicy || 'derivatives';
  });
}

function renderSettingsHostSummary() {
  if (!dom.settingsHostSummary) return;
  const settings = state.desktopSettings || {};
  const cloud = state.desktopCloudStatus || {};
  const onboarding = state.desktopOnboardingStatus || {};
  const mirrorStatus = state.desktopJournalMirrorStatus || {};
  const mediaCount = Number(onboarding.sourceCounts?.mediaFolders || settings.mediaFolders?.length || 0);
  const uploadDestination = settings.deviceUploadDestinationPath || 'Default device uploads folder';
  const journalMirror = settings.localJournalMirrorPath || 'Not configured';
  const journalMirrorState = mirrorStatus.configured
    ? mirrorStatus.syncing || mirrorStatus.status === 'syncing'
      ? 'Syncing journal mirror'
      : mirrorStatus.status === 'conflict' || Number(mirrorStatus.conflictCount || 0) > 0
        ? 'Journal mirror has conflicts'
        : mirrorStatus.available === false || mirrorStatus.status === 'unavailable'
          ? 'Journal mirror unavailable. Using local backup'
          : 'Journal mirror synced'
    : 'Not configured';
  const signedIn = cloud.signedIn ? `Connected as ${cloud.email || cloud.userId || 'cloud account'}` : 'Not connected to cloud';
  const hostMode = settings.hostAvailability || 'local-only';
  const lastSync = cloud.lastCloudSyncAt ? new Date(cloud.lastCloudSyncAt).toLocaleString() : 'Not synced yet';
  dom.settingsHostSummary.innerHTML = `
    <div><span>Cloud</span><strong>${escapeHtml(signedIn)}</strong></div>
    <div><span>Media host</span><strong>${escapeHtml(hostMode)}</strong></div>
    <div><span>Photo sources</span><strong>${mediaCount}</strong></div>
    <div><span>Device uploads</span><strong>${escapeHtml(uploadDestination)}</strong></div>
    <div><span>Journal mirror</span><strong>${escapeHtml(journalMirror)}</strong></div>
    <div><span>Mirror status</span><strong>${escapeHtml(journalMirrorState)}</strong></div>
    <div><span>Last sync</span><strong>${escapeHtml(lastSync)}</strong></div>
  `;
}

function hydrateDesktopSettingsForm() {
  const settings = state.desktopSettings || {};
  if (dom.settingsDeviceNameInput) dom.settingsDeviceNameInput.value = settings.deviceName || '';
  if (dom.settingsHostAvailabilityInput) dom.settingsHostAvailabilityInput.value = settings.hostAvailability || 'local-only';
  if (dom.settingsJournalMirrorPathInput) dom.settingsJournalMirrorPathInput.value = settings.localJournalMirrorPath || '';
  if (dom.settingsUploadDestinationInput) dom.settingsUploadDestinationInput.value = settings.deviceUploadDestinationPath || '';
  renderSettingsMediaFolders();
  renderSettingsHostSummary();
  updateSettingsProfileUi();
}

async function loadDesktopSettings() {
  setSettingsDevicesStatus('Loading desktop settings...');
  const [settingsPayload, cloudStatus, onboardingStatus, trayStatus] = await Promise.all([
    fetchJson('/api/desktop/sync-settings'),
    fetchJson('/api/desktop/cloud/status').catch((error) => ({ error: error.message })),
    fetchJson('/api/desktop/onboarding/status').catch((error) => ({ error: error.message })),
    fetchJson('/api/desktop/tray/status', { cache: 'no-store' }).catch((error) => ({ error: error.message }))
  ]);
  state.desktopSettings = settingsPayload.settings || {};
  state.desktopCloudStatus = cloudStatus;
  state.desktopOnboardingStatus = onboardingStatus;
  state.desktopMediaAvailability = trayStatus?.mediaAvailability || {};
  state.desktopJournalMirrorStatus = trayStatus?.journalMirror || {};
  state.desktopCloudSignedIn = Boolean(cloudStatus?.signedIn);
  hydrateDesktopSettingsForm();
  if (cloudStatus?.error) setSettingsDevicesStatus(cloudStatus.error);
  else setSettingsDevicesStatus(cloudStatus?.signedIn ? 'Desktop cloud connection is active.' : 'Desktop is running locally. Sign in from onboarding to connect cloud sync.');
}

function collectDesktopSettings() {
  const current = state.desktopSettings || {};
  const folders = Array.from(dom.settingsMediaFolders?.querySelectorAll('.settings-media-folder') || []).map((row) => desktopFolderTemplate({
    id: row.dataset.folderId,
    label: row.querySelector('[data-field="label"]').value.trim(),
    path: row.querySelector('[data-field="path"]').value.trim(),
    cloudPolicy: row.querySelector('[data-field="cloudPolicy"]').value,
    enabled: row.querySelector('[data-field="enabled"]').checked
  })).filter((folder) => folder.path);
  return {
    ...current,
    deviceName: dom.settingsDeviceNameInput?.value.trim() || current.deviceName || '',
    hostAvailability: dom.settingsHostAvailabilityInput?.value || current.hostAvailability || 'local-only',
    localJournalMirrorPath: dom.settingsJournalMirrorPathInput?.value.trim() || '',
    deviceUploadDestinationPath: dom.settingsUploadDestinationInput?.value.trim() || '',
    mediaFolders: folders
  };
}

async function saveDesktopSettingsFromPanel() {
  if (!dom.settingsSaveDevicesButton) return;
  try {
    dom.settingsSaveDevicesButton.disabled = true;
    setSettingsDevicesStatus('Saving devices and media settings...');
    const payload = await postJson('/api/desktop/sync-settings', { settings: collectDesktopSettings() });
    state.desktopSettings = payload.settings || state.desktopSettings;
    state.desktopJournalMirrorStatus = payload.journalMirror || state.desktopJournalMirrorStatus || {};
    hydrateDesktopSettingsForm();
    setSettingsDevicesStatus(`Saved at ${new Date().toLocaleTimeString()}.`);
  } catch (error) {
    setSettingsDevicesStatus(error.message);
  } finally {
    dom.settingsSaveDevicesButton.disabled = false;
  }
}

async function syncDesktopCloudFromPanel() {
  if (!dom.settingsSyncNowButton) return;
  try {
    dom.settingsSyncNowButton.disabled = true;
    setSettingsDevicesStatus('Syncing with Book of Life Cloud...');
    const result = await postJson('/api/desktop/cloud/sync', {});
    state.desktopCloudStatus = await fetchJson('/api/desktop/cloud/status');
    renderSettingsHostSummary();
    updateSettingsProfileUi();
    setSettingsDevicesStatus(`Cloud sync complete. Pushed ${result.pushed || 0}, pulled ${result.pulled || 0}.`);
  } catch (error) {
    setSettingsDevicesStatus(error.message);
  } finally {
    dom.settingsSyncNowButton.disabled = false;
  }
}

async function pickSettingsDirectory() {
  if (window.bookOfLifeDesktop?.pickDirectory) {
    const result = await window.bookOfLifeDesktop.pickDirectory();
    return result?.canceled ? '' : result?.path || '';
  }
  return window.prompt('Enter the folder path') || '';
}

function syncSettingsAccountUi() {
  const accountEnabled = Boolean(state.authEnabled);
  dom.changePasswordButton?.classList.toggle('hidden', !accountEnabled);
  updateSettingsProfileUi();
}

async function openProfileMenu(event) {
  event?.preventDefault?.();
  openSettings();
}

async function changePassword() {
  const currentPassword = window.prompt('Enter your current password.', '');
  if (currentPassword === null) return;
  const nextPassword = window.prompt('Enter your new password.', '');
  if (nextPassword === null) return;
  const confirmPassword = window.prompt('Re-enter your new password.', '');
  if (confirmPassword === null) return;
  if (!String(nextPassword || '').trim()) {
    window.alert('Enter a new password to continue.');
    return;
  }
  if (nextPassword !== confirmPassword) {
    window.alert('The new passwords did not match.');
    return;
  }

  const button = dom.changePasswordButton;
  const previousDisabled = Boolean(button?.disabled);
  const previousLabel = button?.innerHTML || '';
  if (button) {
    button.disabled = true;
    button.innerHTML = `${renderPhIcon('spinner-gap')} Saving…`;
  }

  try {
    await fetchJson('/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, nextPassword })
    });
    closeSettings();
    window.alert('Password updated.');
  } catch (error) {
    window.alert(error.message || 'Failed to update the password.');
  } finally {
    if (button) {
      button.disabled = previousDisabled;
      button.innerHTML = previousLabel;
    }
  }
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
  dom.yearSection?.classList.toggle('hidden', state.searchUiOpen || state.searchMode || state.activeView !== 'home');
  dom.timelineSection?.classList.toggle('hidden', !state.searchMode && state.activeView !== 'timeline');
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
    renderActiveBrowseView();
    renderDefaultYearSubtitle();
    renderSearchStatus();
  } else if (!shouldClear) {
    restoreHomeTimelineState();
    await goHome({ push: false, restoreScroll: false, scrollY: state.homeScrollY || 0 });
    await ensureTimelineLoaded(state.bootstrap?.lastDate);
    window.scrollTo({ top: state.homeScrollY || 0, behavior: 'auto' });
    renderActiveBrowseView();
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

function renderUploadPreviewsLegacyInitial() {
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

async function openUploadModalLegacy(isoDate) {
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
      ? `<video src="${item.objectUrl}" muted playsinline preload="none"></video><span class="upload-preview-video">${renderPhIcon('play', { variant: 'fill' })}</span>`
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

function uploadMediaFilesLegacy() {
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

function mediaOriginalStatusLabel(item = {}) {
  switch (item.availability) {
    case 'cloud-only':
      return 'Original stored in cloud to save space';
    case 'root-unavailable':
      return 'Original is on a disconnected drive';
    case 'missing-cloud-risk':
      return 'Original is missing locally; cloud copy exists';
    case 'missing-unapproved':
    case 'missing-cloud':
      return 'Original is missing from this device';
    default:
      return item.originalAvailable === false ? 'Original unavailable' : 'Original on this device';
  }
}

function normalizedMediaBackupStatus(media = {}) {
  const locations = Array.isArray(media.locations) ? media.locations : [];
  const status = media.backupStatus || {};
  const currentDeviceId = status.currentDeviceId || media.currentDeviceId || '';
  const availableLocations = locations.filter((location) => location.availability === 'available');
  const currentDeviceHasOriginal = typeof status.currentDeviceHasOriginal === 'boolean'
    ? status.currentDeviceHasOriginal
    : availableLocations.some((location) => currentDeviceId && location.deviceId === currentDeviceId) || media.originalAvailable !== false;
  const remoteDesktopIds = Array.isArray(status.desktopBackupDeviceIds)
    ? status.desktopBackupDeviceIds.filter((deviceId) => !currentDeviceId || deviceId !== currentDeviceId)
    : availableLocations.filter((location) => location.deviceType === 'desktop' && (!currentDeviceId || location.deviceId !== currentDeviceId)).map((location) => location.deviceId);
  const remoteTypes = Array.isArray(status.availableRemoteDeviceTypes)
    ? status.availableRemoteDeviceTypes
    : availableLocations.filter((location) => !currentDeviceId || location.deviceId !== currentDeviceId).map((location) => location.deviceType);
  return {
    cloudBackedUp: Boolean(status.cloudBackedUp || media.cloudOriginal?.inCloud || media.availabilitySummary?.originalInCloud),
    desktopBackedUp: remoteDesktopIds.filter(Boolean).length > 0,
    syncing: Array.isArray(status.syncingDestinations) && status.syncingDestinations.length > 0,
    failed: Array.isArray(status.failedDestinations) && status.failedDestinations.length > 0,
    phoneOnly: status.currentDeviceType === 'desktop' && !currentDeviceHasOriginal && remoteTypes.some((type) => type && type !== 'desktop'),
    offline: status.hasUsableOriginalRoute === false || (!currentDeviceHasOriginal && !media.cloudOriginal?.inCloud && !availableLocations.some((location) => location.online !== false))
  };
}

function buildMediaStatusIcons(media, hero = false) {
  const status = normalizedMediaBackupStatus(media);
  const icons = [];
  if (status.cloudBackedUp) icons.push(['cloud-check', 'Original backed up to cloud', 'cloud']);
  if (status.desktopBackedUp) icons.push(['hard-drives', 'Original backed up to another desktop', 'server']);
  if (status.syncing) icons.push(['spinner-gap', 'Original backup is syncing', 'loading is-spinning']);
  if (status.phoneOnly) icons.push(['device-mobile', 'Original is available on another device', 'phone']);
  if (status.failed) icons.push(['warning-circle', 'An original backup needs attention', 'error']);
  if (status.offline) icons.push(['cloud-slash', 'No original source is currently reachable', 'offline']);
  if (!icons.length) return '';
  return `<div class="media-status-icons ${hero ? 'hero-status-icons' : ''}" aria-label="Media backup status">${icons.map(([icon, label, className]) =>
    `<span class="media-status-icon media-status-${className}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${renderPhIcon(icon, { variant: 'duotone' })}</span>`
  ).join('')}</div>`;
}

function buildMediaTile(media, className, { hero = false, label = '', badge = '', style = '' } = {}) {
  const previewSrc = media.type === 'video' ? (media.previewUrl || media.thumbUrl) : media.thumbUrl;
  const previewNode = media.type === 'video'
    ? `<video class="lazy-media" data-src="${previewSrc}" muted autoplay loop playsinline preload="none" poster="${escapeHtml(media.thumbUrl || '')}" aria-hidden="true"></video>`
    : '';
  const likedIndicator = media.liked ? `<span class="media-liked-indicator" aria-hidden="true">${renderPhIcon('heart', { variant: 'fill' })}</span>` : '';
  return `
    <button class="${className} media-tile open-media ${hero ? 'hero-photo' : ''} ${media.type === 'video' ? '' : 'lazy-media lazy-media-bg'}" type="button" data-media-id="${media.id}" ${style ? `style="${style}"` : ''} ${media.type === 'video' ? '' : `data-src="${previewSrc}"`}>
      <div class="media-skeleton"></div>
      ${previewNode}
      ${likedIndicator}
      ${hero ? '<div class="hero-gradient"></div>' : ''}
      ${label ? `<div class="hero-stamp">${escapeHtml(label)}</div>` : ''}
      ${buildMediaStatusIcons(media, hero)}
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

function buildDayHtml(day, { forceFull = false } = {}) {
  const searchCompact = state.searchMode && !forceFull;
  const media = searchCompact ? (day.matchedMedia || []) : (day.photos || []);
  let mediaHtml = '';
  const entryActionHtml = searchCompact
    ? `<button class="journal-edit-button icon-button" type="button" data-open-search-detail="${day.isoDate}" aria-label="Open search result">${renderPhIcon('arrow-right', { variant: 'bold' })}</button>`
    : buildEntryAction(day);
  const uploadActionHtml = searchCompact ? '' : buildUploadAction(day);

  if (media.length) {
    mediaHtml = `<div class="photo-grid photo-grid--timeline">${media.map((item) => buildMediaTile(item, 'photo-grid-button', { badge: item.searchMatch ? '<span class="media-badge-dot"></span>' : '' })).join('')}</div>`;
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

function normalizeEntryDetailDay(entry) {
  if (!entry?.isoDate) return null;
  return {
    isoDate: entry.isoDate,
    dateLabel: entry.dateLabel || dateRailLabel(entry.isoDate) || entry.isoDate,
    monthKey: entry.monthKey || entry.isoDate.slice(0, 7),
    monthLabel: entry.monthLabel || monthLabelForIso(entry.isoDate),
    photoCount: Number(entry.photoCount || entry.photos?.length || 0),
    photos: Array.isArray(entry.photos) ? entry.photos : [],
    journal: entry.journal || null,
    hasJournal: Boolean(entry.hasJournal || entry.journal),
    wordCount: Number(entry.wordCount || entry.journal?.wordCount || 0)
  };
}

async function loadEntryDetailDay(isoDate) {
  const payload = await fetchJson(`/api/entry/${isoDate}`);
  return normalizeEntryDetailDay(payload);
}

function renderEntryDetail(day = state.entryDetailDay) {
  if (!dom.entryDetailBody) return;
  if (!day) {
    dom.entryDetailBody.innerHTML = '<div class="empty-state"><h2>Entry not found</h2><p>This entry could not be loaded.</p></div>';
    rebuildViewerSequence();
    return;
  }
  dom.entryDetailBody.innerHTML = buildDayHtml(day, { forceFull: true });
  rebuildViewerSequence();
  setupMediaObserver();
}

function viewerSourceDays() {
  if (state.searchMode) return state.loadedDays;
  if (state.fullTimelineLoaded && state.fullTimelineDays.length) return state.fullTimelineDays;
  return state.loadedDays;
}

function mediaItemsForActiveView() {
  if (state.route.view === 'entry-detail') {
    return state.entryDetailDay?.photos || [];
  }
  if (state.activeView === 'folders') {
    if (state.searchMode) {
      const selectedKey = `${state.folderViewSelection.rootId || '0'}::${state.folderViewSelection.relativePath || '.'}`;
      return (getSearchFolderBuckets().find((bucket) => bucket.key === selectedKey)?.media || []);
    }
    return state.folderBrowse?.media || [];
  }
  if (state.activeView === 'calendar') {
    const day = getCalendarSourceDay(state.calendarViewDate);
    if (day) return state.searchMode ? (day.matchedMedia || []) : (day.photos || []);
    return [];
  }
  if (state.activeView === 'gallery') {
    return gallerySourceEntries().flatMap((entry) => entry.galleryMedia || []);
  }
  return viewerSourceDays().flatMap((day) => (state.searchMode ? (day.matchedMedia || []) : (day.photos || [])));
}

function rebuildViewerSequence({ preferredMediaId = null, refreshOpenViewer = false, forceDateToast = false } = {}) {
  const fallbackMediaId = preferredMediaId || mediaViewer.getCurrentItem()?.id || null;
  state.viewerSequence = mediaItemsForActiveView().map((photo) => photo);
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

    if (node.classList?.contains('lazy-media-bg')) {
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

  document.querySelectorAll('.lazy-media[data-src]').forEach((node) => {
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
    state.activeDate = state.route.view === 'entry-detail' ? state.entryDetailDate : null;
    updateStickyMonth();
    updateRailActive();
    syncScrollThumb();
    updateTopbarDateLabel();
    return;
  }

  if (state.activeView === 'gallery') {
    updateActiveGalleryFromScroll();
    syncScrollThumb();
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
  let isoDate = state.activeDate;
  if (state.activeView === 'gallery') {
    const entries = gallerySourceEntries();
    isoDate = indexOverride !== null ? entries[indexOverride]?.day?.isoDate : state.activeDate;
  } else {
    isoDate = state.searchMode
      ? (indexOverride !== null ? activeSourceDays()[indexOverride]?.isoDate : state.activeDate)
      : (indexOverride !== null ? state.indexToDate[indexOverride] : state.activeDate);
  }
  dom.scrollThumbLabel.textContent = monthChipLabel(isoDate);
}

function syncScrollThumbPosition(indexOverride = null) {
  const activeIndex = indexOverride !== null
    ? indexOverride
    : (state.activeView === 'gallery'
      ? (state.activeDate ? gallerySourceEntries().findIndex((entry) => entry?.day?.isoDate === state.activeDate) : null)
      : (state.searchMode
        ? getLocalIndexForDate(state.activeDate)
        : (state.activeDate && state.dateIndexMap[state.activeDate] !== undefined ? state.dateIndexMap[state.activeDate] : null)));
  const total = activeScrollTotal();
  if (activeIndex === null || activeIndex === undefined || total <= 1) {
    dom.scrollHandle.style.top = '50%';
    return;
  }
  const minY = Math.max(topOffset() + 18, 88);
  const maxY = window.innerHeight - 88;
  const span = Math.max(140, maxY - minY);
  const rawRatio = activeIndex / Math.max(1, total - 1);
  const ratio = state.activeView === 'gallery' ? rawRatio : 1 - rawRatio;
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
  const ratio = state.activeView === 'gallery' ? positionRatio : 1 - positionRatio;
  const total = activeScrollTotal();
  return clamp(Math.round(ratio * Math.max(0, total - 1)), 0, Math.max(0, total - 1));
}

async function jumpToIndex(index, behavior = 'auto') {
  if (state.activeView === 'gallery') {
    await jumpToGalleryIndex(index, behavior);
    return;
  }
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

async function jumpToGalleryIndex(index, behavior = 'auto') {
  const entries = gallerySourceEntries();
  if (!entries.length) return;
  const localIndex = clamp(index, 0, Math.max(0, entries.length - 1));
  const range = buildGalleryWindowRangeAroundIndex(localIndex, 'center', entries);
  setGalleryVisibleWindow(range.start, range.end);
  await ensureGalleryRangeLoaded(entries, range.start, range.end);
  requestAnimationFrame(() => {
    const unit = dom.galleryFeed.querySelector(`.gallery-unit[data-gallery-index="${localIndex}"]`);
    if (!unit) return;
    suppressGalleryCorrection(280);
    const top = Math.max(0, window.scrollY + unit.getBoundingClientRect().top - topOffset());
    window.scrollTo({ top, behavior });
    const isoDate = entries[localIndex]?.day?.isoDate;
    if (isoDate) state.activeDate = isoDate;
    updateStickyMonth();
    updateRailActive();
    syncScrollThumb();
    updateTopbarDateLabel();
  });
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

function scrollToGalleryUnitIndex(index, behavior = 'auto') {
  if (state.route.view !== 'home' || state.activeView !== 'gallery') return false;
  const entries = gallerySourceEntries();
  if (!entries.length) return false;
  const localIndex = clamp(index, 0, Math.max(0, entries.length - 1));
  const range = buildGalleryWindowRangeAroundIndex(localIndex, 'center', entries);
  if (range.start !== state.galleryLoadedStart || range.end !== state.galleryLoadedEnd) {
    setGalleryVisibleWindow(range.start, range.end);
    void ensureGalleryRangeLoaded(entries, range.start, range.end);
  }
  const unit = dom.galleryFeed.querySelector(`.gallery-unit[data-gallery-index="${localIndex}"]`);
  if (!unit) return false;
  suppressGalleryCorrection(280);
  const top = Math.max(0, window.scrollY + unit.getBoundingClientRect().top - topOffset());
  window.scrollTo({ top, behavior });
  const isoDate = entries[localIndex]?.day?.isoDate;
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
  if (state.activeView === 'gallery' && scrollToGalleryUnitIndex(index, 'auto')) return;
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

function getDisplayUrl(item) {
  return item?.displayUrl || item?.fullUrl || '';
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
    ['Original', mediaOriginalStatusLabel(item)],
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
  return photos.slice().sort((a, b) => String(b.modifiedAt || b.capturedAt || '').localeCompare(String(a.modifiedAt || a.capturedAt || '')) || String(a.fileName || '').localeCompare(String(b.fileName || '')));
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
    displayUrl: payloadPhoto.displayUrl || `/media/display/${payloadPhoto.id}`,
    downloadUrl: payloadPhoto.downloadUrl || `/media/download/${payloadPhoto.id}`,
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
    dom.viewerVideo.src = item.originalAvailable === false ? (item.previewUrl || item.thumbUrl || '') : getDisplayUrl(item);
    dom.viewerVideo.load();
    if (item.originalAvailable === false) {
      dom.viewerLoading.classList.add('hidden');
      requestAnimationFrame(() => { updateViewerTransform(); updateViewerLoadingPosition(); });
    } else {
      dom.viewerVideo.addEventListener('loadeddata', () => {
        if (token !== state.viewerLoadToken) return;
        dom.viewerLoading.classList.add('hidden');
        updateViewerTransform();
      }, { once: true });
    }
  } else {
    dom.viewerImage.classList.remove('hidden');
    dom.viewerImage.alt = item.fileName;
    dom.viewerImage.src = item.thumbUrl;
    if (item.originalAvailable === false) {
      dom.viewerLoading.classList.add('hidden');
      requestAnimationFrame(() => { updateViewerTransform(); updateViewerLoadingPosition(); });
      if (direction) playViewerStepAnimation(direction);
      return;
    }

    const fullImage = new Image();
    fullImage.onload = () => {
      if (token !== state.viewerLoadToken) return;
      dom.viewerImage.src = getDisplayUrl(item);
      dom.viewerLoading.classList.add('hidden');
      updateViewerTransform();
    };
    fullImage.onerror = () => {
      if (token !== state.viewerLoadToken) return;
      dom.viewerLoading.classList.add('hidden');
    };
    fullImage.src = getDisplayUrl(item);
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

function handleJournalToggle(isoDate, sourceNode = null) {
  const wasExpanded = state.expandedDates.has(isoDate);
  const sourceElement = sourceNode instanceof Element ? sourceNode : null;
  const block = sourceElement?.closest?.('[data-day-date]') || document.querySelector(`[data-day-date="${isoDate}"]`);
  const collapseButton = block?.querySelector('[data-journal-toggle]');
  const previousToggleTop = collapseButton ? collapseButton.getBoundingClientRect().top : null;
  const isCalendarPanelToggle = state.activeView === 'calendar' && Boolean(dom.calendarDayPanel?.contains(block));
  if (wasExpanded) state.expandedDates.delete(isoDate);
  else state.expandedDates.add(isoDate);

  if (state.route.view === 'entry-detail' && state.entryDetailDate === isoDate) {
    renderEntryDetail();
    requestAnimationFrame(() => {
      const nextBlock = dom.entryDetailBody?.querySelector(`[data-day-date="${isoDate}"]`);
      if (!nextBlock) return;
      if (wasExpanded) {
        const nextButton = nextBlock.querySelector('[data-journal-toggle]');
        if (!nextButton || previousToggleTop === null) return;
        const nextTop = nextButton.getBoundingClientRect().top;
        window.scrollBy({ top: nextTop - previousToggleTop, behavior: 'auto' });
      }
    });
    return;
  }

  if (isCalendarPanelToggle) {
    renderCalendarDayPanel();
    requestAnimationFrame(() => {
      const nextBlock = dom.calendarDayPanel?.querySelector(`[data-day-date="${isoDate}"]`);
      if (!nextBlock) return;
      if (wasExpanded) {
        const nextButton = nextBlock.querySelector('[data-journal-toggle]');
        if (!nextButton || previousToggleTop === null) return;
        const nextTop = nextButton.getBoundingClientRect().top;
        window.scrollBy({ top: nextTop - previousToggleTop, behavior: 'auto' });
      }
    });
    return;
  }

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
    await goHome({ push: false, restoreScroll: false, activeView: state.activeView });
    await ensureTimelineLoaded(state.bootstrap?.lastDate);
    if (requestId !== state.activeSearchRequest) return;
    if (state.activeView !== 'timeline') renderActiveBrowseView();
    requestAnimationFrame(() => {
      updateActiveFromScroll();
      syncScrollThumb();
    });
    syncRouteHistory();
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
    await goHome({ push: false, restoreScroll: false, activeView: state.activeView });
    if (requestId !== state.activeSearchRequest || state.searchQuery !== term) return;
    state.activeDate = state.searchResultDays[0]?.isoDate || null;
    if (state.activeView === 'timeline') setVisibleWindow(0, state.searchResultDays.length - 1);
    else renderActiveBrowseView();
  } else {
    await goHome({ push: false, restoreScroll: false, activeView: state.activeView });
    state.loadedDays = [];
    state.loadedStart = null;
    state.loadedEnd = null;
    renderActiveBrowseView();
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
  syncRouteHistory();
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
  state.explorerMode = 'default';
  dom.searchDetailView.classList.add('hidden');
  dom.entryDetailView?.classList.add('hidden');
  dom.explorerView.classList.add('hidden');
  dom.homeView.classList.toggle('hidden', !['home', 'timeline'].includes(state.activeView));
  dom.galleryView?.classList.toggle('hidden', state.activeView !== 'gallery');
  dom.calendarView?.classList.toggle('hidden', state.activeView !== 'calendar');
  dom.foldersView?.classList.toggle('hidden', state.activeView !== 'folders');
  dom.body.classList.remove('explorer-open');
  dom.yearCarouselShell?.classList.toggle('hidden', state.activeView !== 'home' || state.searchMode);
  dom.yearSection?.classList.toggle('hidden', state.searchUiOpen || state.searchMode || state.activeView !== 'home');
  dom.timelineSection?.classList.toggle('hidden', !state.searchMode && state.activeView !== 'timeline');
}

function removeGalleryDetailControls() {
  document.querySelectorAll('[data-gallery-detail]').forEach((button) => {
    button.closest('.gallery-filter-group')?.remove();
  });
}

function normalizeGalleryLayoutControls() {
  document.getElementById('galleryLayoutRatio')?.remove();
  if (dom.galleryLayoutToggle) {
    dom.galleryLayoutToggle.removeAttribute('data-gallery-layout');
    dom.galleryLayoutToggle.setAttribute('data-gallery-layout-toggle', '');
  }
}

function showSearchDetailView() {
  dom.searchDetailView.classList.remove('hidden');
  dom.entryDetailView?.classList.add('hidden');
  dom.homeView.classList.add('hidden');
  dom.explorerView.classList.add('hidden');
  dom.galleryView?.classList.add('hidden');
  dom.calendarView?.classList.add('hidden');
  dom.foldersView?.classList.add('hidden');
  dom.body.classList.add('explorer-open');
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function showEntryDetailView() {
  dom.entryDetailView?.classList.remove('hidden');
  dom.searchDetailView.classList.add('hidden');
  dom.homeView.classList.add('hidden');
  dom.explorerView.classList.add('hidden');
  dom.galleryView?.classList.add('hidden');
  dom.calendarView?.classList.add('hidden');
  dom.foldersView?.classList.add('hidden');
  dom.body.classList.add('explorer-open');
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function showExplorerView() {
  dom.explorerView.classList.remove('hidden');
  dom.searchDetailView.classList.add('hidden');
  dom.entryDetailView?.classList.add('hidden');
  dom.homeView.classList.add('hidden');
  dom.galleryView?.classList.add('hidden');
  dom.calendarView?.classList.add('hidden');
  dom.foldersView?.classList.add('hidden');
  dom.body.classList.add('explorer-open');
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function renderGalleryView({ force = false } = {}) {
  const entries = gallerySourceEntries();
  const total = entries.length;
  const indexedMediaTotal = entries.reduce((sum, entry) => sum + Number(entry.photoCount || 0), 0);
  dom.gallerySubtitle.textContent = state.searchMode
    ? `Showing ${indexedMediaTotal} matched media items`
    : `${indexedMediaTotal.toLocaleString()} media items across ${total.toLocaleString()} days.`;
  renderGalleryWindow({ force });
}

async function ensureGalleryWindowRendered() {
  const entries = gallerySourceEntries();
  renderGalleryView({ force: state.searchMode });
  updateActiveGalleryFromScroll();
  if (state.searchMode || !entries.length) return;
  await ensureGalleryRangeLoaded(entries, state.galleryLoadedStart ?? 0, state.galleryLoadedEnd ?? (entries.length - 1));
  updateActiveGalleryFromScroll();
}

function buildCalendarBrowserDayButton(entry, summary, activeMonthKey = state.calendarViewMonth) {
  const isSelected = entry.isoDate === state.calendarViewDate;
  const isToday = entry.isoDate === state.bootstrap?.today?.isoDate;
  const hasSummary = Boolean(summary);
  const searchHit = Boolean(state.searchMode && summary?.matchCount);
  const hasJournal = Boolean(summary?.hasJournal || summary?.journal);
  const media = calendarCellMedia(summary);
  const coverUrl = media?.thumbUrl || media?.previewUrl || '';
  const preview = hasSummary ? calendarJournalPreviewHtml(summary, { maxChars: 120, maxLines: 3 }) : '';
  const isOutsideMonth = activeMonthKey && monthKeyFromIso(entry.isoDate) !== activeMonthKey;
  return `
    <button
      class="calendar-day calendar-browser-day ${isSelected ? 'is-selected' : ''} ${isToday ? 'is-today' : ''} ${isOutsideMonth ? 'is-outside-month' : ''} ${hasSummary ? 'has-content' : ''} ${coverUrl ? 'has-cover' : ''} ${preview ? 'has-preview' : ''} ${searchHit ? 'is-search-hit' : ''}"
      type="button"
      data-calendar-browse-date="${entry.isoDate}"
      ${coverUrl ? `style="--calendar-cover:url('${escapeHtml(coverUrl)}')"` : ''}
    >
      <span class="calendar-day-shade" aria-hidden="true"></span>
      <span class="calendar-day-number-shell" aria-hidden="true">
        <span class="calendar-day-number">${escapeHtml(String(Number(entry.isoDate.slice(-2))))}</span>
      </span>
      ${preview}
      ${hasJournal ? `<span class="calendar-corner-icon calendar-note-icon" aria-hidden="true">${renderPhIcon('note', { variant: 'duotone' })}</span>` : ''}
      ${searchHit ? `<span class="calendar-corner-icon calendar-search-dot" aria-hidden="true">${renderPhIcon('star-four', { variant: 'fill' })}</span>` : ''}
    </button>
  `;
}

function updateCalendarViewChrome(monthKey, summaryMap = state.calendarSummaryMap || buildCalendarDaySummaryMap()) {
  if (!monthKey) return;
  state.calendarViewMonth = monthKey;
  if (dom.calendarViewMonthLabel) dom.calendarViewMonthLabel.textContent = monthLabelForIso(`${monthKey}-01`);
  const monthDays = buildCalendarMonthDays(monthKey)
    .filter((entry) => entry.inMonth)
    .map((entry) => summaryMap.get(entry.isoDate))
    .filter(Boolean);
  const monthMedia = monthDays.reduce((sum, day) => sum + Number(day.photoCount || 0), 0);
  const monthEntries = monthDays.filter((day) => day.journal || day.hasJournal).length;
  if (dom.calendarViewSubtitle) {
    dom.calendarViewSubtitle.textContent = state.searchMode
      ? `${monthDays.length} matching day${monthDays.length === 1 ? '' : 's'} in ${monthLabelForIso(`${monthKey}-01`)}`
      : `${monthEntries} entries / ${monthMedia} media in ${monthLabelForIso(`${monthKey}-01`)}`;
  }
}

function estimateCalendarCellHeight() {
  const width = Math.max(320, dom.calendarViewGrid?.clientWidth || dom.calendarViewGrid?.parentElement?.clientWidth || 700);
  const compact = window.innerWidth <= 640;
  const ratio = compact ? 0.9 : 0.82;
  const minHeight = compact ? 52 : 58;
  const cellWidth = width / 7;
  return Math.max(minHeight, Math.round(cellWidth * ratio));
}

function buildCalendarMonthMeta() {
  const monthKeys = [
    monthKeyFromIso(state.bootstrap?.firstDate || ''),
    monthKeyFromIso(state.bootstrap?.lastDate || ''),
    monthKeyFromIso(state.bootstrap?.today?.isoDate || ''),
    monthKeyFromIso(state.calendarViewDate || '')
  ].filter(Boolean).sort();
  const firstMonth = monthKeys[0] || monthKeyFromIso(fileDateToLocalIso(Date.now()));
  const lastMonth = monthKeys[monthKeys.length - 1] || firstMonth;
  const firstMonthStart = monthStartIso(firstMonth);
  const lastMonthEnd = `${lastMonth}-${String(daysInMonthKey(lastMonth)).padStart(2, '0')}`;
  const firstGridDate = isoToUtcDate(firstMonthStart);
  const lastGridDate = isoToUtcDate(lastMonthEnd);
  if (!firstGridDate || !lastGridDate) return [];

  firstGridDate.setUTCDate(firstGridDate.getUTCDate() - firstGridDate.getUTCDay());
  lastGridDate.setUTCDate(lastGridDate.getUTCDate() + (6 - lastGridDate.getUTCDay()));

  const weekRows = [];
  let weekStartIso = [
    firstGridDate.getUTCFullYear(),
    `${firstGridDate.getUTCMonth() + 1}`.padStart(2, '0'),
    `${firstGridDate.getUTCDate()}`.padStart(2, '0')
  ].join('-');
  const finalWeekIso = [
    lastGridDate.getUTCFullYear(),
    `${lastGridDate.getUTCMonth() + 1}`.padStart(2, '0'),
    `${lastGridDate.getUTCDate()}`.padStart(2, '0')
  ].join('-');

  while (weekStartIso && compareIsoDates(weekStartIso, finalWeekIso) <= 0) {
    weekRows.push({
      startIso: weekStartIso,
      days: Array.from({ length: 7 }, (_, offset) => {
        const isoDate = addDaysToIso(weekStartIso, offset);
        return { isoDate, inMonth: true };
      })
    });
    weekStartIso = addDaysToIso(weekStartIso, 7);
  }

  const months = [];
  let cursor = firstMonth;
  while (cursor) {
    const startRow = weekRows.findIndex((week) => week.days.some((day) => monthKeyFromIso(day.isoDate) === cursor));
    const nextMonth = addMonthsToMonthKey(cursor, 1);
    const nextStartRow = nextMonth ? weekRows.findIndex((week) => week.days.some((day) => monthKeyFromIso(day.isoDate) === nextMonth)) : -1;
    months.push({
      monthKey: cursor,
      startRow: Math.max(0, startRow),
      endRow: nextStartRow >= 0 ? nextStartRow : weekRows.length
    });
    if (cursor === lastMonth) break;
    if (!nextMonth || nextMonth === cursor) break;
    cursor = nextMonth;
  }

  state.calendarWeekRows = weekRows.map((week, index) => ({ ...week, rowIndex: index }));
  return months;
}

function findCalendarMonthMeta(monthKey) {
  return state.calendarMonthMeta.find((entry) => entry.monthKey === monthKey) || null;
}

function calendarWeekIndexForScrollOffset(offset = 0) {
  const weeks = state.calendarWeekRows || [];
  if (!weeks.length) return 0;
  const cellHeight = Math.max(1, state.calendarCellHeight || estimateCalendarCellHeight());
  return Math.min(weeks.length - 1, Math.max(0, Math.floor(offset / cellHeight)));
}

function monthKeyForCalendarWeekIndex(weekIndex = 0) {
  const weeks = state.calendarWeekRows || [];
  const week = weeks[Math.min(weeks.length - 1, Math.max(0, weekIndex))];
  if (!week) return '';
  const counts = new Map();
  week.days.forEach((day) => {
    const monthKey = monthKeyFromIso(day.isoDate);
    if (!monthKey) return;
    counts.set(monthKey, (counts.get(monthKey) || 0) + 1);
  });
  let bestMonthKey = '';
  let bestCount = -1;
  counts.forEach((count, monthKey) => {
    if (count > bestCount) {
      bestMonthKey = monthKey;
      bestCount = count;
    }
  });
  return bestMonthKey || monthKeyFromIso(week.days[0]?.isoDate || '');
}

function monthKeyForVisibleCalendarDays(scrollTop = 0, viewportHeight = 0) {
  const weeks = state.calendarWeekRows || [];
  if (!weeks.length) return '';
  const cellHeight = Math.max(1, state.calendarCellHeight || estimateCalendarCellHeight());
  const viewportTop = Math.max(0, Number(scrollTop) || 0);
  const viewportBottom = viewportTop + Math.max(cellHeight, Number(viewportHeight) || 0);
  const firstWeekIndex = Math.max(0, Math.floor(viewportTop / cellHeight));
  const lastWeekIndex = Math.min(weeks.length - 1, Math.floor(Math.max(viewportTop, viewportBottom - 1) / cellHeight));
  const scores = new Map();

  for (let weekIndex = firstWeekIndex; weekIndex <= lastWeekIndex; weekIndex += 1) {
    const week = weeks[weekIndex];
    if (!week) continue;
    const rowTop = weekIndex * cellHeight;
    const rowBottom = rowTop + cellHeight;
    const visibleHeight = Math.min(rowBottom, viewportBottom) - Math.max(rowTop, viewportTop);
    if (visibleHeight <= 0) continue;
    const visibleWeight = visibleHeight / cellHeight;
    week.days.forEach((day) => {
      const monthKey = monthKeyFromIso(day.isoDate);
      if (!monthKey) return;
      scores.set(monthKey, (scores.get(monthKey) || 0) + visibleWeight);
    });
  }

  let bestMonthKey = '';
  let bestScore = -1;
  scores.forEach((score, monthKey) => {
    if (score > bestScore) {
      bestMonthKey = monthKey;
      bestScore = score;
    }
  });
  return bestMonthKey || monthKeyForCalendarWeekIndex(firstWeekIndex);
}

function monthKeyForCalendarOffset(offset = 0) {
  return monthKeyForVisibleCalendarDays(offset, dom.calendarViewGrid?.clientHeight || 0);
}

function buildCalendarVirtualRange(scrollTop = 0) {
  const weeks = state.calendarWeekRows || [];
  const cellHeight = Math.max(1, state.calendarCellHeight || estimateCalendarCellHeight());
  const viewportHeight = Math.max(cellHeight * 6, dom.calendarViewGrid?.clientHeight || 0);
  const visibleRows = Math.max(1, Math.ceil(viewportHeight / cellHeight));
  const bufferRows = Math.max(6, visibleRows);
  const startWeekIndex = Math.max(0, Math.floor(scrollTop / cellHeight) - bufferRows);
  const endWeekIndex = Math.min(Math.max(0, weeks.length - 1), Math.max(startWeekIndex, Math.ceil((scrollTop + viewportHeight) / cellHeight) + bufferRows));
  return { startWeekIndex, endWeekIndex };
}

function buildCalendarWeekChunk(week, summaryMap, activeMonthKey) {
  return week.days.map((entry) => buildCalendarBrowserDayButton(entry, summaryMap.get(entry.isoDate), activeMonthKey)).join('');
}

function ensureCalendarGridShell() {
  if (!dom.calendarViewGrid) return null;
  let grid = dom.calendarViewGrid.querySelector('.calendar-grid.calendar-month-grid');
  if (!grid) {
    dom.calendarViewGrid.innerHTML = `
      <div class="calendar-grid calendar-month-grid" role="rowgroup">
        <div class="calendar-grid-spacer calendar-grid-spacer-top" aria-hidden="true"></div>
        <div class="calendar-grid-spacer calendar-grid-spacer-bottom" aria-hidden="true"></div>
      </div>
    `;
    grid = dom.calendarViewGrid.querySelector('.calendar-grid.calendar-month-grid');
  }
  if (!grid) return null;
  let topSpacer = grid.querySelector('.calendar-grid-spacer-top');
  let bottomSpacer = grid.querySelector('.calendar-grid-spacer-bottom');
  if (!topSpacer) {
    topSpacer = document.createElement('div');
    topSpacer.className = 'calendar-grid-spacer calendar-grid-spacer-top';
    topSpacer.setAttribute('aria-hidden', 'true');
    grid.prepend(topSpacer);
  }
  if (!bottomSpacer) {
    bottomSpacer = document.createElement('div');
    bottomSpacer.className = 'calendar-grid-spacer calendar-grid-spacer-bottom';
    bottomSpacer.setAttribute('aria-hidden', 'true');
    grid.append(bottomSpacer);
  }
  return { grid, topSpacer, bottomSpacer };
}

function createCalendarWeekNode(weekIndex, week, summaryMap, activeMonthKey) {
  const node = document.createElement('div');
  node.className = 'calendar-week-row';
  node.dataset.calendarWeekIndex = String(weekIndex);
  node.dataset.activeMonthKey = activeMonthKey || '';
  node.innerHTML = buildCalendarWeekChunk(week, summaryMap, activeMonthKey);
  return node;
}

function applyCalendarOutsideMonthState(node, activeMonthKey) {
  if (!node) return;
  node.dataset.activeMonthKey = activeMonthKey || '';
  node.querySelectorAll('[data-calendar-browse-date]').forEach((button) => {
    const isoDate = button.dataset.calendarBrowseDate || '';
    const isOutsideMonth = Boolean(activeMonthKey && monthKeyFromIso(isoDate) !== activeMonthKey);
    button.classList.toggle('is-outside-month', isOutsideMonth);
  });
}

function updateCalendarWeekNode(node, weekIndex, activeMonthKey) {
  if (!node) return;
  node.dataset.calendarWeekIndex = String(weekIndex);
  if (node.dataset.activeMonthKey !== (activeMonthKey || '')) {
    applyCalendarOutsideMonthState(node, activeMonthKey);
  }
}

function refreshRenderedCalendarMonthClasses(activeMonthKey) {
  state.calendarRenderedWeeks.forEach((node) => applyCalendarOutsideMonthState(node, activeMonthKey));
}

function reconcileCalendarRenderedWeeks(range, summaryMap, activeMonthKey, { force = false } = {}) {
  const weeks = state.calendarWeekRows || [];
  const shell = ensureCalendarGridShell();
  if (!shell) return false;
  const { grid, topSpacer, bottomSpacer } = shell;
  const previousStart = Number.isInteger(state.calendarRenderStart) ? state.calendarRenderStart : null;
  const previousEnd = Number.isInteger(state.calendarRenderEnd) ? state.calendarRenderEnd : null;
  const overlapsPrevious = previousStart !== null
    && previousEnd !== null
    && range.startWeekIndex <= previousEnd
    && range.endWeekIndex >= previousStart;
  const renderWeekNode = (weekIndex, insertBeforeNode = bottomSpacer) => {
    const week = weeks[weekIndex];
    if (!week) return false;
    let node = state.calendarRenderedWeeks.get(weekIndex);
    let created = false;
    if (!node) {
      node = createCalendarWeekNode(weekIndex, week, summaryMap, activeMonthKey);
      state.calendarRenderedWeeks.set(weekIndex, node);
      created = true;
    } else {
      updateCalendarWeekNode(node, weekIndex, activeMonthKey);
    }
    grid.insertBefore(node, insertBeforeNode);
    return created;
  };

  if (force || !overlapsPrevious) {
    state.calendarRenderedWeeks.forEach((node) => node.remove());
    state.calendarRenderedWeeks.clear();
    let addedRows = false;
    for (let weekIndex = range.startWeekIndex; weekIndex <= range.endWeekIndex; weekIndex += 1) {
      addedRows = renderWeekNode(weekIndex) || addedRows;
    }
    const topOffset = `${Math.max(0, range.startWeekIndex) * state.calendarCellHeight}px`;
    const bottomOffset = `${Math.max(0, weeks.length - range.endWeekIndex - 1) * state.calendarCellHeight}px`;
    topSpacer.style.height = '0px';
    bottomSpacer.style.height = '0px';
    topSpacer.style.display = 'none';
    bottomSpacer.style.display = 'none';
    grid.style.paddingTop = topOffset;
    grid.style.paddingBottom = bottomOffset;
    grid.style.gridAutoRows = `${state.calendarCellHeight}px`;
    return addedRows;
  }

  for (let weekIndex = previousStart; weekIndex < range.startWeekIndex; weekIndex += 1) {
    const node = state.calendarRenderedWeeks.get(weekIndex);
    if (node) {
      node.remove();
      state.calendarRenderedWeeks.delete(weekIndex);
    }
  }
  for (let weekIndex = range.endWeekIndex + 1; weekIndex <= previousEnd; weekIndex += 1) {
    const node = state.calendarRenderedWeeks.get(weekIndex);
    if (node) {
      node.remove();
      state.calendarRenderedWeeks.delete(weekIndex);
    }
  }

  let addedRows = false;
  const prependReferenceIndex = Math.max(range.startWeekIndex, previousStart);
  let prependReferenceNode = state.calendarRenderedWeeks.get(prependReferenceIndex) || bottomSpacer;
  for (let weekIndex = prependReferenceIndex - 1; weekIndex >= range.startWeekIndex; weekIndex -= 1) {
    addedRows = renderWeekNode(weekIndex, prependReferenceNode) || addedRows;
    prependReferenceNode = state.calendarRenderedWeeks.get(weekIndex) || prependReferenceNode;
  }
  for (let weekIndex = Math.max(range.startWeekIndex, previousStart); weekIndex <= Math.min(range.endWeekIndex, previousEnd); weekIndex += 1) {
    const node = state.calendarRenderedWeeks.get(weekIndex);
    if (node) updateCalendarWeekNode(node, weekIndex, activeMonthKey);
  }
  for (let weekIndex = Math.max(previousEnd + 1, range.startWeekIndex); weekIndex <= range.endWeekIndex; weekIndex += 1) {
    addedRows = renderWeekNode(weekIndex) || addedRows;
  }

  const topOffset = `${Math.max(0, range.startWeekIndex) * state.calendarCellHeight}px`;
  const bottomOffset = `${Math.max(0, weeks.length - range.endWeekIndex - 1) * state.calendarCellHeight}px`;
  topSpacer.style.height = '0px';
  bottomSpacer.style.height = '0px';
  topSpacer.style.display = 'none';
  bottomSpacer.style.display = 'none';
  grid.style.paddingTop = topOffset;
  grid.style.paddingBottom = bottomOffset;
  grid.style.gridAutoRows = `${state.calendarCellHeight}px`;
  return addedRows;
}

function renderCalendarWindow({ force = false, scrollTop = null } = {}) {
  if (!dom.calendarViewGrid || !state.calendarMonthMeta.length) return;
  const effectiveScrollTop = Number.isFinite(scrollTop) ? scrollTop : (dom.calendarViewGrid.scrollTop || 0);
  const range = buildCalendarVirtualRange(effectiveScrollTop);
  const summaryMap = state.calendarSummaryMap || buildCalendarDaySummaryMap();
  const activeMonthKey = monthKeyForVisibleCalendarDays(effectiveScrollTop, dom.calendarViewGrid.clientHeight || 0);
  updateCalendarViewChrome(activeMonthKey || state.calendarViewMonth, summaryMap);
  const targetMonthKey = activeMonthKey || state.calendarViewMonth || '';
  const sameRange = range.startWeekIndex === state.calendarRenderStart && range.endWeekIndex === state.calendarRenderEnd;
  const sameMonth = targetMonthKey === state.calendarRenderMonthKey;
  if (!force && sameRange && sameMonth) return;

  const addedRows = reconcileCalendarRenderedWeeks(range, summaryMap, targetMonthKey, { force });
  if (!sameMonth) {
    refreshRenderedCalendarMonthClasses(targetMonthKey);
  }

  state.calendarRenderStart = range.startWeekIndex;
  state.calendarRenderEnd = range.endWeekIndex;
  state.calendarRenderMonthKey = targetMonthKey;
  if (addedRows || force) {
    setupMediaObserver();
  }
}

function clearCalendarWindow() {
  state.calendarRenderedWeeks.forEach((node) => node.remove());
  state.calendarRenderedWeeks.clear();
  if (dom.calendarViewGrid) {
    dom.calendarViewGrid.innerHTML = '';
  }
  state.calendarRenderStart = null;
  state.calendarRenderEnd = null;
  state.calendarRenderMonthKey = '';
}

function scrollCalendarMonthIntoView(monthKey, behavior = 'auto') {
  if (!dom.calendarViewGrid) return;
  const meta = findCalendarMonthMeta(monthKey);
  if (!meta) return;
  dom.calendarViewGrid.scrollTo({ top: calendarMonthScrollTop(monthKey), behavior });
}

function calendarMonthScrollTop(monthKey) {
  const meta = findCalendarMonthMeta(monthKey);
  if (!meta) return 0;
  return Math.max(0, meta.startRow * Math.max(1, state.calendarCellHeight || estimateCalendarCellHeight()));
}

function syncCalendarMonthFromGridScroll() {
  const previousMonthKey = state.calendarViewMonth;
  const monthKey = monthKeyForCalendarOffset(dom.calendarViewGrid?.scrollTop || 0);
  renderCalendarWindow();
  if (!monthKey || monthKey === previousMonthKey) return;
  syncRouteHistory();
}

function scrollCalendarDayPanelIntoView() {
  const panel = dom.calendarDayPanel;
  if (!panel) return;
  const hero = panel.querySelector('.calendar-panel-hero');
  const anchor = hero || panel.querySelector('.calendar-panel-card') || panel;
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const heroOffset = hero ? (hero.getBoundingClientRect().height * 0.5) : 0;
  const top = window.scrollY + rect.top - topOffset() + heroOffset;
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

function renderCalendarDayPanel() {
  if (!dom.calendarDayPanel) return;
  const day = getCalendarSourceDay(state.calendarViewDate);
  if (!state.calendarViewDate) {
    dom.calendarDayPanel.innerHTML = '<div class="empty-state"><h2>Select a day</h2><p>Inspect journal and media activity from the calendar.</p></div>';
    return;
  }
  if (!day) {
    dom.calendarDayPanel.innerHTML = `
      <div class="calendar-panel-card">
        <h3>${escapeHtml(longDateLabel(state.calendarViewDate) || state.calendarViewDate)}</h3>
        <p>No indexed entry or media for this day.</p>
        <div class="calendar-panel-actions">
          <a class="ghost-button" href="/edit/${state.calendarViewDate}?create=1">Create entry</a>
        </div>
      </div>
    `;
    return;
  }
  hydrateCalendarDay(state.calendarViewDate);
  dom.calendarDayPanel.innerHTML = `
    <div class="calendar-day-block-shell">
      ${buildDayHtml(day)}
      <div class="calendar-panel-actions">
        <button class="ghost-button" type="button" data-calendar-open-day="${day.isoDate}">Open in timeline</button>
      </div>
    </div>
  `;
  setupMediaObserver();
}

function renderCalendarView({ preserveGridScroll = null, alignMonth = null } = {}) {
  const todayIso = state.bootstrap?.today?.isoDate || '';
  const monthKey = state.calendarViewMonth || monthKeyFromIso(state.calendarViewDate || state.activeDate || todayIso || state.bootstrap?.lastDate || '') || monthKeyFromIso(todayIso || state.bootstrap?.lastDate || '');
  const hadRenderedMonths = Boolean(dom.calendarViewGrid?.children?.length);
  const keepScroll = preserveGridScroll ?? hadRenderedMonths;
  const shouldAlignMonth = alignMonth ?? !hadRenderedMonths;
  const previousScrollTop = dom.calendarViewGrid?.scrollTop || 0;
  state.calendarMonthMeta = buildCalendarMonthMeta();
  state.calendarSummaryMap = buildCalendarDaySummaryMap();
  state.calendarCellHeight = estimateCalendarCellHeight();
  const targetScrollTop = shouldAlignMonth ? calendarMonthScrollTop(monthKey) : (keepScroll ? previousScrollTop : 0);
  clearCalendarWindow();
  if (shouldAlignMonth) {
    state.calendarViewMonth = monthKey;
  }
  if (dom.calendarViewGrid && (shouldAlignMonth || keepScroll)) {
    dom.calendarViewGrid.scrollTop = targetScrollTop;
  }
  renderCalendarWindow({ force: true, scrollTop: targetScrollTop });
  renderCalendarDayPanel();
  requestAnimationFrame(() => {
    if (!dom.calendarViewGrid) return;
    if (shouldAlignMonth || keepScroll) dom.calendarViewGrid.scrollTop = targetScrollTop;
    renderCalendarWindow();
  });
}

function renderFolderTreeForBrowser() {
  if (!dom.foldersTree) return;
  const renderNode = (node, rootId, depth = 0) => {
    const nodePath = node.relativePath || '.';
    const selected = state.folderViewSelection.rootId === rootId && state.folderViewSelection.relativePath === nodePath;
    return `
      <button class="folder-browser-node ${selected ? 'is-selected' : ''}" type="button" data-folder-root="${rootId}" data-folder-path="${escapeHtml(nodePath)}" style="--folder-depth:${depth}">
        <span class="folder-browser-node-icon" aria-hidden="true">${renderPhIcon(node.icon || 'folder-open', { variant: 'duotone' })}</span>
        <span class="folder-browser-node-copy">
          <strong>${escapeHtml(node.displayPath === '.' ? '(root)' : node.label)}</strong>
          <span>${formatCountLabel(node.mediaCount || 0, 'item')}</span>
        </span>
      </button>
      ${(node.children || []).map((child) => renderNode(child, rootId, depth + 1)).join('')}
    `;
  };
  dom.foldersTree.innerHTML = (state.folderRoots || []).map((root) => `
    <section class="folder-browser-root">
      <h3>
        <span>${escapeHtml(root.rootLabel)}</span>
        <small>${formatCountLabel(root.tree?.mediaCount || 0, 'item')}</small>
      </h3>
      ${renderNode(root.tree, root.rootId, 0)}
    </section>
  `).join('');
}

function getSearchFolderBuckets() {
  const buckets = new Map();
  for (const day of state.searchResultDays) {
    for (const item of (day.matchedMedia || [])) {
      const key = `${item.folderRootId || '0'}::${item.folder || '.'}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          rootId: item.folderRootId || '0',
          relativePath: item.folder || '.',
          label: `${item.folderRootLabel || 'Photos'}${item.folder && item.folder !== '.' ? ` / ${item.folder}` : ''}`,
          media: []
        });
      }
      buckets.get(key).media.push(item);
    }
  }
  return [...buckets.values()].sort((a, b) => b.media.length - a.media.length || a.label.localeCompare(b.label));
}

function getFolderParentPath(relativePath = '.') {
  const normalized = String(relativePath || '.').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized === '.') return '.';
  const parts = normalized.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? parts.join('/') : '.';
}

function isFolderRootOverviewSelected() {
  return state.folderViewSelection?.rootId === '__roots__';
}

function folderBrowseSubtitle(browse) {
  if (!browse) return 'Browse like a file explorer, with journal context attached.';
  const pathLabel = browse.relativePath && browse.relativePath !== '.'
    ? browse.relativePath
    : `${browse.rootLabel} root`;
  return `${pathLabel} · ${formatCountLabel((browse.media || []).length, 'item')} here now`;
}

function buildFolderBrowseCard(folder, rootId) {
  const cover = folder.cover;
  const src = cover?.thumbUrl || '';
  const coverClasses = `folder-card-media${src ? ' lazy-media lazy-media-bg' : ' is-empty'}`;
  return `
    <button class="folder-card folder-browser-card" type="button" data-folder-root="${rootId}" data-folder-path="${escapeHtml(folder.relativePath || '.')}" data-open-folder="${escapeHtml(folder.relativePath || '.')}">
      <div class="${coverClasses}" ${src ? `data-src="${src}"` : ''}>
        ${src ? '<div class="media-skeleton"></div>' : `<span class="folder-card-icon" aria-hidden="true">${renderPhIcon('folder-open', { variant: 'duotone' })}</span>`}
      </div>
      <div class="folder-card-copy">
        <strong>${escapeHtml(folder.label)}</strong>
        <span>${formatCountLabel(folder.mediaCount || 0, 'item')}</span>
      </div>
    </button>
  `;
}

const FOLDER_VIEW_MODES = [
  { value: 'list', label: 'List', icon: 'list-bullets' },
  { value: 'hybrid', label: 'Hybrid', icon: 'rows' },
  { value: 'grid', label: 'Grid', icon: 'squares-four' }
];

function setFolderViewMode(mode) {
  const next = mode === 'small-grid' || mode === 'large-grid'
    ? 'grid'
    : (['list', 'hybrid', 'grid'].includes(mode) ? mode : 'hybrid');
  state.folderViewMode = next;
  localStorage.setItem(FOLDER_VIEW_MODE_STORAGE_KEY, next);
  renderFoldersView();
}

function buildFolderViewControls() {
  return FOLDER_VIEW_MODES.map((mode) => `
    <button class="folder-view-mode-button ${state.folderViewMode === mode.value ? 'is-active' : ''}" type="button" data-folder-view-mode="${mode.value}" aria-pressed="${state.folderViewMode === mode.value ? 'true' : 'false'}" title="${escapeHtml(mode.label)}">
      ${renderPhIcon(mode.icon, { variant: 'duotone' })}
      <span>${escapeHtml(mode.label)}</span>
    </button>
  `).join('');
}

function syncFolderViewControls() {
  if (dom.folderViewControls) dom.folderViewControls.innerHTML = buildFolderViewControls();
}

function buildFolderMediaListItem(item) {
  const previewSrc = item.type === 'video' ? (item.previewUrl || item.thumbUrl) : item.thumbUrl;
  const mediaMeta = item.size ? formatFileSize(item.size) : (item.ext ? String(item.ext).replace(/^\./, '').toUpperCase() : formatCountLabel(1, item.type === 'video' ? 'video' : 'item'));
  const previewClasses = item.type === 'video'
    ? 'folder-file-preview'
    : `folder-file-preview ${previewSrc ? 'lazy-media lazy-media-bg' : 'is-empty'}`;
  const previewAttrs = item.type !== 'video' && previewSrc ? `data-src="${previewSrc}"` : '';
  const previewBody = item.type === 'video' && previewSrc
    ? `<video class="lazy-media" data-src="${previewSrc}" muted autoplay loop playsinline preload="none" poster="${escapeHtml(item.thumbUrl || '')}" aria-hidden="true"></video><div class="media-skeleton"></div>`
    : (previewSrc ? '<div class="media-skeleton"></div>' : `<span class="folder-file-icon" aria-hidden="true">${renderPhIcon('file-image', { variant: 'duotone' })}</span>`);
  const badge = item.type === 'video'
    ? `<span class="folder-file-badge" aria-hidden="true">${renderPhIcon('video-camera', { variant: 'fill' })}</span>`
    : '';
  return `
    <button class="folder-file-item is-media open-media" type="button" data-media-id="${item.id}">
      <div class="${previewClasses}" ${previewAttrs}>
        ${previewBody}
        ${badge}
      </div>
      <div class="folder-file-copy">
        <strong>${escapeHtml(item.fileName || 'Untitled')}</strong>
        <span class="folder-file-count">${escapeHtml(mediaMeta)}</span>
      </div>
    </button>
  `;
}

function buildFolderNodeListItem(folder, rootId) {
  return `
    <button class="folder-file-item is-folder" type="button" data-folder-root="${rootId}" data-folder-path="${escapeHtml(folder.relativePath || '.')}" data-open-folder="${escapeHtml(folder.relativePath || '.')}">
      <div class="folder-file-icon-shell" aria-hidden="true">
        <span class="folder-file-icon" aria-hidden="true">${renderPhIcon('folder-open', { variant: 'duotone' })}</span>
      </div>
      <div class="folder-file-copy">
        <strong>${escapeHtml(folder.label)}</strong>
        <span class="folder-file-count">${formatCountLabel(folder.mediaCount || 0, 'item')}</span>
      </div>
    </button>
  `;
}

function buildFolderRootListItem(root) {
  return `
    <button class="folder-file-item is-folder is-root" type="button" data-folder-root="${escapeHtml(root.rootId || '0')}" data-folder-path=".">
      <div class="folder-file-icon-shell" aria-hidden="true">
        <span class="folder-file-icon" aria-hidden="true">${renderPhIcon('hard-drives', { variant: 'duotone' })}</span>
      </div>
      <div class="folder-file-copy">
        <strong>${escapeHtml(root.rootLabel || 'Root')}</strong>
        <span class="folder-file-count">${formatCountLabel(root.tree?.mediaCount || 0, 'item')}</span>
      </div>
    </button>
  `;
}

function sortFolderListingItems(items) {
  return items.sort((a, b) => {
    const order = { root: 0, folder: 1, media: 2 };
    if (a.kind !== b.kind) return (order[a.kind] ?? 99) - (order[b.kind] ?? 99);
    return a.sortKey.localeCompare(b.sortKey);
  });
}

function buildUnifiedFolderListing({ rootId = '0', roots = [], folders = [], media = [], title = 'Contents', emptyMessage = 'Nothing in this folder yet.' } = {}) {
  const folderItems = sortFolderListingItems([
    ...roots.map((root) => ({ kind: 'root', sortKey: String(root.rootLabel || '').toLowerCase(), html: buildFolderRootListItem(root) })),
    ...folders.map((folder) => ({ kind: 'folder', sortKey: folder.label?.toLowerCase() || '', html: buildFolderNodeListItem(folder, rootId) }))
  ]);
  const mediaItems = sortFolderListingItems(
    media.map((item) => ({ kind: 'media', sortKey: String(item.fileName || '').toLowerCase(), html: buildFolderMediaListItem(item) }))
  );
  const items = sortFolderListingItems([...folderItems, ...mediaItems]);
  if (!items.length) return `<p class="folder-panel-empty">${escapeHtml(emptyMessage)}</p>`;
  const body = state.folderViewMode === 'hybrid'
    ? `
      ${folderItems.length ? `<div class="folder-file-list" data-folder-view="list" data-folder-kind="folders">${folderItems.map((item) => item.html).join('')}</div>` : ''}
      ${mediaItems.length ? `<div class="folder-file-list" data-folder-view="grid" data-folder-kind="media">${mediaItems.map((item) => item.html).join('')}</div>` : ''}
    `
    : `<div class="folder-file-list" data-folder-view="${escapeHtml(state.folderViewMode)}">${items.map((item) => item.html).join('')}</div>`;
  return `
    <section class="folder-section">
      <div class="folder-section-head">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>${formatCountLabel(folders.length, 'folder')} · ${formatCountLabel(media.length, 'media item')}</p>
        </div>
      </div>
      ${body}
    </section>
  `;
}

function buildSimpleFolderListing({ rootId = '0', roots = [], folders = [], media = [], title = 'Files', emptyMessage = 'Nothing in this folder yet.' } = {}) {
  const folderItems = sortFolderListingItems([
    ...roots.map((root) => ({ kind: 'root', sortKey: String(root.rootLabel || '').toLowerCase(), html: buildFolderRootListItem(root) })),
    ...folders.map((folder) => ({ kind: 'folder', sortKey: folder.label?.toLowerCase() || '', html: buildFolderNodeListItem(folder, rootId) }))
  ]);
  const mediaItems = sortFolderListingItems(
    media.map((item) => ({ kind: 'media', sortKey: String(item.fileName || '').toLowerCase(), html: buildFolderMediaListItem(item) }))
  );
  const items = sortFolderListingItems([...folderItems, ...mediaItems]);
  if (!items.length) return `<p class="folder-panel-empty">${escapeHtml(emptyMessage)}</p>`;
  const body = state.folderViewMode === 'hybrid'
    ? `
      ${folderItems.length ? `<div class="folder-file-list" data-folder-view="list" data-folder-kind="folders">${folderItems.map((item) => item.html).join('')}</div>` : ''}
      ${mediaItems.length ? `<div class="folder-file-list" data-folder-view="grid" data-folder-kind="media">${mediaItems.map((item) => item.html).join('')}</div>` : ''}
    `
    : `<div class="folder-file-list" data-folder-view="${escapeHtml(state.folderViewMode)}">${items.map((item) => item.html).join('')}</div>`;
  return `
    <section class="folder-section folder-section-simple">
      <div class="folder-section-head">
        <h3>${escapeHtml(title)}</h3>
      </div>
      ${body}
    </section>
  `;
}

function buildFolderBreadcrumbsHtmlForBrowse(browse) {
  if (!browse) {
    return '<button class="breadcrumb-button" type="button" data-folder-root="__roots__" data-folder-path=".">Root</button>';
  }
  const items = [
    '<button class="breadcrumb-button" type="button" data-folder-root="__roots__" data-folder-path=".">Root</button>',
    `<button class="breadcrumb-button" type="button" data-folder-root="${browse.rootId}" data-folder-path=".">${escapeHtml(browse.rootLabel)}</button>`
  ];
  if (browse.relativePath && browse.relativePath !== '.') {
    items.push(
      ...(browse.breadcrumbs || [])
        .filter((crumb) => (crumb.relativePath || '.') !== '.')
        .map((crumb) => `<button class="breadcrumb-button" type="button" data-folder-root="${browse.rootId}" data-folder-path="${escapeHtml(crumb.relativePath || '.')}">${escapeHtml(crumb.label)}</button>`)
    );
  }
  return items.join('<span class="breadcrumb-sep">/</span>');
}

function renderFoldersViewSimple() {
  renderFolderTreeForBrowser();
  syncFolderViewControls();
  if (state.searchMode) {
    const buckets = getSearchFolderBuckets();
    const selectedKey = `${state.folderViewSelection.rootId || '0'}::${state.folderViewSelection.relativePath || '.'}`;
    const selected = buckets.find((bucket) => bucket.key === selectedKey) || buckets[0] || null;
    if (selected) {
      state.folderViewSelection = { rootId: selected.rootId, relativePath: selected.relativePath };
    }
    if (dom.foldersSubtitle) {
      dom.foldersSubtitle.textContent = selected
        ? `${selected.label} · ${formatCountLabel(selected.media.length, 'match')}`
        : 'Browse like a file explorer.';
    }
    dom.folderBreadcrumbs.innerHTML = selected
      ? `<button class="breadcrumb-button" type="button" data-folder-root="__roots__" data-folder-path=".">Root</button><span class="breadcrumb-sep">/</span><span class="breadcrumb-current">${escapeHtml(selected.label)}</span>`
      : '<button class="breadcrumb-button" type="button" data-folder-root="__roots__" data-folder-path=".">Root</button>';
    dom.folderWorkspace.innerHTML = selected
      ? buildSimpleFolderListing({ rootId: selected.rootId, media: selected.media, title: 'Matches', emptyMessage: 'No matching media.' })
      : '<div class="empty-state"><h2>No folders matched</h2><p>Try a broader query or clear a folder filter.</p></div>';
    rebuildViewerSequence();
    setupMediaObserver();
    return;
  }

  if (isFolderRootOverviewSelected()) {
    if (dom.foldersSubtitle) dom.foldersSubtitle.textContent = `${formatCountLabel(state.folderRoots.length, 'root')} available`;
    dom.folderBreadcrumbs.innerHTML = '<span class="breadcrumb-current">Root</span>';
    dom.folderWorkspace.innerHTML = buildSimpleFolderListing({
      roots: state.folderRoots || [],
      title: 'Roots',
      emptyMessage: 'No media roots configured.'
    });
    return;
  }

  const browse = state.folderBrowse;
  if (!browse) {
    if (dom.foldersSubtitle) dom.foldersSubtitle.textContent = 'Browse like a file explorer.';
    dom.folderBreadcrumbs.innerHTML = '<button class="breadcrumb-button" type="button" data-folder-root="__roots__" data-folder-path=".">Root</button>';
    dom.folderWorkspace.innerHTML = state.folderReadyError
      ? `<p class="folder-panel-empty">${escapeHtml(state.folderReadyError)}</p>`
      : '<p class="folder-panel-empty">Loading folder browser...</p>';
    return;
  }

  if (dom.foldersSubtitle) dom.foldersSubtitle.textContent = folderBrowseSubtitle(browse);
  dom.folderBreadcrumbs.innerHTML = buildFolderBreadcrumbsHtmlForBrowse(browse);
  dom.folderWorkspace.innerHTML = buildSimpleFolderListing({
    rootId: browse.rootId,
    folders: browse.folders || [],
    media: browse.media || [],
    title: browse.relativePath && browse.relativePath !== '.' ? 'Files' : 'Root contents',
    emptyMessage: 'No direct media files or subfolders in this folder.'
  });
  rebuildViewerSequence();
  setupMediaObserver();
}

function renderFoldersView() {
  return renderFoldersViewSimple();
  renderFolderTreeForBrowser();
  if (state.searchMode) {
    const buckets = getSearchFolderBuckets();
    const selectedKey = `${state.folderViewSelection.rootId || '0'}::${state.folderViewSelection.relativePath || '.'}`;
    const selected = buckets.find((bucket) => bucket.key === selectedKey) || buckets[0] || null;
    if (selected) {
      state.folderViewSelection = { rootId: selected.rootId, relativePath: selected.relativePath };
    }
    if (dom.foldersSubtitle) {
      dom.foldersSubtitle.textContent = selected
        ? `${selected.label} · ${formatCountLabel(selected.media.length, 'match')}`
        : 'Browse like a file explorer, with journal context attached.';
    }
    dom.folderBreadcrumbs.innerHTML = selected ? `<span>${escapeHtml(selected.label)}</span>` : '';
    dom.folderSummary.innerHTML = selected ? `<p>${selected.media.length} matching media item${selected.media.length === 1 ? '' : 's'}</p>` : '<p>No folder matches.</p>';
    dom.folderListing.innerHTML = selected
      ? buildUnifiedFolderListing({ rootId: selected.rootId, folders: [], media: selected.media, emptyMessage: 'No matching media.' })
      : '<div class="empty-state"><h2>No folders matched</h2><p>Try a broader query or clear a folder filter.</p></div>';
    rebuildViewerSequence();
    setupMediaObserver();
    return;
  }
  const browse = state.folderBrowse;
  if (!browse) {
    if (dom.foldersSubtitle) dom.foldersSubtitle.textContent = 'Browse like a file explorer, with journal context attached.';
    dom.folderBreadcrumbs.innerHTML = '';
    dom.folderSummary.innerHTML = '<p>Loading folder browser…</p>';
    dom.folderListing.innerHTML = '';
    return;
  }
  if (dom.foldersSubtitle) dom.foldersSubtitle.textContent = folderBrowseSubtitle(browse);
  dom.folderBreadcrumbs.innerHTML = (browse.breadcrumbs || []).map((crumb) => `<button class="breadcrumb-button" type="button" data-folder-root="${browse.rootId}" data-folder-path="${escapeHtml(crumb.relativePath || '.')}">${escapeHtml(crumb.label)}</button>`).join('<span class="breadcrumb-sep">/</span>');
  const parentPath = getFolderParentPath(browse.relativePath || '.');
  const canGoUp = (browse.relativePath || '.') !== '.';
  dom.folderSummary.innerHTML = `
    <div class="folder-summary-shell">
      <div class="folder-summary-copy">
        <span class="folder-summary-kicker">${escapeHtml(browse.rootLabel)}</span>
        <h3>${escapeHtml((browse.breadcrumbs || []).slice(-1)[0]?.label || browse.rootLabel)}</h3>
        <p>${canGoUp ? `Inside ${escapeHtml(browse.relativePath)}` : 'Top level of this media root.'}</p>
      </div>
      <div class="folder-summary-stats" aria-label="Folder stats">
        <span>${formatCountLabel((browse.folders || []).length, 'folder')}</span>
        <span>${formatCountLabel((browse.media || []).length, 'media item')}</span>
      </div>
      ${canGoUp ? `<button class="folder-up-button" type="button" data-folder-root="${browse.rootId}" data-folder-path="${escapeHtml(parentPath)}">${renderPhIcon('arrow-up', { variant: 'bold' })}<span>Up one level</span></button>` : ''}
    </div>
  `;
  dom.folderListing.innerHTML = `
    ${buildUnifiedFolderListing({
      rootId: browse.rootId,
      folders: browse.folders || [],
      media: browse.media || [],
      emptyMessage: 'No direct media files or subfolders in this folder.'
    })}
  `;
  rebuildViewerSequence();
  setupMediaObserver();
}

function renderActiveBrowseView() {
  showHomeView();
  if (state.activeView === 'home' && !state.searchMode) {
    renderYearCarousel();
    renderDefaultYearSubtitle();
    return;
  }
  if (state.activeView === 'gallery') {
    void ensureGalleryWindowRendered().catch(console.error);
    return;
  }
  if (state.activeView === 'calendar') {
    renderCalendarView();
    return;
  }
  if (state.activeView === 'folders') {
    renderFoldersView();
    return;
  }
  renderTimeline();
}

function getSearchDayByDate(isoDate) {
  const localIndex = state.searchResultIndexByDate[isoDate];
  return localIndex === undefined ? null : state.searchResultDays[localIndex];
}

function getSearchDetailHits() {
  return Array.from(dom.searchDetailBody?.querySelectorAll('.search-hit') || []);
}

function focusSearchDetailResultLegacyInitial(index = state.searchDetailResultIndex) {
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

function buildSearchDetailBodyLegacyInitial(day) {
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

function renderSearchDetailLegacyInitial() {
  const day = getSearchDayByDate(state.searchDetailDate);
  const targets = getSearchDetailTargets(day);
  dom.searchDetailTitle.textContent = day?.dateLabel || 'Search result';
  dom.searchDetailSubtitle.textContent = `${searchMatchLabel(day || { matchCount: 0 })}${targets.length ? ` • result ${Math.min(state.searchDetailResultIndex + 1, targets.length)} of ${targets.length}` : ''}`;
  dom.searchDetailBody.innerHTML = buildSearchDetailBody(day);
  dom.searchDetailPrevResult.disabled = targets.length <= 1 || state.searchDetailResultIndex <= 0;
  dom.searchDetailNextResult.disabled = targets.length <= 1 || state.searchDetailResultIndex >= Math.max(0, targets.length - 1);
  focusSearchDetailResult(state.searchDetailResultIndex);
}

function openSearchDetailLegacyInitial(isoDate, { push = true, resultIndex = 0 } = {}) {
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

function buildSearchDetailBodyLegacyMid(day) {
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

function focusSearchDetailResultLegacyMid(index = state.searchDetailResultIndex) {
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

function renderSearchDetailLegacyMid() {
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

function buildRouteUrl(route = {}) {
  const url = new URL(window.location.href);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  const activeView = route.activeView || state.activeView || 'home';
  const isEntryDetail = route.view === 'entry-detail' && route.entryDate;
  if (isEntryDetail) url.pathname = `/entry/${route.entryDate}`;
  if (!isEntryDetail && activeView !== 'home') url.searchParams.set('view', activeView);
  if (!isEntryDetail && (route.searchQuery || state.searchQuery)) url.searchParams.set('q', route.searchQuery || state.searchQuery);
  if (!isEntryDetail && activeView === 'calendar' && (route.calendarDate || state.calendarViewDate)) {
    url.searchParams.set('date', route.calendarDate || state.calendarViewDate);
  }
  if (!isEntryDetail && activeView === 'folders') {
    const rootId = route.folderRootId || state.folderViewSelection.rootId || '0';
    const folderPath = route.folderPath || state.folderViewSelection.relativePath || '.';
    url.searchParams.set('root', rootId);
    if (folderPath && folderPath !== '.') url.searchParams.set('folder', folderPath);
  }
  if (isEntryDetail) {
    url.hash = '';
  } else if (route.view === 'search-detail' && route.entryDate) {
    url.hash = `#search-${route.entryDate}`;
  } else if (route.view === 'month' && route.monthKey) {
    url.hash = `#month-${route.monthKey}`;
  } else if (route.view === 'year' && route.year) {
    url.hash = `#year-${route.year}`;
  } else if (route.focusDate) {
    url.hash = `#day-${route.focusDate}`;
  }
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
}

function pushAppHistory(nextState, { replace = false } = {}) {
  const payload = { ...nextState, activeView: nextState.activeView || state.activeView };
  const url = buildRouteUrl(payload);
  if (replace) history.replaceState(payload, '', url);
  else history.pushState(payload, '', url);
}

function syncRouteHistory({ replace = true } = {}) {
  const base = history.state?.viewer ? { ...history.state } : { ...(history.state || {}), ...(state.route || {}) };
  base.activeView = state.activeView;
  base.searchQuery = state.searchQuery || '';
  base.folderRootId = state.folderViewSelection?.rootId || '0';
  base.folderPath = state.folderViewSelection?.relativePath || '.';
  base.calendarDate = state.calendarViewDate || '';
  pushAppHistory(base, { replace });
}

function preserveCurrentHomeScrollRoute() {
  if (state.route.view !== 'home') return;
  const scrollY = window.scrollY;
  state.homeScrollY = scrollY;
  state.route = { ...state.route, scrollY, activeView: state.activeView, searchQuery: state.searchQuery };
  const current = { ...(history.state || {}), ...state.route };
  history.replaceState(current, '', buildRouteUrl(current));
}

function isCurrentFolderRoute(rootId, relativePath) {
  const nextRoot = String(rootId || '0');
  const nextPath = String(relativePath || '.');
  return state.folderViewSelection?.rootId === nextRoot
    && state.folderViewSelection?.relativePath === nextPath;
}

function syncFolderNavigationHistory(previousSelection = null) {
  const changed = !previousSelection
    || previousSelection.rootId !== state.folderViewSelection?.rootId
    || previousSelection.relativePath !== state.folderViewSelection?.relativePath;
  syncRouteHistory({ replace: !changed });
}

function closeSearchDetail({ restoreScroll = true } = {}) {
  showHomeView();
  state.route = { view: 'home', scrollY: state.searchResultsScrollY || 0, activeView: state.activeView };
  syncTopbarSearchState();
  if (!restoreScroll) return;
  window.scrollTo({ top: state.searchResultsScrollY || 0, behavior: 'auto' });
  requestAnimationFrame(() => {
    updateActiveFromScroll();
    syncScrollThumb();
  });
}

async function openHomeLanding({ push = true } = {}) {
  state.homeScrollY = 0;
  await goHome({ push, restoreScroll: false, scrollY: 0, activeView: 'home' });
  renderActiveBrowseView();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function openSearchDetail(isoDate, { push = true, resultIndex = 0 } = {}) {
  const day = getSearchDayByDate(isoDate);
  if (!day) return;
  if (state.route.view !== 'search-detail') state.searchResultsScrollY = window.scrollY;
  state.searchDetailDate = isoDate;
  state.searchDetailResultIndex = resultIndex;
  state.route = { view: 'search-detail', entryDate: isoDate, resultIndex, scrollY: state.searchResultsScrollY, activeView: state.activeView, searchQuery: state.searchQuery };
  renderSearchDetail();
  showSearchDetailView();
  syncTopbarSearchState();
  if (push) pushAppHistory(state.route);
}

async function openEntryDetail(isoDate, { push = true } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) return;
  if (state.route.view === 'home') preserveCurrentHomeScrollRoute();
  state.entryDetailDate = isoDate;
  state.entryDetailDay = null;
  state.activeDate = isoDate;
  state.route = { view: 'entry-detail', entryDate: isoDate, scrollY: state.homeScrollY || 0, activeView: state.activeView, searchQuery: state.searchQuery };
  showEntryDetailView();
  if (dom.entryDetailBody) {
    dom.entryDetailBody.innerHTML = `<div class="empty-state"><h2>Loading ${escapeHtml(dateRailLabel(isoDate) || isoDate)}</h2><p>Preparing this entry.</p></div>`;
  }
  updateTopbarDateLabel();
  if (push) pushAppHistory(state.route);
  try {
    state.entryDetailDay = await loadEntryDetailDay(isoDate);
    renderEntryDetail();
  } catch (error) {
    console.error(error);
    state.entryDetailDay = null;
    renderEntryDetail(null);
  }
  updateTopbarDateLabel();
}

async function openYearView(year, { push = true } = {}) {
  state.explorerMode = 'default';
  state.homeScrollY = window.scrollY;
  const payload = await getYearData(year);
  dom.explorerTitle.textContent = `${payload.year}`;
  dom.explorerSubtitle.textContent = 'Choose a month';
  dom.explorerGrid.className = 'explorer-grid months-grid';
  dom.explorerGrid.innerHTML = payload.months.map(monthCardHtml).join('');
  showExplorerView();
  state.route = { view: 'year', year, homeScrollY: state.homeScrollY, activeView: state.activeView };
  if (push) pushAppHistory(state.route);
}

async function openMonthView(monthKey, year, { push = true } = {}) {
  state.explorerMode = 'default';
  state.homeScrollY = window.scrollY;
  const payload = await getMonthData(monthKey);
  dom.explorerTitle.textContent = payload.label;
  dom.explorerSubtitle.textContent = 'Choose a day';
  dom.explorerGrid.className = 'explorer-grid days-grid';
  dom.explorerGrid.innerHTML = payload.days.map((day) => dayCardHtml(day, monthKey, year)).join('');
  showExplorerView();
  state.route = { view: 'month', monthKey, year, homeScrollY: state.homeScrollY, activeView: state.activeView };
  if (push) pushAppHistory(state.route);
}

function buildCalendarYearPickerCard(year) {
  return `
    <button class="year-card" type="button" data-calendar-picker-year="${year.year}">
      ${createCoverHtml(year.coverUrls)}
      <div class="card-content">
        <div class="card-title">${year.year}</div>
        <div class="card-stats">${year.journalCount} entries Â· ${year.photoCount} media</div>
      </div>
    </button>
  `;
}

async function openCalendarYearPicker({ push = true } = {}) {
  state.explorerMode = 'calendar-years';
  state.homeScrollY = window.scrollY;
  const years = state.bootstrap?.years || [];
  dom.explorerTitle.textContent = 'Browse calendar';
  dom.explorerSubtitle.textContent = 'Choose a year';
  dom.explorerGrid.className = 'explorer-grid years-grid';
  dom.explorerGrid.innerHTML = years.map(buildCalendarYearPickerCard).join('');
  showExplorerView();
  state.route = { view: 'calendar-years', activeView: 'calendar', homeScrollY: state.homeScrollY, calendarDate: state.calendarViewDate };
  if (push) pushAppHistory(state.route);
}

async function openCalendarMonthPicker(year, { push = true } = {}) {
  state.explorerMode = 'calendar-months';
  state.homeScrollY = window.scrollY;
  const payload = await getYearData(year);
  dom.explorerTitle.textContent = `${payload.year}`;
  dom.explorerSubtitle.textContent = 'Choose a month';
  dom.explorerGrid.className = 'explorer-grid months-grid';
  dom.explorerGrid.innerHTML = payload.months.map(monthCardHtml).join('');
  showExplorerView();
  state.route = { view: 'calendar-year', year, activeView: 'calendar', homeScrollY: state.homeScrollY, calendarDate: state.calendarViewDate };
  if (push) pushAppHistory(state.route);
}

async function openCalendarAtMonth(monthKey, { push = true } = {}) {
  state.explorerMode = 'default';
  state.calendarViewMonth = monthKey || state.calendarViewMonth;
  state.calendarViewDate = monthStartIso(monthKey) || state.calendarViewDate;
  await goHome({ push, restoreScroll: false, activeView: 'calendar', scrollY: 0, focusDate: null });
  renderCalendarView({ preserveGridScroll: false, alignMonth: true });
  requestAnimationFrame(() => scrollCalendarMonthIntoView(monthKey, 'auto'));
}

async function goHome({ push = false, focusDate = null, restoreScroll = true, scrollY = null, activeView = state.activeView } = {}) {
  setActiveView(activeView);
  showHomeView();
  const nextScrollY = scrollY ?? state.homeScrollY ?? 0;
  state.route = { view: 'home', scrollY: nextScrollY, focusDate, activeView: state.activeView, searchQuery: state.searchQuery };
  if (push) pushAppHistory(state.route);
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
  setActiveView(route?.activeView || state.activeView || 'timeline');
  if (route?.calendarDate) state.calendarViewDate = route.calendarDate;
  if (route?.folderRootId || route?.folderPath) {
    state.folderViewSelection = {
      rootId: route.folderRootId || state.folderRoots[0]?.rootId || '0',
      relativePath: route.folderPath || '.'
    };
  }
  if (route?.searchQuery && route.searchQuery !== state.searchQuery) {
    state.searchUiOpen = true;
    syncTopbarSearchState();
    if (dom.searchInput) dom.searchInput.value = route.searchQuery;
    await runSearch(route.searchQuery);
  }
  if (!route || route.view === 'home') {
    await goHome({ push: false, focusDate: route?.focusDate || null, restoreScroll: !route?.focusDate, scrollY: route?.scrollY || 0, activeView: route?.activeView || state.activeView });
    if (state.activeView === 'home') {
      renderActiveBrowseView();
    }
    if (state.activeView === 'gallery') {
      await ensureGalleryWindowRendered();
      if (!route?.focusDate) {
        window.scrollTo({ top: route?.scrollY || 0, behavior: 'auto' });
        updateActiveGalleryFromScroll();
        syncScrollThumb();
      }
    }
    if (state.activeView === 'calendar') {
      renderCalendarView();
    }
    if (state.activeView === 'folders') {
      await ensureFoldersReady();
      renderFoldersView();
    }
    return;
  }
  if (route.view === 'entry-detail') {
    await openEntryDetail(route.entryDate, { push: false });
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
  if (route.view === 'calendar-years') {
    await openCalendarYearPicker({ push: false });
    return;
  }
  if (route.view === 'calendar-year') {
    await openCalendarMonthPicker(route.year, { push: false });
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
  let galleryWheelDelta = 0;
  let galleryWheelResetTimer = 0;

  const queueTimelineWheelReset = () => {
    if (timelineWheelResetTimer) window.clearTimeout(timelineWheelResetTimer);
    timelineWheelResetTimer = window.setTimeout(() => {
      timelineWheelDelta = 0;
      timelineWheelResetTimer = 0;
    }, 180);
  };

  const queueGalleryWheelReset = () => {
    if (galleryWheelResetTimer) window.clearTimeout(galleryWheelResetTimer);
    galleryWheelResetTimer = window.setTimeout(() => {
      galleryWheelDelta = 0;
      galleryWheelResetTimer = 0;
    }, 180);
  };

  async function goToNewestTop() {
    await goHome({ push: true, restoreScroll: false, activeView: 'timeline' });
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
  dom.viewTabsToggle?.addEventListener('click', () => {
    state.sideTabsCollapsed = !state.sideTabsCollapsed;
    syncSideTabsState();
  });
  dom.sideHomeButton?.addEventListener('click', () => {
    openHomeLanding({ push: true }).catch(console.error);
  });
  dom.sideTodayButton?.addEventListener('click', () => {
    openTodayEditor();
  });
  dom.viewTabs?.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-app-view]');
    if (!tab) return;
    const nextView = tab.dataset.appView;
    const openView = async () => {
      setActiveView(nextView);
      if (nextView === 'calendar' && !state.calendarViewMonth) {
        state.calendarViewDate = state.bootstrap?.today?.isoDate || state.activeDate || state.bootstrap?.lastDate || '';
        state.calendarViewMonth = monthKeyFromIso(state.calendarViewDate) || state.calendarViewMonth;
      }
      await goHome({ push: true, restoreScroll: nextView === 'timeline', activeView: nextView });
      if (nextView === 'gallery') await ensureGalleryWindowRendered();
      if (nextView === 'folders') await ensureFoldersReady();
      renderActiveBrowseView();
      rebuildViewerSequence();
      syncRouteHistory();
    };
    openView().catch(console.error);
  });
  dom.galleryFilters?.addEventListener('click', (event) => {
    const layoutToggle = event.target.closest('[data-gallery-layout-toggle]');
    if (layoutToggle) {
      setGalleryLayoutMode(layoutToggle.dataset.nextGalleryLayout || (state.galleryLayoutMode === 'grid' ? 'ratio' : 'grid'));
      return;
    }
    if (event.target.closest('#galleryScaleToggle')) {
      setOpenScalePanel(state.openScalePanel === 'gallery' ? null : 'gallery');
    }
  });
  dom.galleryScaleSlider?.addEventListener('input', (event) => {
    setGalleryMediaScale(event.target.value);
  });
  dom.timelineScaleToggle?.addEventListener('click', () => {
    setOpenScalePanel(state.openScalePanel === 'timeline' ? null : 'timeline');
  });
  dom.timelineScaleSlider?.addEventListener('input', (event) => {
    setTimelineMediaScale(event.target.value);
  });
  document.addEventListener('click', (event) => {
    if (!state.openScalePanel) return;
    if (event.target.closest('.media-scale-control')) return;
    setOpenScalePanel(null);
  });
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
  dom.settingsButton.addEventListener('click', openProfileMenu);
  dom.settingsCloseButton.addEventListener('click', closeSettings);
  dom.settingsModal.querySelector('.settings-backdrop').addEventListener('click', closeSettings);
  dom.settingsPanelButtons.forEach((button) => {
    button.addEventListener('click', () => setSettingsPanel(button.dataset.settingsPanel));
  });
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
  dom.changePasswordButton?.addEventListener('click', () => {
    changePassword().catch(console.error);
  });
  dom.themeChoices.forEach((button) => {
    button.addEventListener('click', () => setThemeChoice(button.dataset.themeChoice));
  });
  dom.backgroundChoices.forEach((button) => {
    button.addEventListener('click', () => setBackgroundChoice(button.dataset.backgroundChoice));
  });
  dom.settingsAddMediaFolder?.addEventListener('click', () => {
    state.desktopSettings = state.desktopSettings || {};
    state.desktopSettings.mediaFolders = [...(state.desktopSettings.mediaFolders || []), desktopFolderTemplate()];
    renderSettingsMediaFolders();
  });
  dom.settingsMediaFolders?.addEventListener('click', async (event) => {
    const removeButton = event.target.closest('[data-action="remove-folder"]');
    if (removeButton) {
      removeButton.closest('.settings-media-folder')?.remove();
      return;
    }
    const pickButton = event.target.closest('[data-action="pick-folder"]');
    if (pickButton) {
      const row = pickButton.closest('.settings-media-folder');
      const folder = await pickSettingsDirectory();
      if (folder) {
        row.querySelector('[data-field="path"]').value = folder;
        const label = row.querySelector('[data-field="label"]');
        if (!label.value.trim()) label.value = folder.split(/[\\/]/).filter(Boolean).pop() || folder;
      }
    }
  });
  dom.settingsPickJournalMirror?.addEventListener('click', async () => {
    const folder = await pickSettingsDirectory();
    if (folder && dom.settingsJournalMirrorPathInput) dom.settingsJournalMirrorPathInput.value = folder;
  });
  dom.settingsPickUploadDestination?.addEventListener('click', async () => {
    const folder = await pickSettingsDirectory();
    if (folder && dom.settingsUploadDestinationInput) dom.settingsUploadDestinationInput.value = folder;
  });
  dom.settingsSaveDevicesButton?.addEventListener('click', () => {
    saveDesktopSettingsFromPanel().catch(console.error);
  });
  dom.settingsSyncNowButton?.addEventListener('click', () => {
    syncDesktopCloudFromPanel().catch(console.error);
  });
  dom.logoutButton?.addEventListener('click', async () => {
    const confirmed = window.confirm('Sign out of Book of Life? Images or entries may still be syncing. Make sure everything has finished before signing out.');
    if (!confirmed) return;
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
    const calendarYearCard = event.target.closest('[data-calendar-picker-year]');
    if (calendarYearCard) {
      calendarYearCard.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.03)', opacity: 0.92 }], { duration: 140, easing: 'ease-out' });
      window.setTimeout(() => {
        openCalendarMonthPicker(Number(calendarYearCard.dataset.calendarPickerYear)).catch(console.error);
      }, 90);
      return;
    }
    const monthCard = event.target.closest('[data-month-key]');
    if (monthCard && !monthCard.dataset.dayDate) {
      monthCard.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.03)', opacity: 0.92 }], { duration: 140, easing: 'ease-out' });
      window.setTimeout(() => {
        if (state.explorerMode === 'calendar-months') openCalendarAtMonth(monthCard.dataset.monthKey).catch(console.error);
        else openMonthView(monthCard.dataset.monthKey, Number(monthCard.dataset.year)).catch(console.error);
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

  dom.galleryFeed?.addEventListener('click', (event) => {
    const mediaButton = event.target.closest('.open-media');
    if (mediaButton) {
      event.stopPropagation();
      rebuildViewerSequence({ preferredMediaId: mediaButton.dataset.mediaId });
      openViewerById(mediaButton.dataset.mediaId);
      return;
    }
    const openDay = event.target.closest('[data-open-gallery-day]');
    if (openDay) {
      event.stopPropagation();
      goHome({ push: true, focusDate: openDay.dataset.openGalleryDay, restoreScroll: false, activeView: 'timeline' }).catch(console.error);
      return;
    }
    const openEntry = event.target.closest('[data-open-entry-detail]');
    if (openEntry) {
      event.preventDefault();
      event.stopPropagation();
      openEntryDetail(openEntry.dataset.openEntryDetail).catch(console.error);
    }
  });

  dom.calendarViewPrevMonth?.addEventListener('click', () => {
    state.calendarViewMonth = addMonthsToMonthKey(state.calendarViewMonth, -1) || state.calendarViewMonth;
    renderCalendarView({ preserveGridScroll: false, alignMonth: true });
    requestAnimationFrame(() => scrollCalendarMonthIntoView(state.calendarViewMonth, 'smooth'));
    syncRouteHistory();
  });
  dom.calendarViewNextMonth?.addEventListener('click', () => {
    state.calendarViewMonth = addMonthsToMonthKey(state.calendarViewMonth, 1) || state.calendarViewMonth;
    renderCalendarView({ preserveGridScroll: false, alignMonth: true });
    requestAnimationFrame(() => scrollCalendarMonthIntoView(state.calendarViewMonth, 'smooth'));
    syncRouteHistory();
  });
  dom.calendarViewToday?.addEventListener('click', () => {
    const todayIso = state.bootstrap?.today?.isoDate || fileDateToLocalIso(Date.now());
    state.calendarViewDate = todayIso;
    state.calendarViewMonth = monthKeyFromIso(todayIso) || state.calendarViewMonth;
    renderCalendarView({ preserveGridScroll: false, alignMonth: true });
    requestAnimationFrame(() => scrollCalendarMonthIntoView(state.calendarViewMonth, 'smooth'));
    syncRouteHistory();
  });
  dom.calendarViewMonthLabel?.addEventListener('click', () => {
    openCalendarYearPicker().catch(console.error);
  });
  dom.calendarViewGrid?.addEventListener('scroll', () => {
    if (state.calendarScrollRaf) return;
    state.calendarScrollRaf = requestAnimationFrame(() => {
      state.calendarScrollRaf = 0;
      syncCalendarMonthFromGridScroll();
    });
  }, { passive: true });
  dom.calendarViewGrid?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-calendar-browse-date]');
    if (!button) return;
    if (!button.classList.contains('has-content') && !button.classList.contains('is-search-hit')) return;
    state.calendarViewDate = button.dataset.calendarBrowseDate || '';
    state.calendarViewMonth = monthKeyFromIso(state.calendarViewDate) || state.calendarViewMonth;
    renderCalendarView({ preserveGridScroll: true, alignMonth: false });
    rebuildViewerSequence();
    syncRouteHistory();
    scrollCalendarDayPanelIntoView();
  });
  dom.calendarDayPanel?.addEventListener('click', (event) => {
    const mediaButton = event.target.closest('.open-media');
    if (mediaButton) {
      rebuildViewerSequence({ preferredMediaId: mediaButton.dataset.mediaId });
      openViewerById(mediaButton.dataset.mediaId);
      return;
    }
    const openDay = event.target.closest('[data-calendar-open-day]');
    if (!openDay) return;
    setActiveView('timeline');
    goHome({ push: true, focusDate: openDay.dataset.calendarOpenDay, restoreScroll: false, activeView: 'timeline' }).catch(console.error);
  });

  dom.foldersTree?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-folder-root][data-folder-path]');
    if (!button) return;
    const nextRoot = button.dataset.folderRoot || '0';
    const nextPath = button.dataset.folderPath || '.';
    if (isCurrentFolderRoute(nextRoot, nextPath)) return;
    const previousSelection = { ...(state.folderViewSelection || {}) };
    if (state.searchMode) {
      state.folderViewSelection = { rootId: nextRoot, relativePath: nextPath };
      renderFoldersView();
      rebuildViewerSequence();
      syncFolderNavigationHistory(previousSelection);
      return;
    }
    browseFolder(nextRoot, nextPath).then(() => {
      renderFoldersView();
      syncFolderNavigationHistory(previousSelection);
    }).catch(console.error);
  });
  dom.folderBreadcrumbs?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-folder-root][data-folder-path]');
    if (!button) return;
    const nextRoot = button.dataset.folderRoot || '0';
    const nextPath = button.dataset.folderPath || '.';
    if (isCurrentFolderRoute(nextRoot, nextPath)) return;
    const previousSelection = { ...(state.folderViewSelection || {}) };
    if (button.dataset.folderRoot === '__roots__') {
      state.folderViewSelection = { rootId: '__roots__', relativePath: '.' };
      renderFoldersView();
      syncFolderNavigationHistory(previousSelection);
      return;
    }
    if (state.searchMode) return;
    browseFolder(nextRoot, nextPath).then(() => {
      renderFoldersView();
      syncFolderNavigationHistory(previousSelection);
    }).catch(console.error);
  });
  dom.folderViewControls?.addEventListener('click', (event) => {
    const viewToggle = event.target.closest('[data-folder-view-mode]');
    if (!viewToggle) return;
    setFolderViewMode(viewToggle.dataset.folderViewMode);
  });
  dom.folderWorkspace?.addEventListener('click', (event) => {
    const mediaButton = event.target.closest('.open-media');
    if (mediaButton) {
      rebuildViewerSequence({ preferredMediaId: mediaButton.dataset.mediaId });
      openViewerById(mediaButton.dataset.mediaId);
      return;
    }
    const viewToggle = event.target.closest('[data-folder-view-mode]');
    if (viewToggle) {
      setFolderViewMode(viewToggle.dataset.folderViewMode);
      return;
    }
    const button = event.target.closest('[data-folder-root][data-folder-path]');
    if (!button) return;
    const nextRoot = button.dataset.folderRoot || '0';
    const nextPath = button.dataset.folderPath || '.';
    if (isCurrentFolderRoute(nextRoot, nextPath)) return;
    const previousSelection = { ...(state.folderViewSelection || {}) };
    if (button.dataset.folderRoot === '__roots__') {
      state.folderViewSelection = { rootId: '__roots__', relativePath: '.' };
      renderFoldersView();
      syncFolderNavigationHistory(previousSelection);
      return;
    }
    if (state.searchMode) return;
    browseFolder(nextRoot, nextPath).then(() => {
      renderFoldersView();
      syncFolderNavigationHistory(previousSelection);
    }).catch(console.error);
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
      rebuildViewerSequence({ preferredMediaId: mediaButton.dataset.mediaId });
      openViewerById(mediaButton.dataset.mediaId);
      return;
    }
    const entryDetail = event.target.closest('[data-open-entry-detail]');
    if (entryDetail) {
      event.preventDefault();
      openEntryDetail(entryDetail.dataset.openEntryDetail).catch(console.error);
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
    if (toggle) { handleJournalToggle(toggle.dataset.journalToggle, toggle); return; }
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
      const recovery = state.activeView === 'gallery' ? recoverGalleryIfOutrun() : recoverIfOutrun();
      recovery
        .then((recovered) => {
          if (!recovered) {
            if (state.activeView === 'gallery') reconcileGalleryWindowAroundActiveDate();
            else reconcileWindowAroundActiveDate();
          } else {
            updateActiveFromScroll();
          }
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
    applyTimelineMediaScale(state.timelineMediaScale);
    applyGalleryPreferences();
    renderScrollYearMarks();
    syncScrollThumb();
    updateActiveFromScroll();
    updateMobileTopbar(false);
    if (state.activeView === 'gallery') {
      const anchor = captureGalleryAnchor();
      suppressGalleryCorrection(700);
      renderGalleryView({ force: true });
      requestAnimationFrame(() => {
        restoreGalleryAnchor(anchor);
        refreshGalleryHeightMetrics({ anchor });
      });
    }
    if (state.activeView === 'calendar') {
      renderCalendarView({ preserveGridScroll: true, alignMonth: false });
    }
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
      const changed = stepTimelineMediaScale(-direction);
      timelineWheelDelta -= stepSize * direction;
      if (!changed) {
        timelineWheelDelta = 0;
        break;
      }
    }
  }, { passive: false });

  dom.galleryPane?.addEventListener('wheel', (event) => {
    if ((!event.ctrlKey && !event.metaKey) || state.activeView !== 'gallery') return;
    const deltaY = normalizeWheelDelta(event);
    if (!deltaY) return;
    if (event.cancelable) event.preventDefault();
    queueGalleryWheelReset();
    galleryWheelDelta += deltaY;
    const stepSize = 72;
    while (Math.abs(galleryWheelDelta) >= stepSize) {
      const direction = Math.sign(galleryWheelDelta);
      const changed = stepGalleryMediaScale(-direction);
      galleryWheelDelta -= stepSize * direction;
      if (!changed) {
        galleryWheelDelta = 0;
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
      state.timelinePinchStartScale = state.timelineMediaScale;
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
    const start = state.timelinePinchStartScale || mediaScaleBounds().base;
    const delta = Math.round((ratio - 1) * 4);
    setTimelineMediaScale(clamp(start + delta, mediaScaleBounds().min, mediaScaleBounds().max));
  });
  const endTimelinePinch = (event) => {
    state.timelinePointers.delete(event.pointerId);
    if (state.timelinePointers.size < 2) {
      state.timelinePinchStartDistance = null;
      state.timelinePinchStartScale = state.timelineMediaScale;
    }
  };
  dom.timelinePane.addEventListener('pointerup', endTimelinePinch);
  dom.timelinePane.addEventListener('pointercancel', endTimelinePinch);

  dom.galleryPane?.addEventListener('pointerdown', (event) => {
    if (!isCoarsePointer() || state.activeView !== 'gallery') return;
    state.galleryPointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    if (state.galleryPointers.size === 2) {
      const points = Array.from(state.galleryPointers.values());
      state.galleryPinchStartDistance = Math.hypot(points[0].clientX - points[1].clientX, points[0].clientY - points[1].clientY);
      state.galleryPinchStartScale = state.galleryMediaScale;
      if (event.cancelable) event.preventDefault();
    }
  });
  dom.galleryPane?.addEventListener('pointermove', (event) => {
    if (!state.galleryPointers.has(event.pointerId) || state.activeView !== 'gallery') return;
    state.galleryPointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    if (state.galleryPointers.size !== 2 || !state.galleryPinchStartDistance) return;
    if (event.cancelable) event.preventDefault();
    const points = Array.from(state.galleryPointers.values());
    const distance = Math.hypot(points[0].clientX - points[1].clientX, points[0].clientY - points[1].clientY);
    const ratio = distance / state.galleryPinchStartDistance;
    const start = state.galleryPinchStartScale || mediaScaleBounds().base;
    const delta = Math.round((ratio - 1) * 4);
    setGalleryMediaScale(clamp(start + delta, mediaScaleBounds().min, mediaScaleBounds().max));
  });
  const endGalleryPinch = (event) => {
    state.galleryPointers.delete(event.pointerId);
    if (state.galleryPointers.size < 2) {
      state.galleryPinchStartDistance = null;
      state.galleryPinchStartScale = state.galleryMediaScale;
    }
  };
  dom.galleryPane?.addEventListener('pointerup', endGalleryPinch);
  dom.galleryPane?.addEventListener('pointercancel', endGalleryPinch);

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
    if (state.settingsOpen && !nextState.settingsOpen) {
      closeSettings({ fromHistory: true });
    } else if (!state.settingsOpen && nextState.settingsOpen) {
      openSettings({ pushHistory: false });
    }
    routeToState(nextState, { fromPop: true }).catch(console.error);
  });
}

function parseInitialRoute() {
  const url = new URL(window.location.href);
  const focusDate = url.searchParams.get('focus') || sessionStorage.getItem('lifeserver-focus-date') || '';
  const requestedView = url.searchParams.get('view') || '';
  const activeView = requestedView || 'home';
  const searchQuery = url.searchParams.get('q') || '';
  const folderRootId = url.searchParams.get('root') || '0';
  const folderPath = url.searchParams.get('folder') || '.';
  const calendarDate = url.searchParams.get('date') || '';
  const entryPathMatch = url.pathname.match(/^\/entry\/(\d{4}-\d{2}-\d{2})\/?$/);
  if (entryPathMatch) {
    return { view: 'entry-detail', entryDate: entryPathMatch[1], scrollY: 0, activeView: requestedView || 'timeline', searchQuery, folderRootId, folderPath, calendarDate };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(focusDate)) {
    sessionStorage.removeItem('lifeserver-focus-date');
    return { view: 'home', scrollY: 0, focusDate, activeView: requestedView || 'timeline', searchQuery, folderRootId, folderPath, calendarDate };
  }
  const hash = window.location.hash || '';
  const dayMatch = hash.match(/^#day-(\d{4}-\d{2}-\d{2})$/);
  if (dayMatch) return { view: 'home', scrollY: 0, focusDate: dayMatch[1], activeView: requestedView || 'timeline', searchQuery, folderRootId, folderPath, calendarDate };
  const searchMatch = hash.match(/^#search-(\d{4}-\d{2}-\d{2})$/);
  if (searchMatch) return { view: 'search-detail', entryDate: searchMatch[1], resultIndex: 0, scrollY: 0, activeView, searchQuery, folderRootId, folderPath, calendarDate };
  const monthMatch = hash.match(/^#month-([\d-]{7})$/);
  if (monthMatch) return { view: 'month', monthKey: monthMatch[1], year: Number(monthMatch[1].slice(0, 4)), activeView, searchQuery, folderRootId, folderPath, calendarDate };
  const yearMatch = hash.match(/^#year-(\d{4})$/);
  if (yearMatch) return { view: 'year', year: Number(yearMatch[1]), activeView, searchQuery, folderRootId, folderPath, calendarDate };
  return { view: 'home', scrollY: 0, activeView, searchQuery, folderRootId, folderPath, calendarDate };
}

async function bootstrapApp() {
  renderTimelineLoadingState();
  applyTheme(state.theme);
  applyBackgroundPreset(state.backgroundPreset);
  applyTimelineMediaScale(state.timelineMediaScale);
  normalizeGalleryLayoutControls();
  removeGalleryDetailControls();
  applyGalleryPreferences();
  syncMediaScaleControls();
  setOpenScalePanel(null);
  syncSideTabsState();
  state.timelineBooting = true;
  updateTimelineStatus();
  const parsedInitialRoute = parseInitialRoute();
  const initialState = parsedInitialRoute.view === 'entry-detail' ? parsedInitialRoute : (history.state || parsedInitialRoute);
  setActiveView(initialState?.activeView || 'timeline');
  history.replaceState({ ...initialState, activeView: state.activeView }, '', buildRouteUrl({ ...initialState, activeView: state.activeView }));
  const authStatus = await fetchJson('/api/auth/status');
  state.authEnabled = Boolean(authStatus?.enabled);
  state.sessionUsername = typeof authStatus?.username === 'string' ? authStatus.username : '';
  const desktopStatus = await fetchJson('/api/desktop/onboarding/status').catch(() => null);
  if (desktopStatus?.desktop) {
    state.desktopOnboardingStatus = desktopStatus;
    state.desktopCloudStatus = desktopStatus.cloud || null;
    state.desktopSettings = desktopStatus.settings || null;
    state.desktopCloudSignedIn = Boolean(desktopStatus.cloud?.signedIn);
  }
  syncSettingsAccountUi();
  state.bootstrap = await fetchJson('/api/bootstrap');
  state.totalDays = state.bootstrap.totalDays;
  state.calendarViewDate = initialState?.calendarDate || state.bootstrap?.today?.isoDate || state.bootstrap.lastDate || '';
  state.calendarViewMonth = monthKeyFromIso(state.calendarViewDate || state.bootstrap?.today?.isoDate || state.bootstrap.lastDate || '') || '';
  renderDefaultYearSubtitle();
  state.mobileTopbarAnchorY = 0;
  syncTopbarSearchState();
  updateTopbarDateLabel();
  renderYearCarousel();
  renderRail();
  initializeHomeSourceFromBootstrap();
  renderScrollYearMarks();
  attachEvents();
  preloadFolders();
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
