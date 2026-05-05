const dom = {
  backButton: document.getElementById('editorBackButton'),
  title: document.getElementById('editorTitle'),
  subtitle: document.getElementById('editorSubtitle'),
  textarea: document.getElementById('editorTextarea'),
  preview: document.getElementById('editorPreview'),
  undoButton: document.getElementById('undoButton'),
  redoButton: document.getElementById('redoButton'),
  saveButton: document.getElementById('saveButton'),
  modeButtons: Array.from(document.querySelectorAll('[data-editor-mode]')),
  photoStripWrap: document.getElementById('editorPhotoStripWrap'),
  photoStrip: document.getElementById('editorPhotoStrip'),
  uploadButton: document.getElementById('editorUploadButton'),
  uploadModal: document.getElementById('editorUploadModal'),
  uploadBackdrop: document.querySelector('.editor-upload-backdrop'),
  uploadClose: document.getElementById('editorUploadClose'),
  uploadWindow: document.querySelector('.editor-upload-window'),
  uploadTitle: document.getElementById('editorUploadTitle'),
  folderButton: document.getElementById('editorFolderButton'),
  newFolderButton: document.getElementById('editorNewFolderButton'),
  folderLabel: document.getElementById('editorFolderLabel'),
  folderTree: document.getElementById('editorFolderTree'),
  addFilesButton: document.getElementById('editorAddFilesButton'),
  fileInput: document.getElementById('editorFileInput'),
  filePicker: document.querySelector('.editor-file-picker'),
  uploadSelectionLoading: document.getElementById('editorUploadSelectionLoading'),
  checkRow: document.querySelector('.editor-check-row'),
  uploadPreviewList: document.getElementById('editorUploadPreviewList'),
  setExifDate: document.getElementById('editorSetExifDate'),
  sharedDate: document.getElementById('editorSharedDate'),
  exifDateLabel: document.getElementById('editorExifDateLabel'),
  uploadSubmit: document.getElementById('editorUploadSubmit'),
  uploadSubmitLabel: document.getElementById('editorUploadSubmitLabel'),
  uploadCancel: document.getElementById('editorUploadCancel'),
  uploadResume: document.getElementById('editorUploadResume'),
  uploadResumeLabel: document.getElementById('editorUploadResumeLabel'),
  viewer: document.getElementById('editorViewer'),
  viewerBackdrop: document.querySelector('.editor-viewer-backdrop'),
  viewerClose: document.getElementById('editorViewerClose'),
  viewerInfoToggle: document.getElementById('editorViewerInfoToggle'),
  viewerDelete: document.getElementById('editorViewerDelete'),
  viewerPrev: document.getElementById('editorViewerPrev'),
  viewerNext: document.getElementById('editorViewerNext'),
  viewerStage: document.getElementById('editorViewerStage'),
  viewerCanvas: document.getElementById('editorViewerCanvas'),
  viewerLoading: document.getElementById('editorViewerLoading'),
  viewerDateToast: document.getElementById('editorViewerDateToast'),
  viewerDetails: document.getElementById('editorViewerDetails'),
  viewerDetailsMeta: document.getElementById('editorViewerDetailsMeta'),
  viewerDescriptionInput: document.getElementById('editorViewerDescriptionInput'),
  viewerTagsInput: document.getElementById('editorViewerTagsInput'),
  viewerTagsSave: document.getElementById('editorViewerTagsSave'),
  viewerZoomIn: document.getElementById('editorViewerZoomIn'),
  viewerZoomOut: document.getElementById('editorViewerZoomOut'),
  viewerZoomReset: document.getElementById('editorViewerZoomReset'),
  viewerImage: document.getElementById('editorViewerImage'),
  viewerVideo: document.getElementById('editorViewerVideo')
};

const AUTOSAVE_INTERVAL_MS = 3000;

const state = {
  isoDate: null,
  title: '',
  dateLabel: '',
  loadedValue: '',
  editorMode: 'raw',
  dirty: false,
  saving: false,
  navigateAfterSave: false,
  saveError: '',
  saveTimer: 0,
  autoSaveQueued: false,
  history: [],
  historyIndex: -1,
  historyTimer: 0,
  applyFromHistory: false,
  photos: [],
  viewerIndex: -1,
  folderRoots: [],
  uploadTarget: loadStoredUploadTarget(),
  uploadSelectedFiles: [],
  uploadFileSeq: 0,
  uploadXhr: null,
  uploadProgressRatio: 0,
  uploadCreatingFolder: null,
  uploadPreparing: false,
  uploadFolderHideTimer: 0,
  viewerZoom: 1,
  viewerPanX: 0,
  viewerPanY: 0,
  viewerPointers: new Map(),
  viewerPinchStartDistance: null,
  viewerPinchStartZoom: 1,
  viewerSwipeStart: null,
  viewerPanOrigin: null,
  viewerDetailsOpen: false,
  viewerDescriptionDirty: false,
  viewerDescriptionSaving: false,
  viewerVelocityX: 0,
  viewerVelocityY: 0,
  viewerMomentumFrame: null,
  viewerDetailsSwipeStartY: null,
  viewerLastShownDate: ''
};

const mediaViewer = window.createMediaViewer({
  getItems: () => state.photos,
  onOpen: () => {
    document.body.classList.add('viewer-open');
  },
  onClose: () => {
    document.body.classList.remove('viewer-open');
  },
  onRequestClose: () => {
    closeViewer();
  },
  onSaveTags: async (item, tags) => {
    const payload = await fetchJson(`/api/media/${item.id}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags })
    });
    item.tags = payload.tags || [];
    return item.tags;
  },
  onSaveDescription: async (item, description) => {
    const payload = await fetchJson(`/api/media/${item.id}/description`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description })
    });
    item.description = payload.description || '';
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
      const current = state.photos.find((photo) => photo.id === item.id) || item;
      const siblingConflict = (viewer?.getItems?.() || state.photos).some((photo) => (
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
    await refreshEntryPhotos();
    return payload;
  },
  onMove: async (item, target) => {
    const payload = await fetchJson(`/api/media/${item.id}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(target)
    });
    await refreshEntryPhotos();
    return payload;
  },
  onLoadFolders: async () => fetchJson('/api/upload/folders'),
  onSaveDateTime: async (item, value) => {
    const payload = await fetchJson(`/api/media/${item.id}/date-time`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    });
    await refreshEntryPhotos();
    return payload;
  },
  onDelete: async (item, index, viewer) => {
    if (!item) return;
    if (!window.confirm(`Delete ${item.fileName}?`)) return;
    const removedIndex = index;
    state.photos = state.photos.filter((photo) => photo.id !== item.id);
    renderPhotos();
    if (!state.photos.length) viewer.close({ animate: false });
    else viewer.refresh({ preferredIndex: Math.min(removedIndex, state.photos.length - 1), forceDateToast: true });
    try {
      await fetchJson(`/api/media/${item.id}`, { method: 'DELETE' });
    } catch (error) {
      await loadEntry();
      if (state.photos.length) viewer.refresh({ preferredIndex: Math.min(removedIndex, state.photos.length - 1) });
      throw error;
    }
  },
  onError: (error) => {
    setStatus(error.message, 'is-error');
  }
});

dom.viewer = mediaViewer.root;

function loadStoredUploadTarget() {
  try {
    const parsed = JSON.parse(localStorage.getItem('lifeserver-upload-target-v1') || '{}');
    return {
      rootId: typeof parsed.rootId === 'string' ? parsed.rootId : '0',
      relativePath: typeof parsed.relativePath === 'string' ? parsed.relativePath : ''
    };
  } catch (error) {
    return { rootId: '0', relativePath: '' };
  }
}

const markdown = window.markdownit ? window.markdownit({
  html: false,
  linkify: true,
  breaks: true
}) : null;

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

function redirectToLogin() {
  if (window.location.pathname !== '/login') window.location.href = '/login';
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    redirectToLogin();
    throw new Error('Unauthorized');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function getIsoDateFromPath() {
  const match = window.location.pathname.match(/\/edit\/(\d{4}-\d{2}-\d{2})$/);
  return match ? match[1] : null;
}

function shouldCreateIfMissing() {
  const params = new URLSearchParams(window.location.search);
  return params.get('create') === '1';
}

function applyTheme() {
  const theme = localStorage.getItem('lifeserver-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.body.dataset.theme = theme;
}

function countWords(raw) {
  return String(raw || '')
    .replace(/!\[\[[^\]]+\]\]/g, ' ')
    .replace(/[`*_>#-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function formatEditorStats() {
  const wordCount = countWords(dom.textarea?.value || '');
  return `${wordCount} ${wordCount === 1 ? 'Word' : 'Words'} • ${state.photos.length} Media`;
}

function setSubtitleText(value, className = '') {
  dom.subtitle.textContent = value;
  dom.subtitle.classList.toggle('is-saving', className === 'is-saving');
  dom.subtitle.classList.toggle('is-error', className === 'is-error');
}

function setSubtitleHtml(html, className = '') {
  dom.subtitle.innerHTML = html;
  dom.subtitle.classList.toggle('is-saving', className === 'is-saving');
  dom.subtitle.classList.toggle('is-error', className === 'is-error');
}

function renderSubtitle() {
  if (state.saveError) {
    setSubtitleText(state.saveError, 'is-error');
    return;
  }
  if (state.dirty || state.saving) {
    setSubtitleHtml(`${renderPhIcon('spinner-gap', { spin: true })}<span>Saving...</span>`, 'is-saving');
    return;
  }
  setSubtitleText(formatEditorStats());
}

function setStatus(message, kind = '') {
  state.saveError = kind === 'is-error' ? message : '';
  renderSubtitle();
}

function exitEditor() {
  const hasEntryContent = Boolean((dom.textarea?.value || state.loadedValue || '').trim() || state.photos.length);
  sessionStorage.setItem('lifeserver-focus-date', state.isoDate);
  window.location.href = hasEntryContent ? `/?focus=${state.isoDate}#day-${state.isoDate}` : '/';
}

function handleSaveButtonClick() {
  if (state.saving) {
    state.navigateAfterSave = true;
    return;
  }
  if (!state.dirty) {
    exitEditor();
    return;
  }
  saveEntry({ navigateOnSuccess: true, source: 'manual' });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeLineEndings(value) {
  return String(value ?? '').replace(/\r\n/g, '\n');
}

function renderMarkdownPreview(raw) {
  const source = normalizeLineEndings(raw)
    .replace(/!\[\[([^\]]+)\]\]/g, (match, imageName) => {
      const trimmed = String(imageName || '').trim();
      if (!trimmed) return '';
      return `![](/media/journal-inline/${encodeURIComponent(trimmed)})`;
    });

  if (!markdown) return escapeHtml(source).replace(/\n/g, '<br>');
  return markdown.render(source);
}

function renderPreview() {
  if (!dom.preview) return;
  const raw = normalizeLineEndings(dom.textarea.value);
  dom.preview.innerHTML = raw.trim() ? renderMarkdownPreview(raw) : '';
  dom.preview.classList.toggle('is-empty', !raw.trim());
}

function updateModeButtons() {
  dom.modeButtons.forEach((button) => {
    const active = button.dataset.editorMode === state.editorMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function focusPreview() {
  if (!dom.preview) return;
  dom.preview.focus();
}

function setPreviewPlaceholder(value) {
  if (!dom.preview) return;
  dom.preview.dataset.placeholder = value || '';
  dom.preview.classList.toggle('is-empty', !normalizeLineEndings(dom.textarea.value).trim());
}

function setEditorMode(mode, { focus = true } = {}) {
  const nextMode = mode === 'preview' ? 'preview' : 'raw';
  if (nextMode === state.editorMode) {
    updateModeButtons();
    return;
  }

  state.editorMode = nextMode;

  if (state.editorMode === 'preview') renderPreview();

  dom.textarea.classList.toggle('hidden', state.editorMode === 'preview');
  dom.preview.classList.toggle('hidden', state.editorMode !== 'preview');
  updateModeButtons();

  if (!focus) return;
  if (state.editorMode === 'preview') focusPreview();
  else dom.textarea.focus();
}

function updateDirtyState() {
  state.dirty = dom.textarea.value !== state.loadedValue;
  if (!state.dirty) state.saveError = '';
  renderSubtitle();
}

function clearAutoSaveTimer() {
  if (state.saveTimer) window.clearTimeout(state.saveTimer);
  state.saveTimer = 0;
}

function scheduleAutoSave(delay = AUTOSAVE_INTERVAL_MS) {
  clearAutoSaveTimer();
  if (!state.dirty) return;
  state.saveTimer = window.setTimeout(() => {
    state.saveTimer = 0;
    if (!state.dirty) return;
    if (state.saving) {
      state.autoSaveQueued = true;
      return;
    }
    saveEntry({ navigateOnSuccess: false, source: 'auto' });
  }, delay);
}

function snapshotCurrent() {
  return {
    value: dom.textarea.value,
    selectionStart: dom.textarea.selectionStart,
    selectionEnd: dom.textarea.selectionEnd
  };
}

function updateUndoRedoButtons() {
  dom.undoButton.disabled = state.historyIndex <= 0;
  dom.redoButton.disabled = state.historyIndex >= state.history.length - 1;
}

function applyHistorySnapshot(snapshot) {
  state.applyFromHistory = true;
  dom.textarea.value = snapshot.value;
  renderPreview();
  if (state.editorMode === 'preview') {
    focusPreview();
  } else {
    dom.textarea.focus();
    dom.textarea.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  }
  state.applyFromHistory = false;
  updateDirtyState();
}

function pushHistorySnapshot(force = false) {
  const snap = snapshotCurrent();
  const current = state.history[state.historyIndex];
  if (!force && current && current.value === snap.value) return;
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(snap);
  if (state.history.length > 200) state.history.shift();
  state.historyIndex = state.history.length - 1;
  updateUndoRedoButtons();
}

function scheduleHistorySnapshot() {
  clearTimeout(state.historyTimer);
  state.historyTimer = window.setTimeout(() => pushHistorySnapshot(false), 250);
}

function undo() {
  if (state.historyIndex <= 0) return;
  state.historyIndex -= 1;
  applyHistorySnapshot(state.history[state.historyIndex]);
  updateUndoRedoButtons();
}

function redo() {
  if (state.historyIndex >= state.history.length - 1) return;
  state.historyIndex += 1;
  applyHistorySnapshot(state.history[state.historyIndex]);
  updateUndoRedoButtons();
}

function relativePlaceholder(isoDate, dateLabel) {
  const today = new Date();
  const localToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(`${isoDate}T12:00:00`);
  const targetLocal = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const diffDays = Math.round((localToday - targetLocal) / 86400000);
  if (diffDays === 0) return 'What happened today?';
  if (diffDays === 1) return 'What happened yesterday?';
  if (diffDays > 1 && diffDays < 7) {
    return `Last ${target.toLocaleDateString('en-US', { weekday: 'long' })}?`;
  }
  return `${dateLabel.replace(/^\w+,\s*/, '')}?`;
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

function fileDateToLocalIso(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return [date.getFullYear(), `${date.getMonth() + 1}`.padStart(2, '0'), `${date.getDate()}`.padStart(2, '0')].join('-');
}

function isValidIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function uploadDateSourceLabel(item) {
  if (item?.dateSource === 'exif') return 'Date taken metadata';
  if (item?.dateSource === 'last-modified') return 'File modified date';
  if (item?.dateSource === 'shared') return 'Shared LifeServer datestamp';
  if (item?.dateSource === 'manual') return 'Custom LifeServer date';
  return 'Entry date';
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createSelectedUploadFile(file) {
  return {
    id: `editor-upload-${Date.now()}-${state.uploadFileSeq += 1}`,
    file,
    objectUrl: URL.createObjectURL(file),
    isoDate: state.isoDate || '',
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
  if (dom.fileInput) dom.fileInput.value = '';
}

function updateUploadButtonLabel() {
  const count = state.uploadSelectedFiles.length;
  if (dom.uploadSubmitLabel) dom.uploadSubmitLabel.textContent = count ? `Upload ${count} file${count === 1 ? '' : 's'}` : 'Upload';
}

function updateUploadDateToggleLabel() {
  if (dom.exifDateLabel) dom.exifDateLabel.textContent = 'Override LifeServer datestamp';
}

function updateUploadSharedDateUi() {
  const enabled = Boolean(dom.setExifDate?.checked);
  if (dom.sharedDate) {
    dom.sharedDate.disabled = !enabled;
    if (!dom.sharedDate.value) dom.sharedDate.value = state.isoDate || state.uploadSelectedFiles[0]?.isoDate || '';
  }
}

function applySharedUploadDate(isoDate) {
  if (!isValidIsoDate(isoDate)) return;
  state.uploadSelectedFiles = state.uploadSelectedFiles.map((item) => ({ ...item, isoDate, dateSource: 'shared' }));
}

function setUploadFileDate(fileId, isoDate) {
  if (!isValidIsoDate(isoDate)) return;
  state.uploadSelectedFiles = state.uploadSelectedFiles.map((item) => (
    item.id === fileId ? { ...item, isoDate, dateSource: 'manual' } : item
  ));
  if (dom.setExifDate?.checked && dom.sharedDate?.value && dom.sharedDate.value !== isoDate) {
    dom.setExifDate.checked = false;
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

async function appendUploadFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const batchSize = 8;
  for (let index = 0; index < files.length; index += batchSize) {
    const batch = await Promise.all(files.slice(index, index + batchSize).map(async (file) => {
      const item = createSelectedUploadFile(file);
      const metadata = await extractUploadMetadataDate(file, state.isoDate || '');
      item.isoDate = metadata.isoDate;
      item.dateSource = metadata.dateSource;
      if (dom.setExifDate?.checked && isValidIsoDate(dom.sharedDate?.value)) {
        item.isoDate = dom.sharedDate.value;
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
  if (!state.uploadSelectedFiles.length && dom.fileInput) dom.fileInput.value = '';
  updateUploadButtonLabel();
  updateUploadSharedDateUi();
  updateUploadUiState();
  renderUploadPreviews();
}

function renderUploadPreviews() {
  if (!dom.uploadPreviewList) return;
  const files = state.uploadSelectedFiles || [];
  dom.uploadPreviewList.innerHTML = files.map((item) => {
    const file = item.file;
    const isVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(file.name);
    const displayName = uploadDisplayName(file.name);
    const previewMedia = isVideo
      ? `<video src="${item.objectUrl}" muted playsinline preload="none"></video><span class="upload-preview-video">${renderPhIcon('play-fill', { variant: 'fill' })}</span>`
      : `<img src="${item.objectUrl}" alt="${file.name}" loading="lazy" decoding="async" />`;
    return `<div class="upload-preview-card ${state.uploadXhr ? '' : 'is-removable'}"><div class="upload-preview-thumb">${previewMedia}${state.uploadXhr ? '' : `<button class="upload-preview-remove" type="button" data-upload-remove="${item.id}" aria-label="Remove ${displayName}">${renderPhIcon('x', { variant: 'bold' })}</button>`}</div><div class="upload-preview-meta"><div class="upload-preview-meta-row"><div class="upload-preview-meta-copy"><strong title="${displayName}">${displayName}</strong><span>${uploadDateSourceLabel(item)}</span><span>Size · ${formatFileSize(file.size)}</span></div><button class="upload-preview-date" type="button" data-upload-date-trigger="${item.id}" aria-label="Change date for ${displayName}">${renderPhIcon('calendar-dots', { variant: 'duotone' })}<strong title="${displayName}">${monthDayLabel(item.isoDate) || 'No date'}</strong></button><input class="upload-preview-date-input" type="date" data-upload-date-input="${item.id}" value="${item.isoDate || ''}" /></div><div class="upload-preview-progress"><span class="upload-preview-progress-fill" data-upload-progress="${item.id}"></span></div></div></div>`;
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
  if (dom.setExifDate?.checked) {
    if (!isValidIsoDate(dom.sharedDate?.value)) dom.sharedDate.value = state.isoDate || state.uploadSelectedFiles[0]?.isoDate || '';
    if (isValidIsoDate(dom.sharedDate?.value)) applySharedUploadDate(dom.sharedDate.value);
  }
  updateUploadSharedDateUi();
  renderUploadPreviews();
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
  parent.children.push({ label: folderName, relativePath, displayPath: relativePath || '.', mediaCount: 0, latestModifiedMs: Date.now(), icon: 'folder', children: [], pending: true });
  parent.children.sort((a, b) => (b.latestModifiedMs || 0) - (a.latestModifiedMs || 0) || String(a.label || '').localeCompare(String(b.label || '')));
  return relativePath;
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
  localStorage.setItem('lifeserver-upload-target-v1', JSON.stringify({
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
  dom.addFilesButton?.classList.toggle('hidden', Boolean(state.uploadXhr));
  if (dom.uploadSubmit) dom.uploadSubmit.hidden = !state.uploadSelectedFiles.length && !state.uploadXhr;
  updateUploadSharedDateUi();
}

function focusPendingFolderInput() {
  if (!state.uploadCreatingFolder) return;
  requestAnimationFrame(() => {
    const input = document.getElementById('uploadNewFolderInput');
    if (input) {
      input.focus();
      input.select();
    }
  });
}

function renderPhotos() {
  dom.photoStrip.innerHTML = `
    <button id="editorUploadButton" class="editor-photo-thumb editor-upload-tile" type="button" aria-label="Upload media">
      ${renderPhIcon('upload-simple', { variant: 'bold' })}
      <span>Upload Media</span>
    </button>
  ` + state.photos.map((photo, index) => `
    <button class="editor-photo-thumb" type="button" data-photo-index="${index}">
      ${photo.type === 'video'
        ? `<video src="${photo.previewUrl || photo.thumbUrl}" muted autoplay loop playsinline preload="metadata" poster="${photo.thumbUrl || ''}" aria-hidden="true"></video><span class="editor-video-mark">${renderPhIcon('play-fill', { variant: 'fill' })}</span>`
        : `<img src="${photo.thumbUrl}" alt="${photo.fileName || ''}" />`}
    </button>
  `).join('');
  dom.uploadButton = document.getElementById('editorUploadButton');
  renderSubtitle();
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
  dom.viewerCanvas.classList.toggle('is-pannable', state.viewerZoom > 1.01);
}

function resetViewerTransform() {
  state.viewerZoom = 1;
  state.viewerPanX = 0;
  state.viewerPanY = 0;
  updateViewerTransform();
}

function setViewerZoom(nextZoom) {
  state.viewerZoom = clamp(nextZoom, 1, 6);
  if (state.viewerZoom === 1) {
    state.viewerPanX = 0;
    state.viewerPanY = 0;
  }
  updateViewerTransform();
}

function setViewerDetails(open) {
  state.viewerDetailsOpen = Boolean(open);
  dom.viewerDetails?.classList.toggle('open', state.viewerDetailsOpen);
  dom.viewer?.classList.toggle('details-open', state.viewerDetailsOpen);
  dom.viewerInfoToggle?.classList.toggle('is-active', state.viewerDetailsOpen);
  dom.viewerCanvas?.classList.add('details-transitioning');
  window.setTimeout(() => dom.viewerCanvas?.classList.remove('details-transitioning'), 320);
  updateViewerTransform();
}

function showViewerDateToast(text) {
  if (!dom.viewerDateToast || !text) return;
  dom.viewerDateToast.textContent = text;
  dom.viewerDateToast.classList.add('show');
  window.clearTimeout(state.viewerDateToastTimer);
  state.viewerDateToastTimer = window.setTimeout(() => {
    dom.viewerDateToast?.classList.remove('show');
  }, 2200);
}

function playViewerStepAnimation(direction) {
  const node = activeViewerNode();
  if (!node) return;
  node.classList.remove('slide-next', 'slide-prev');
  void node.offsetWidth;
  node.classList.add(direction > 0 ? 'slide-next' : 'slide-prev');
  window.setTimeout(() => node.classList.remove('slide-next', 'slide-prev'), 320);
}

function renderViewer(direction = 0) {
  const item = state.photos[state.viewerIndex];
  if (!item) return;
  renderViewerDetails();
  if (item.isoDate !== state.viewerLastShownDate) {
    showViewerDateToast(item.dateLabel || item.isoDate || '');
    state.viewerLastShownDate = item.isoDate || '';
  }
  state.viewerDescriptionDirty = false;
  dom.viewerLoading?.classList.remove('hidden');
  dom.viewerImage.classList.add('hidden');
  dom.viewerVideo.classList.add('hidden');
  dom.viewerVideo.pause();
  dom.viewerVideo.removeAttribute('src');
  dom.viewerVideo.load();
  resetViewerTransform();
  if (item.type === 'video') {
    dom.viewerVideo.classList.remove('hidden');
    dom.viewerVideo.src = item.fullUrl;
    dom.viewerVideo.poster = item.thumbUrl;
    dom.viewerVideo.load();
    dom.viewerVideo.onloadeddata = () => {
      dom.viewerLoading?.classList.add('hidden');
      updateViewerTransform();
    };
  } else {
    dom.viewerImage.classList.remove('hidden');
    dom.viewerImage.src = item.thumbUrl;
    dom.viewerImage.alt = item.fileName || 'Photo';
    const fullImage = new Image();
    fullImage.onload = () => {
      dom.viewerImage.src = item.fullUrl;
      dom.viewerLoading?.classList.add('hidden');
      updateViewerTransform();
    };
    fullImage.onerror = () => {
      dom.viewerLoading?.classList.add('hidden');
    };
    fullImage.src = item.fullUrl;
  }
  if (direction) playViewerStepAnimation(direction);
}

function openViewer(index) {
  mediaViewer.open(index, { forceDateToast: true });
  history.pushState({ editorViewer: true }, '', location.href);
}

async function saveViewerDescriptionIfNeeded() {
  await mediaViewer.saveDescriptionIfNeeded();
}

function closeViewer({ fromHistory = false } = {}) {
  if (!fromHistory && history.state?.editorViewer) {
    history.back();
    return;
  }
  mediaViewer.close({ animate: false });
}

async function stepViewer(direction) {
  await mediaViewer.step(direction);
}

async function deleteCurrentPhoto() {
  const item = state.photos[state.viewerIndex];
  if (!item) return;
  if (!window.confirm(`Delete ${item.fileName}?`)) return;
  const removedIndex = state.viewerIndex;
  state.photos = state.photos.filter((photo) => photo.id !== item.id);
  renderPhotos();
  if (!state.photos.length) {
    closeViewer({ fromHistory: true });
  } else {
    state.viewerIndex = Math.min(removedIndex, state.photos.length - 1);
    renderViewer();
  }
  try {
    await fetchJson(`/api/media/${item.id}`, { method: 'DELETE' });
  } catch (error) {
    await refreshEntryPhotos();
    throw error;
  }
}

async function saveEntry({ navigateOnSuccess = true, source = 'manual' } = {}) {
  if (state.saving) {
    if (navigateOnSuccess) state.navigateAfterSave = true;
    return;
  }
  clearAutoSaveTimer();
  state.autoSaveQueued = false;
  state.saving = true;
  if (navigateOnSuccess) state.navigateAfterSave = true;
  state.saveError = '';
  renderSubtitle();
  const raw = dom.textarea.value;
  let saveSucceeded = false;
  let payload = null;
  try {
    payload = await fetchJson(`/api/entry/${state.isoDate}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw })
    });
    saveSucceeded = true;
    state.loadedValue = raw;
    pushHistorySnapshot(true);
    return payload;
  } catch (error) {
    setStatus(error.message || 'Save failed', 'is-error');
  } finally {
    state.saving = false;
    if (saveSucceeded) {
      updateDirtyState();
      if (state.navigateAfterSave) {
        state.navigateAfterSave = false;
        if (payload?.day || state.photos.length) exitEditor();
        else window.location.href = '/';
        return;
      }
    } else {
      state.navigateAfterSave = false;
    }
    if (!navigateOnSuccess && saveSucceeded && state.dirty && state.autoSaveQueued) {
      state.autoSaveQueued = false;
      scheduleAutoSave(0);
    }
  }
}

async function loadEntry() {
  state.isoDate = getIsoDateFromPath();
  if (!state.isoDate) throw new Error('Invalid editor route.');
  const createSuffix = shouldCreateIfMissing() ? '?create=1' : '';
  const entry = await fetchJson(`/api/entry/${state.isoDate}${createSuffix}`, { cache: 'no-store' });
  state.title = entry.title;
  state.dateLabel = entry.dateLabel;
  dom.title.textContent = entry.title;
  dom.textarea.value = entry.raw || '';
  dom.textarea.placeholder = relativePlaceholder(state.isoDate, entry.dateLabel);
  setPreviewPlaceholder(dom.textarea.placeholder);
  state.photos = entry.photos || [];
  renderPhotos();
  state.loadedValue = dom.textarea.value;
  state.history = [];
  state.historyIndex = -1;
  pushHistorySnapshot(true);
  renderPreview();
  updateDirtyState();
  if (state.editorMode === 'preview') focusPreview();
  else dom.textarea.focus();
}

async function refreshEntryPhotos() {
  const entry = await fetchJson(`/api/entry/${state.isoDate}`, { cache: 'no-store' });
  state.photos = entry.photos || [];
  renderPhotos();
}

function handleBack() {
  if (state.dirty && !window.confirm('Leave without saving your changes?')) return;
  window.location.href = '/';
}

async function loadFolderRoots() {
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
        <span class="upload-folder-item-main">${renderPhIcon('folder-plus', { variant: 'duotone' })}<input id="uploadNewFolderInput" class="upload-folder-input" type="text" value="${state.uploadCreatingFolder.name || 'New Folder'}" /></span>
        <label class="upload-folder-item-meta upload-folder-confirm" aria-label="Create folder"><input id="uploadNewFolderConfirm" type="checkbox" />${renderPhIcon('check', { variant: 'bold' })}</label>
      </div>
    </div>
  ` : '';
  const icon = node.pending
    ? renderPhIcon('spinner-gap', { spin: true })
    : renderPhIcon(node.icon || 'folder', { variant: 'duotone' });
  const meta = `${node.mediaCount || 0}${modified ? ` · ${modified}` : ''}`;
  return `
    <div class="upload-folder-node depth-${depth}">
      <button class="upload-folder-item ${isSelected ? 'is-selected' : ''} ${node.pending ? 'is-pending' : ''}" type="button" style="padding-left:${12 + indent}px" data-upload-root="${rootId}" data-upload-path="${node.relativePath}">
        <span class="upload-folder-item-main">${icon}<span>${node.displayPath === '.' ? '(root)' : node.label}</span></span>
        <span class="upload-folder-item-meta">${meta}</span>
      </button>
      ${(node.children || []).map((child) => renderFolderNode(child, rootId, depth + 1)).join('')}
      ${createRow}
    </div>
  `;
}

function renderUploadPreviewsLegacy() {
  if (!dom.uploadPreviewList) return;
  const files = state.uploadSelectedFiles || [];
  const prefix = Boolean(dom.prefixDate?.checked);
  dom.uploadPreviewList.innerHTML = files.map((item) => {
    const file = item.file;
    const isVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(file.name);
    const displayName = uploadDisplayName(file.name, state.isoDate, prefix);
    return `<button class="upload-preview-card ${state.uploadXhr ? '' : 'is-removable'}" type="button" ${state.uploadXhr ? 'disabled' : ''} data-upload-remove="${item.id}" aria-label="Remove ${file.name}"><div class="upload-preview-thumb">${isVideo ? `<video src="${item.objectUrl}" muted playsinline preload="metadata"></video><span class="upload-preview-video">${renderPhIcon('play-fill', { variant: 'fill' })}</span>` : `<img src="${item.objectUrl}" alt="${file.name}" />`}${state.uploadXhr ? '' : `<span class="upload-preview-remove">${renderPhIcon('x', { variant: 'bold' })}</span>`}</div><div class="upload-preview-meta"><strong title="${displayName}">${displayName}</strong><span>EXIF date · ${formatUploadDateSummary(file, state.isoDate, prefix)}</span><span>Size · ${formatFileSize(file.size)}</span></div><div class="upload-preview-progress"><span class="upload-preview-progress-fill" data-upload-progress="${item.id}"></span></div></button>`;
  }).join('');
  updateUploadPreviewProgress();
}

function renderUploadPreviewsFilenameLegacy() {
  if (!dom.uploadPreviewList) return;
  const files = state.uploadSelectedFiles || [];
  const prefix = Boolean(dom.prefixDate?.checked);
  dom.uploadPreviewList.innerHTML = files.map((item) => {
    const file = item.file;
    const isVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(file.name);
    const displayName = uploadDisplayName(file.name, state.isoDate, prefix);
    const previewMedia = isVideo
      ? `<video src="${item.objectUrl}" muted playsinline preload="none"></video><span class="upload-preview-video">${renderPhIcon('play-fill', { variant: 'fill' })}</span>`
      : `<img src="${item.objectUrl}" alt="${file.name}" loading="lazy" decoding="async" />`;
    return `<button class="upload-preview-card ${state.uploadXhr ? '' : 'is-removable'}" type="button" ${state.uploadXhr ? 'disabled' : ''} data-upload-remove="${item.id}" aria-label="Remove ${file.name}"><div class="upload-preview-thumb">${previewMedia}${state.uploadXhr ? '' : `<span class="upload-preview-remove">${renderPhIcon('x', { variant: 'bold' })}</span>`}</div><div class="upload-preview-meta"><strong title="${displayName}">${displayName}</strong><span>EXIF date · ${formatUploadDateSummary(file, state.isoDate, prefix)}</span><span>Size · ${formatFileSize(file.size)}</span></div><div class="upload-preview-progress"><span class="upload-preview-progress-fill" data-upload-progress="${item.id}"></span></div></button>`;
  }).join('');
  updateUploadPreviewProgress();
}

function renderUploadPreviewsExifLegacy() {
  if (!dom.uploadPreviewList) return;
  const files = state.uploadSelectedFiles || [];
  const setExifDate = Boolean(dom.setExifDate?.checked);
  dom.uploadPreviewList.innerHTML = files.map((item) => {
    const file = item.file;
    const isVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(file.name);
    const displayName = uploadDisplayName(file.name);
    const previewMedia = isVideo
      ? `<video src="${item.objectUrl}" muted playsinline preload="none"></video><span class="upload-preview-video">${renderPhIcon('play-fill', { variant: 'fill' })}</span>`
      : `<img src="${item.objectUrl}" alt="${file.name}" loading="lazy" decoding="async" />`;
    return `<button class="upload-preview-card ${state.uploadXhr ? '' : 'is-removable'}" type="button" ${state.uploadXhr ? 'disabled' : ''} data-upload-remove="${item.id}" aria-label="Remove ${file.name}"><div class="upload-preview-thumb">${previewMedia}${state.uploadXhr ? '' : `<span class="upload-preview-remove">${renderPhIcon('x', { variant: 'bold' })}</span>`}</div><div class="upload-preview-meta"><strong title="${displayName}">${displayName}</strong><span>${formatUploadDateSummary(file, state.isoDate, setExifDate)}</span><span>Size Â· ${formatFileSize(file.size)}</span></div><div class="upload-preview-progress"><span class="upload-preview-progress-fill" data-upload-progress="${item.id}"></span></div></button>`;
  }).join('');
  updateUploadPreviewProgress();
}

function renderUploadPreviews() {
  if (!dom.uploadPreviewList) return;
  const files = state.uploadSelectedFiles || [];
  const setExifDate = Boolean(dom.setExifDate?.checked);
  dom.uploadPreviewList.innerHTML = files.map((item) => {
    const file = item.file;
    const isVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(file.name);
    const displayName = uploadDisplayName(file.name);
    const previewMedia = isVideo
      ? `<video src="${item.objectUrl}" muted playsinline preload="none"></video><span class="upload-preview-video">${renderPhIcon('play-fill', { variant: 'fill' })}</span>`
      : `<img src="${item.objectUrl}" alt="${file.name}" loading="lazy" decoding="async" />`;
    return `<button class="upload-preview-card ${state.uploadXhr ? '' : 'is-removable'}" type="button" ${state.uploadXhr ? 'disabled' : ''} data-upload-remove="${item.id}" aria-label="Remove ${file.name}"><div class="upload-preview-thumb">${previewMedia}${state.uploadXhr ? '' : `<span class="upload-preview-remove">${renderPhIcon('x', { variant: 'bold' })}</span>`}</div><div class="upload-preview-meta"><strong title="${displayName}">${displayName}</strong><span>${formatUploadDateSummary(file, state.isoDate, setExifDate)}</span><span>Size - ${formatFileSize(file.size)}</span></div><div class="upload-preview-progress"><span class="upload-preview-progress-fill" data-upload-progress="${item.id}"></span></div></button>`;
  }).join('');
  updateUploadPreviewProgress();
}

function renderFolderTree() {
  const roots = state.uploadXhr
    ? state.folderRoots.filter((root) => root.rootId === state.uploadTarget.rootId)
    : state.folderRoots;
  dom.folderTree.innerHTML = roots.map((root) => `
    <div class="upload-folder-root ${root.rootId === state.uploadTarget.rootId ? 'is-active-root' : ''}">
      <div style="font-weight:700; margin: 6px 0;">${renderPhIcon('hard-drives', { variant: 'duotone' })} ${root.rootLabel} <span class="upload-folder-root-count">${root.tree.mediaCount || 0}</span></div>
      ${renderFolderNode(root.tree, root.rootId)}
    </div>
  `).join('');
  const root = state.folderRoots.find((item) => item.rootId === state.uploadTarget.rootId) || state.folderRoots[0];
  const node = root ? findFolderNode(root.rootId, state.uploadTarget.relativePath || '') : null;
  dom.folderLabel.textContent = node?.label || root?.rootLabel || 'No photo folders configured';
  focusPendingFolderInput();
}

async function openUploadModal() {
  dom.uploadTitle.textContent = `Add media for ${state.dateLabel || state.isoDate}`;
  if (!state.uploadXhr) {
    state.uploadProgressRatio = 0;
    dom.setExifDate.checked = true;
    dom.uploadSubmit.style.setProperty('--upload-progress', '0%');
    updateUploadButtonLabel();
    dom.uploadCancel?.classList.add('hidden');
  }
  if (!state.folderRoots.length) await loadFolderRoots();
  updateUploadDateToggleLabel();
  renderFolderTree();
  renderUploadPreviews();
  updateUploadUiState();
  dom.folderTree.classList.remove('is-open');
  dom.uploadModal.classList.remove('hidden');
  dom.uploadResume?.classList.add('hidden');
}

function closeUploadModal() {
  if (state.uploadXhr) {
    dom.uploadModal.classList.add('hidden');
    dom.uploadResumeLabel.textContent = dom.uploadSubmitLabel?.textContent || 'Uploading…';
    dom.uploadResume?.classList.remove('hidden');
    if (!mediaViewer.isOpen()) document.body.classList.remove('viewer-open');
    return;
  }
  dom.uploadModal.classList.add('hidden');
  state.uploadCreatingFolder = null;
  clearUploadSelection();
  renderUploadPreviews();
  updateUploadUiState();
  if (!mediaViewer.isOpen()) document.body.classList.remove('viewer-open');
}

function promptNewFolder() {
  state.uploadCreatingFolder = {
    rootId: state.uploadTarget.rootId || (state.folderRoots[0]?.rootId || '0'),
    parentPath: state.uploadTarget.relativePath || '',
    name: 'New Folder'
  };
  dom.folderTree?.classList.add('is-open');
  renderFolderTree();
}

async function commitNewFolder() {
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
  renderFolderTree();
  try {
    const payload = await fetchJson('/api/upload/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootId, relativePath: parentPath, folderName: optimisticName })
    });
    await loadFolderRoots();
    state.uploadTarget = { rootId, relativePath: payload.relativePath === '.' ? '' : payload.relativePath };
    persistUploadTarget();
    renderFolderTree();
  } catch (error) {
    await loadFolderRoots();
    renderFolderTree();
    throw error;
  }
}

function cancelUpload() {
  if (!state.uploadXhr) return;
  state.uploadXhr.abort();
}

function uploadFiles() {
  const files = state.uploadSelectedFiles.length ? state.uploadSelectedFiles.map((item) => item.file) : Array.from(dom.fileInput.files || []);
  if (!files.length) return;
  const form = new FormData();
  form.append('rootId', state.uploadTarget.rootId || '0');
  form.append('relativePath', state.uploadTarget.relativePath || '');
  form.append('targetIsoDate', state.isoDate);
  form.append('setExifDate', dom.setExifDate.checked ? '1' : '0');
  files.forEach((file) => form.append('files', file));

  state.uploadProgressRatio = 0;
  const xhr = new XMLHttpRequest();
  state.uploadXhr = xhr;
  dom.uploadSubmit.disabled = true;
  dom.uploadSubmit.style.setProperty('--upload-progress', '0%');
  if (dom.uploadSubmitLabel) dom.uploadSubmitLabel.textContent = `Uploading ${files.length} file${files.length === 1 ? '' : 's'} · 0%`;
  dom.uploadCancel?.classList.remove('hidden');
  updateUploadUiState();
  renderFolderTree();
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
      if (dom.uploadSubmitLabel) dom.uploadSubmitLabel.textContent = payload.error || 'Upload failed';
      updateUploadUiState();
      renderFolderTree();
      updateUploadPreviewProgress();
      return;
    }
    dom.uploadSubmit.style.setProperty('--upload-progress', '100%');
    if (dom.uploadSubmitLabel) dom.uploadSubmitLabel.textContent = `Uploaded ${payload.count || files.length} file${(payload.count || files.length) === 1 ? '' : 's'}`;
    clearUploadSelection();
    updateUploadUiState();
    renderFolderTree();
    renderUploadPreviews();
    await refreshEntryPhotos();
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
    renderFolderTree();
    updateUploadPreviewProgress();
  });
  xhr.addEventListener('error', () => {
    state.uploadXhr = null;
    state.uploadProgressRatio = 0;
    dom.uploadSubmit.disabled = false;
    dom.uploadCancel?.classList.add('hidden');
    if (dom.uploadSubmitLabel) dom.uploadSubmitLabel.textContent = 'Upload failed';
    updateUploadUiState();
    renderFolderTree();
    updateUploadPreviewProgress();
  });
  xhr.send(form);
}

function renderViewerDetails() {
  const item = state.photos[state.viewerIndex];
  if (!item || !dom.viewerDetailsMeta) return;
  const folder = `${item.folderRootLabel || ''}${item.folder && item.folder !== '.' ? ` / ${item.folder}` : ''}`.trim();
  dom.viewerDetailsMeta.innerHTML = [
    ['File', item.fileName || '—'],
    ['Type', item.type === 'video' ? 'Video' : 'Photo'],
    ['Date', item.capturedAt ? new Date(item.capturedAt).toLocaleString() : '—'],
    ['Folder', folder || '—']
  ].map(([label, value]) => `<div class="viewer-meta-row"><span>${label}</span><strong>${value}</strong></div>`).join('');
  if (dom.viewerTagsInput) dom.viewerTagsInput.value = (item.tags || []).join(', ');
  if (dom.viewerDescriptionInput) dom.viewerDescriptionInput.innerHTML = item.description || '';
  state.viewerDescriptionDirty = false;
}

async function saveViewerTags() {
  const item = state.photos[state.viewerIndex];
  if (!item) return;
  const tags = (dom.viewerTagsInput?.value || '').split(',').map((part) => part.trim()).filter(Boolean);
  const payload = await fetchJson(`/api/media/${item.id}/tags`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tags }) });
  item.tags = payload.tags || [];
  renderViewerDetails();
}
window.addEventListener('beforeunload', (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

function renderUploadPreviews() {
  if (!dom.uploadPreviewList) return;
  const files = state.uploadSelectedFiles || [];
  dom.uploadPreviewList.innerHTML = files.map((item) => {
    const file = item.file;
    const isVideo = /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(file.name);
    const displayName = uploadDisplayName(file.name);
    const previewMedia = isVideo
      ? `<video src="${item.objectUrl}" muted playsinline preload="none"></video><span class="upload-preview-video">${renderPhIcon('play-fill', { variant: 'fill' })}</span>`
      : `<img src="${item.objectUrl}" alt="${file.name}" loading="lazy" decoding="async" />`;
    return `<div class="upload-preview-card ${state.uploadXhr ? '' : 'is-removable'}"><div class="upload-preview-thumb">${previewMedia}${state.uploadXhr ? '' : `<button class="upload-preview-remove" type="button" data-upload-remove="${item.id}" aria-label="Remove ${displayName}">${renderPhIcon('x', { variant: 'bold' })}</button>`}</div><div class="upload-preview-meta"><div class="upload-preview-meta-row"><div class="upload-preview-meta-copy"><strong title="${displayName}">${displayName}</strong><span>${uploadDateSourceLabel(item)}</span><span>Size · ${formatFileSize(file.size)}</span></div><button class="upload-preview-date" type="button" data-upload-date-trigger="${item.id}" aria-label="Change date for ${displayName}">${renderPhIcon('calendar-dots', { variant: 'duotone' })}<strong title="${displayName}">${monthDayLabel(item.isoDate) || 'No date'}</strong></button><input class="upload-preview-date-input" type="date" data-upload-date-input="${item.id}" value="${item.isoDate || ''}" /></div><div class="upload-preview-progress"><span class="upload-preview-progress-fill" data-upload-progress="${item.id}"></span></div></div></div>`;
  }).join('');
  updateUploadPreviewProgress();
}

async function openUploadModal() {
  dom.uploadTitle.textContent = `Add media for ${state.dateLabel || state.isoDate}`;
  if (!state.uploadXhr) {
    state.uploadProgressRatio = 0;
    dom.setExifDate.checked = false;
    if (dom.sharedDate) dom.sharedDate.value = state.isoDate || '';
    dom.uploadSubmit.style.setProperty('--upload-progress', '0%');
    updateUploadButtonLabel();
    dom.uploadCancel?.classList.add('hidden');
  }
  if (!state.folderRoots.length) await loadFolderRoots();
  updateUploadDateToggleLabel();
  renderFolderTree();
  renderUploadPreviews();
  updateUploadUiState();
  dom.folderTree.classList.remove('is-open');
  dom.uploadModal.classList.remove('hidden');
  dom.uploadResume?.classList.add('hidden');
  document.body.classList.add('viewer-open');
}

function uploadFiles() {
  const files = state.uploadSelectedFiles.length ? state.uploadSelectedFiles.map((item) => item.file) : Array.from(dom.fileInput.files || []);
  if (!files.length) return;
  const fileDates = state.uploadSelectedFiles.map((item) => item.isoDate || state.isoDate || '');
  const form = new FormData();
  form.append('rootId', state.uploadTarget.rootId || '0');
  form.append('relativePath', state.uploadTarget.relativePath || '');
  form.append('targetIsoDate', state.isoDate);
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
  renderFolderTree();
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
      renderFolderTree();
      updateUploadPreviewProgress();
      return;
    }
    dom.uploadSubmit.style.setProperty('--upload-progress', '100%');
    if (dom.uploadSubmitLabel) dom.uploadSubmitLabel.textContent = `Uploaded ${payload.count || files.length} file${(payload.count || files.length) === 1 ? '' : 's'}`;
    clearUploadSelection();
    updateUploadUiState();
    renderFolderTree();
    renderUploadPreviews();
    await loadEntry();
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
    renderFolderTree();
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
    renderFolderTree();
    updateUploadPreviewProgress();
  });
  xhr.send(form);
}

dom.backButton.addEventListener('click', handleBack);
dom.undoButton.addEventListener('click', undo);
dom.redoButton.addEventListener('click', redo);
dom.saveButton.addEventListener('click', handleSaveButtonClick);
dom.uploadClose.addEventListener('click', closeUploadModal);
dom.uploadBackdrop.addEventListener('click', closeUploadModal);
dom.newFolderButton?.addEventListener('click', () => promptNewFolder());
dom.setExifDate?.addEventListener('change', handleUploadSharedDateToggle);
dom.sharedDate?.addEventListener('change', () => {
  if (!dom.setExifDate?.checked || !isValidIsoDate(dom.sharedDate?.value)) return;
  applySharedUploadDate(dom.sharedDate.value);
  renderUploadPreviews();
});
dom.uploadCancel?.addEventListener('click', cancelUpload);
dom.addFilesButton?.addEventListener('click', () => dom.fileInput.click());
dom.fileInput?.addEventListener('change', () => {
  const files = Array.from(dom.fileInput.files || []);
  if (!files.length) return;
  state.uploadProgressRatio = 0;
  dom.uploadSubmit?.style.setProperty('--upload-progress', '0%');
  setUploadPreparing(true);
  openUploadModal()
    .then(() => nextFrame())
    .then(async () => {
      await appendUploadFiles(files);
    })
    .catch((error) => setStatus(error.message, 'is-error'))
    .finally(() => {
      setUploadPreparing(false);
      updateUploadUiState();
      if (dom.fileInput) dom.fileInput.value = '';
    });
});
dom.uploadResume?.addEventListener('click', () => openUploadModal().catch((error) => setStatus(error.message, 'is-error')));
dom.folderButton.addEventListener('click', () => dom.folderTree.classList.toggle('is-open'));
dom.folderTree.addEventListener('click', (event) => {
  const confirm = event.target.closest('.upload-folder-confirm');
  if (confirm) {
    event.preventDefault();
    commitNewFolder().catch((error) => setStatus(error.message, 'is-error'));
    return;
  }
  const item = event.target.closest('[data-upload-root]');
  if (!item) return;
  state.uploadTarget = { rootId: item.dataset.uploadRoot, relativePath: item.dataset.uploadPath || '' };
  persistUploadTarget();
  state.uploadCreatingFolder = null;
  renderFolderTree();
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
dom.folderTree.addEventListener('input', (event) => {
  if (event.target?.id === 'uploadNewFolderInput' && state.uploadCreatingFolder) state.uploadCreatingFolder.name = event.target.value;
});
dom.folderTree.addEventListener('keydown', (event) => {
  if (event.target?.id !== 'uploadNewFolderInput') return;
  if (event.key === 'Enter') {
    event.preventDefault();
    commitNewFolder().catch((error) => setStatus(error.message, 'is-error'));
  } else if (event.key === 'Escape') {
    state.uploadCreatingFolder = null;
    renderFolderTree();
  }
});
dom.uploadSubmit.addEventListener('click', uploadFiles);
dom.modeButtons.forEach((button) => {
  button.addEventListener('click', () => setEditorMode(button.dataset.editorMode));
});
dom.textarea.addEventListener('input', () => {
  if (!state.applyFromHistory) scheduleHistorySnapshot();
  updateDirtyState();
  scheduleAutoSave();
});
dom.photoStrip.addEventListener('click', (event) => {
  const uploadButton = event.target.closest('#editorUploadButton');
  if (uploadButton) {
    dom.addFilesButton.click();
    return;
  }
  const button = event.target.closest('[data-photo-index]');
  if (!button) return;
  openViewer(Number(button.dataset.photoIndex));
});

document.addEventListener('keydown', (event) => {
  const isMeta = event.metaKey || event.ctrlKey;
  if (mediaViewer.isOpen()) return;
  if (isMeta && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveEntry();
    return;
  }
  if (isMeta && !event.shiftKey && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    undo();
    return;
  }
  if ((isMeta && event.shiftKey && event.key.toLowerCase() === 'z') || (isMeta && event.key.toLowerCase() === 'y')) {
    event.preventDefault();
    redo();
  }
});

window.addEventListener('popstate', (event) => {
  if (!dom.viewer.classList.contains('hidden')) {
    closeViewer({ fromHistory: true });
  }
});

applyTheme();
updateModeButtons();
loadEntry().catch((error) => {
  setStatus(error.message || 'Failed to load entry', 'is-error');
});
