(function initMediaViewerGlobal() {
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function phosphorFamily(variant = 'regular') {
    if (variant === 'fill') return 'ph-fill';
    if (variant === 'duotone') return 'ph-duotone';
    if (variant === 'bold') return 'ph-bold';
    return 'ph';
  }

  function renderPhIcon(name, { variant = 'regular', className = '', spin = false } = {}) {
    const classes = [phosphorFamily(variant), `ph-${name}`];
    if (className) classes.push(className);
    if (spin) classes.push('is-spinning');
    return `<i class="${classes.join(' ')}" aria-hidden="true"></i>`;
  }

  window.renderPhIcon = renderPhIcon;

  function formatFileSize(bytes) {
    const size = Number(bytes || 0);
    if (!size) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = size;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
  }

  function isTextEntryField(node) {
    return node instanceof Element
      && Boolean(node.closest('input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="date"]), textarea, select, option'));
  }

  function normalizeTag(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function tokenizeTags(value) {
    return Array.from(new Set(String(value || '')
      .split(',')
      .map((part) => normalizeTag(part))
      .filter(Boolean)));
  }

  function normalizeDescriptionText(value) {
    return String(value || '')
      .replace(/\r/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function defaultDetailRows(item) {
    const folderText = `${item?.folderRootLabel || ''}${item?.folder && item.folder !== '.' ? ` / ${item.folder}` : ''}`.trim() || '-';
    return [
      ['File', item?.fileName || '-'],
      ['Type', item?.type === 'video' ? 'Video' : 'Photo'],
      ['Date Source', item?.dateSource || '-'],
      ['Folder', folderText],
      ['Tags', Array.isArray(item?.tags) && item.tags.length ? item.tags.join(', ') : '-'],
      ['Size', formatFileSize(item?.size) || '-']
    ];
  }

  const MEDIA_ROUTE_CONFIG = [
    { prefix: '/media/thumb/', cacheName: 'lifeserver-media-thumb-v2', kind: 'thumb', maxEntries: 50 },
    { prefix: '/media/preview/', cacheName: 'lifeserver-media-thumb-v2', kind: 'thumb', maxEntries: 50 },
    { prefix: '/media/journal-inline/', cacheName: 'lifeserver-media-thumb-v2', kind: 'thumb', maxEntries: 50 },
    { prefix: '/media/full/', cacheName: 'lifeserver-media-full-v2', kind: 'full', maxEntries: 6 }
  ];

  function getMediaRouteConfigForUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value, window.location.href);
      if (url.origin !== window.location.origin) return null;
      return MEDIA_ROUTE_CONFIG.find((entry) => url.pathname.startsWith(entry.prefix)) || null;
    } catch (error) {
      return null;
    }
  }

  function createMediaAssetCache() {
    const inflight = new Map();
    const objectUrlEntries = new Map();
    let serviceWorkerRegistrationPromise = null;

    const canUseServiceWorker = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
    const canUseCacheStorage = () => typeof window !== 'undefined' && 'caches' in window;
    const normalizeUrl = (value) => {
      try {
        return new URL(value, window.location.href).href;
      } catch (error) {
        return '';
      }
    };
    const getKindLimit = (kind) => (kind === 'full' ? 6 : 50);

    const touchObjectUrlEntry = (cacheKey) => {
      const entry = objectUrlEntries.get(cacheKey);
      if (!entry) return;
      objectUrlEntries.delete(cacheKey);
      objectUrlEntries.set(cacheKey, entry);
    };

    const trimObjectUrls = (kind) => {
      const limit = getKindLimit(kind);
      const keys = Array.from(objectUrlEntries.keys())
        .filter((cacheKey) => objectUrlEntries.get(cacheKey)?.kind === kind);
      while (keys.length > limit) {
        const oldest = keys.shift();
        const entry = oldest ? objectUrlEntries.get(oldest) : null;
        if (oldest) objectUrlEntries.delete(oldest);
        if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl);
      }
    };

    const trimCacheStorage = async (cacheName, maxEntries) => {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      const excess = keys.length - maxEntries;
      if (excess <= 0) return;
      await Promise.all(keys.slice(0, excess).map((cachedRequest) => cache.delete(cachedRequest)));
    };

    const registerServiceWorker = () => {
      if (!canUseServiceWorker()) return Promise.resolve(null);
      if (serviceWorkerRegistrationPromise) return serviceWorkerRegistrationPromise;
      serviceWorkerRegistrationPromise = navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
        .then((registration) => {
          if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            if (!worker) return;
            worker.addEventListener('statechange', () => {
              if (worker.state === 'installed' && registration.waiting) {
                registration.waiting.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });
          return registration;
        })
        .catch((error) => {
          console.warn('Service worker registration failed.', error);
          return null;
        });
      return serviceWorkerRegistrationPromise;
    };

    const fetchCachedResponse = async (value, { fallbackFetch = false } = {}) => {
      const url = normalizeUrl(value);
      const route = getMediaRouteConfigForUrl(url);
      if (!url || !route) return null;

      const cacheKey = `${route.cacheName}:${url}`;
      if (inflight.has(cacheKey)) return inflight.get(cacheKey);

      const pending = (async () => {
        if (!canUseCacheStorage()) {
          if (!fallbackFetch) return null;
          try {
            const response = await fetch(url, { credentials: 'same-origin' });
            return response.ok ? response : null;
          } catch (error) {
            return null;
          }
        }

        try {
          const cache = await caches.open(route.cacheName);
          const cached = await cache.match(url, { ignoreVary: true });
          if (cached) return cached;

          const response = await fetch(url, { credentials: 'same-origin' });
          if (!response.ok || response.status !== 200) return null;
          await cache.put(url, response.clone());
          await trimCacheStorage(route.cacheName, route.maxEntries);
          return response;
        } catch (error) {
          console.warn('Media cache warm failed.', error);
          return null;
        }
      })().finally(() => {
        inflight.delete(cacheKey);
      });

      inflight.set(cacheKey, pending);
      return pending;
    };

    return {
      registerServiceWorker,
      warm(urls, options = {}) {
        const list = Array.isArray(urls) ? urls : [urls];
        return Promise.all(list.filter(Boolean).map((value) => fetchCachedResponse(value, options).then(Boolean)));
      },
      async getObjectUrl(url, options = {}) {
        const normalizedUrl = normalizeUrl(url);
        const route = getMediaRouteConfigForUrl(normalizedUrl);
        if (!normalizedUrl || !route) return '';

        const cacheKey = `${route.kind}:${normalizedUrl}`;
        const existing = objectUrlEntries.get(cacheKey);
        if (existing?.objectUrl) {
          touchObjectUrlEntry(cacheKey);
          return existing.objectUrl;
        }

        const response = await fetchCachedResponse(normalizedUrl, options);
        if (!response) return '';
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        objectUrlEntries.set(cacheKey, {
          kind: route.kind,
          objectUrl
        });
        trimObjectUrls(route.kind);
        return objectUrl;
      },
      peekObjectUrl(url) {
        const normalizedUrl = normalizeUrl(url);
        const route = getMediaRouteConfigForUrl(normalizedUrl);
        if (!normalizedUrl || !route) return '';
        const cacheKey = `${route.kind}:${normalizedUrl}`;
        const existing = objectUrlEntries.get(cacheKey);
        if (!existing?.objectUrl) return '';
        touchObjectUrlEntry(cacheKey);
        return existing.objectUrl;
      }
    };
  }

  const mediaAssetCache = window.mediaAssetCache || createMediaAssetCache();
  window.mediaAssetCache = mediaAssetCache;
  void mediaAssetCache.registerServiceWorker();

  class MediaViewer {
    constructor(options = {}) {
      this.options = options;
      this.state = {
        index: -1,
        loadToken: 0,
        animationToken: 0,
        zoom: 1,
        panX: 0,
        panY: 0,
        pointers: new Map(),
        primaryPointerId: null,
        primaryGesture: null,
        pinchStartDistance: null,
        pinchStartZoom: 1,
        velocityX: 0,
        velocityY: 0,
        momentumFrame: null,
        chromeVisible: true,
        detailsOpen: false,
        detailsProgress: 0,
        detailsAnimationTimer: 0,
        stageSettleTimer: 0,
        detailsTouchId: null,
        detailsTouchGesture: null,
        detailsPointerGesture: null,
        swipeOffsetX: 0,
        dismissOffsetY: 0,
        wheelLastDeltaY: 0,
        wheelCommitTimer: 0,
        closing: false,
        descriptionDirty: false,
        descriptionSaving: false,
        descriptionSaveTimer: 0,
        likeSaving: false,
        fieldSaving: '',
        folderRoots: [],
        folderModalOpen: false,
        folderLoading: false,
        selectedFolderRootId: '',
        selectedFolderPath: '',
        folderModalRootId: '',
        folderModalPath: '',
        folderMoveSubmitting: false,
        lastRenderedDetailsOpen: false,
        fileNameValidationState: 'idle',
        fileNameValidationTimer: 0,
        fileNameValidationToken: 0,
        previewHideTimer: 0,
        saveQueue: Promise.resolve(),
        suppressClickUntil: 0,
        pendingCloseRequest: null,
        closeAnimationTimer: 0,
        carouselAnimating: false,
        carouselAnimationDirection: 0,
        carouselAnimationTimer: 0,
        carouselDragOffsetX: 0,
        carouselTranslateX: 0,
        renderedIndexes: [],
        loadedFullMedia: new Set(),
        pendingFullImageLoads: new Map(),
        backgroundPreloadQueue: [],
        backgroundPreloadQueuedIds: new Set(),
        backgroundPreloadActive: 0,
        loadingActive: false,
        dateStatusItemsRef: null,
        dateStatusCache: new Map()
      };

      this.handleResize = this.handleResize.bind(this);
      this.handleKeydown = this.handleKeydown.bind(this);
      this.handleCarouselTransitionEnd = this.handleCarouselTransitionEnd.bind(this);
      this.handleStagePointerMove = this.handleStagePointerMove.bind(this);
      this.handleStagePointerEnd = this.handleStagePointerEnd.bind(this);
      this.handleDetailsTouchMove = this.handleDetailsTouchMove.bind(this);
      this.handleDetailsTouchEnd = this.handleDetailsTouchEnd.bind(this);
      this.handleDetailsPointerMove = this.handleDetailsPointerMove.bind(this);
      this.handleDetailsPointerEnd = this.handleDetailsPointerEnd.bind(this);
      this.carouselSlots = new Map();

      this.root = document.createElement('div');
      this.root.className = 'photo-viewer hidden';
      this.root.setAttribute('role', 'dialog');
      this.root.setAttribute('aria-modal', 'true');
      this.root.setAttribute('aria-label', options.ariaLabel || 'Media viewer');
      this.root.innerHTML = `
        <div class="viewer-backdrop" data-role="backdrop"></div>
        <div class="viewer-layout">
          <section class="viewer-shell">
            <header class="viewer-topbar">
              <button class="viewer-close viewer-download-button" data-role="download" type="button" aria-label="Download media">
                ${renderPhIcon('download-simple', { variant: 'bold' })}
              </button>
              <div class="viewer-status">
                <p class="viewer-status-count" data-role="count"></p>
                <p class="viewer-status-caption" data-role="caption"></p>
              </div>
              <button class="viewer-close" data-role="close" type="button" aria-label="Close viewer">
                ${renderPhIcon('x', { variant: 'bold' })}
              </button>
            </header>

            <button class="viewer-nav viewer-nav-left" data-role="prev" type="button" aria-label="Previous media">
              ${renderPhIcon('caret-left', { variant: 'bold' })}
            </button>

            <div class="viewer-stage" data-role="stage">
              <div class="viewer-carousel" data-role="carousel">
                <div class="viewer-carousel-track" data-role="carousel-track">
                  <div class="viewer-media-frame" data-role="media-frame">
                    <div class="viewer-canvas" data-role="canvas">
                      <img class="viewer-image hidden" data-role="image" alt="Selected media" draggable="false" />
                      <video class="viewer-video hidden" data-role="video" controls playsinline preload="metadata" draggable="false"></video>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <button class="viewer-nav viewer-nav-right" data-role="next" type="button" aria-label="Next media">
              ${renderPhIcon('caret-right', { variant: 'bold' })}
            </button>

            <p class="viewer-description-summary hidden" data-role="description-summary"></p>

            <div class="viewer-toolbar">
              <button class="viewer-tool viewer-info-button" data-role="info" type="button" aria-label="Show media details">
                ${renderPhIcon('info', { variant: 'duotone' })}
              </button>
              <button class="viewer-tool viewer-like-button" data-role="like" type="button" aria-label="Like media">
                ${renderPhIcon('heart', { variant: 'regular' })}
              </button>
              <button class="viewer-tool hidden" data-role="share" type="button" aria-label="Share media">
                ${renderPhIcon('share-network', { variant: 'duotone' })}
              </button>
              <button class="viewer-tool viewer-delete-button hidden" data-role="delete" type="button" aria-label="Delete media">
                ${renderPhIcon('trash', { variant: 'duotone' })}
              </button>
              <div class="viewer-zoom-toolbar">
                <button class="viewer-tool" data-role="zoom-out" type="button" aria-label="Zoom out">
                  ${renderPhIcon('magnifying-glass-minus', { variant: 'duotone' })}
                </button>
                <button class="viewer-tool viewer-tool-percent" data-role="zoom-reset" type="button" aria-label="Reset zoom">100%</button>
                <button class="viewer-tool" data-role="zoom-in" type="button" aria-label="Zoom in">
                  ${renderPhIcon('magnifying-glass-plus', { variant: 'duotone' })}
                </button>
              </div>
            </div>
          </section>

          <aside class="viewer-details" data-role="details">
            <div class="viewer-details-handle" data-role="details-handle"></div>
            <div class="viewer-details-grid">
              <label class="viewer-field viewer-field-filename">
                <span class="viewer-field-control viewer-field-control-inline">
                  <input class="viewer-text-input" data-role="file-name" type="text" spellcheck="false" />
                  <strong class="viewer-field-suffix" data-role="file-extension"></strong>
                </span>
              </label>

              <label class="viewer-field viewer-field-description">
                <span class="viewer-field-control">
                  <textarea class="viewer-textarea" data-role="description" rows="5" placeholder="Add a note about this memory"></textarea>
                </span>
              </label>

              <div class="viewer-field">
                <span class="viewer-field-control viewer-field-control-inline">
                  <button class="viewer-picker-button" data-role="folder-trigger" type="button">${renderPhIcon('folder-open', { variant: 'duotone' })}<span data-role="folder-label"></span></button>
                </span>
              </div>

              <label class="viewer-field">
                <span class="viewer-field-label">Date</span>
                <span class="viewer-field-control viewer-field-control-inline">
                  <input class="viewer-date-input" data-role="date-input" type="date" />
                </span>
              </label>

              <label class="viewer-field">
                <span class="viewer-field-label">Time</span>
                <span class="viewer-field-control viewer-field-control-inline">
                  <input class="viewer-date-input" data-role="time-input" type="time" />
                </span>
              </label>

              <div class="viewer-field viewer-field-static">
                <span class="viewer-field-label">Resolution / Size</span>
                <strong class="viewer-field-static-value" data-role="details-meta"></strong>
              </div>
            </div>
          </aside>
        </div>

        <div class="viewer-modal hidden" data-role="folder-modal" aria-hidden="true">
          <div class="viewer-modal-backdrop" data-role="folder-modal-backdrop"></div>
          <div class="viewer-modal-card" role="dialog" aria-modal="true" aria-label="Choose destination folder">
            <div class="viewer-modal-head">
              <div>
                <p class="viewer-modal-kicker">Folder</p>
                <h3 class="viewer-modal-title">Choose a destination</h3>
              </div>
            </div>
            <div class="viewer-folder-tree upload-folder-tree" data-role="folder-tree"></div>
            <div class="viewer-modal-actions">
              <button class="viewer-inline-action" data-role="folder-cancel" type="button">Cancel</button>
              <button class="viewer-inline-action viewer-inline-action-strong" data-role="folder-move" type="button">Move</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(this.root);

      this.dom = {
        backdrop: this.root.querySelector('[data-role="backdrop"]'),
        close: this.root.querySelector('[data-role="close"]'),
        download: this.root.querySelector('[data-role="download"]'),
        deleteButton: this.root.querySelector('[data-role="delete"]'),
        info: this.root.querySelector('[data-role="info"]'),
        like: this.root.querySelector('[data-role="like"]'),
        share: this.root.querySelector('[data-role="share"]'),
        prev: this.root.querySelector('[data-role="prev"]'),
        next: this.root.querySelector('[data-role="next"]'),
        stage: this.root.querySelector('[data-role="stage"]'),
        carousel: this.root.querySelector('[data-role="carousel"]'),
        carouselTrack: this.root.querySelector('[data-role="carousel-track"]'),
        mediaFrame: this.root.querySelector('[data-role="media-frame"]'),
        canvas: this.root.querySelector('[data-role="canvas"]'),
        image: this.root.querySelector('[data-role="image"]'),
        video: this.root.querySelector('[data-role="video"]'),
        details: this.root.querySelector('[data-role="details"]'),
        detailsHandle: this.root.querySelector('[data-role="details-handle"]'),
        detailsMeta: this.root.querySelector('[data-role="details-meta"]'),
        fileName: this.root.querySelector('[data-role="file-name"]'),
        fileExtension: this.root.querySelector('[data-role="file-extension"]'),
        description: this.root.querySelector('[data-role="description"]'),
        folderTrigger: this.root.querySelector('[data-role="folder-trigger"]'),
        folderLabel: this.root.querySelector('[data-role="folder-label"]'),
        dateInput: this.root.querySelector('[data-role="date-input"]'),
        timeInput: this.root.querySelector('[data-role="time-input"]'),
        zoomIn: this.root.querySelector('[data-role="zoom-in"]'),
        zoomOut: this.root.querySelector('[data-role="zoom-out"]'),
        zoomReset: this.root.querySelector('[data-role="zoom-reset"]'),
        count: this.root.querySelector('[data-role="count"]'),
        caption: this.root.querySelector('[data-role="caption"]'),
        descriptionSummary: this.root.querySelector('[data-role="description-summary"]'),
        folderModal: this.root.querySelector('[data-role="folder-modal"]'),
        folderModalBackdrop: this.root.querySelector('[data-role="folder-modal-backdrop"]'),
        folderCancel: this.root.querySelector('[data-role="folder-cancel"]'),
        folderMove: this.root.querySelector('[data-role="folder-move"]'),
        folderTree: this.root.querySelector('[data-role="folder-tree"]')
      };

      if (typeof this.options.onDelete === 'function') {
        this.dom.deleteButton.classList.remove('hidden');
      }
      this.updateShareButtonVisibility();
      if (typeof this.options.onMove !== 'function') this.dom.folderTrigger.disabled = true;
      if (typeof this.options.onSaveDateTime !== 'function') {
        this.dom.dateInput.disabled = true;
        this.dom.timeInput.disabled = true;
      }

      this.attachEvents();
      this.applyStageGesture();
      this.applyChromeState({ immediate: true });
      this.applyDetailsProgress(0, { immediate: true });
      this.setDescriptionValue('');
    }

    attachEvents() {
      this.dom.close.addEventListener('click', () => this.requestClose('button'));
      this.dom.download.addEventListener('click', () => {
        this.downloadCurrent().catch((error) => this.handleError(error));
      });
      this.dom.info.addEventListener('click', () => this.commitDetails(!this.state.detailsOpen));
      this.dom.like.addEventListener('click', () => {
        this.toggleLike().catch((error) => this.handleError(error));
      });
      this.dom.share.addEventListener('click', () => {
        this.shareCurrent().catch((error) => this.handleError(error));
      });
      this.dom.deleteButton.addEventListener('click', () => {
        if (typeof this.options.onDelete !== 'function') return;
        Promise.resolve(this.options.onDelete(this.getCurrentItem(), this.state.index, this)).catch((error) => this.handleError(error));
      });
      this.dom.prev.addEventListener('click', () => this.step(-1).catch((error) => this.handleError(error)));
      this.dom.next.addEventListener('click', () => this.step(1).catch((error) => this.handleError(error)));
      this.dom.zoomIn.addEventListener('click', () => this.setZoom(this.state.zoom * 1.2));
      this.dom.zoomOut.addEventListener('click', () => this.setZoom(this.state.zoom / 1.2));
      this.dom.zoomReset.addEventListener('click', () => this.resetTransform());
      this.dom.backdrop.addEventListener('click', () => {
        this.toggleChrome();
      });

      this.dom.description.addEventListener('input', () => this.handleDescriptionInput());
      this.dom.fileName.addEventListener('input', () => this.handleFileNameInput());
      this.dom.folderTrigger.addEventListener('click', () => {
        this.openFolderModal().catch((error) => this.handleError(error));
      });
      this.dom.description.addEventListener('keydown', (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          this.flushPendingChanges({ reason: 'description-shortcut' }).catch((error) => this.handleError(error));
        }
      });
      this.dom.folderModalBackdrop.addEventListener('click', () => this.closeFolderModal());
      this.dom.folderCancel.addEventListener('click', () => this.closeFolderModal());
      this.dom.folderMove.addEventListener('click', () => {
        this.submitFolderMove().catch((error) => this.handleError(error));
      });
      this.dom.folderTree.addEventListener('click', (event) => {
        if (this.state.folderMoveSubmitting) return;
        const node = event.target.closest('[data-folder-root]');
        if (!node) return;
        this.state.folderModalRootId = node.dataset.folderRoot || '';
        this.state.folderModalPath = node.dataset.folderPath || '';
        this.renderFolderTree();
      });

      this.dom.details.addEventListener('click', (event) => event.stopPropagation());
      this.dom.carousel.addEventListener('click', (event) => {
        if (performance.now() < this.state.suppressClickUntil) return;
        if (event.target.closest('button')) return;
        this.toggleChrome();
      });

      this.dom.carousel.addEventListener('wheel', (event) => this.handleStageWheel(event), { passive: false });
      this.dom.details.addEventListener('wheel', (event) => this.handleDetailsWheel(event), { passive: false });

      this.dom.carousel.addEventListener('dblclick', (event) => {
        if (event.target === this.dom.video) return;
        if (this.state.zoom > 1.01) this.resetTransform();
        else this.setZoom(2, { clientX: event.clientX, clientY: event.clientY });
      });

      this.dom.image.addEventListener('load', () => {
        this.updateTransform();
      });
      this.dom.video.addEventListener('loadedmetadata', () => {
        this.updateTransform();
      });
      this.dom.video.addEventListener('play', () => {
        this.resetStageGesture(false);
      });

      this.dom.carouselTrack.addEventListener('transitionend', this.handleCarouselTransitionEnd);
      this.dom.carousel.addEventListener('pointerdown', (event) => this.handleStagePointerStart(event));
      window.addEventListener('pointermove', this.handleStagePointerMove, { passive: false });
      window.addEventListener('pointerup', this.handleStagePointerEnd);
      window.addEventListener('pointercancel', this.handleStagePointerEnd);

      this.dom.details.addEventListener('touchstart', (event) => this.handleDetailsTouchStart(event), { passive: false });
      this.dom.details.addEventListener('touchmove', this.handleDetailsTouchMove, { passive: false });
      this.dom.details.addEventListener('touchend', this.handleDetailsTouchEnd);
      this.dom.details.addEventListener('touchcancel', this.handleDetailsTouchEnd);

      this.dom.details.addEventListener('pointerdown', (event) => this.handleDetailsPointerStart(event));
      window.addEventListener('pointermove', this.handleDetailsPointerMove, { passive: false });
      window.addEventListener('pointerup', this.handleDetailsPointerEnd);
      window.addEventListener('pointercancel', this.handleDetailsPointerEnd);

      window.addEventListener('resize', this.handleResize);
      document.addEventListener('keydown', this.handleKeydown);
    }

    handleResize() {
      if (!this.isOpen()) return;
      this.updateShareButtonVisibility();
      if (this.state.carouselAnimating) this.finishCarouselAnimation();
      this.applyDetailsProgress(this.state.detailsProgress, { immediate: true });
      this.rebuildCarouselWindow(this.state.index);
      const currentPosition = this.findRenderedPosition(this.state.index);
      if (currentPosition >= 0) this.setCarouselTranslate(this.getTrackXForPosition(currentPosition));
      this.updateTransform();
    }

    handleKeydown(event) {
      if (!this.isOpen()) return;

      if (this.state.folderModalOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          this.closeFolderModal();
        }
        return;
      }

      const activeElement = document.activeElement;
      if (activeElement && activeElement.closest('.viewer-textarea, .viewer-text-input, .viewer-date-input')) {
        if (event.key === 'Escape') {
          activeElement.blur();
          event.preventDefault();
        }
        return;
      }

      if (event.key === 'Escape') {
        this.requestClose('escape');
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this.step(-1).catch((error) => this.handleError(error));
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        this.step(1).catch((error) => this.handleError(error));
        return;
      }
      if (event.key === 'ArrowUp') {
        if (this.isDesktopSidePanel()) return;
        event.preventDefault();
        this.commitDetails(true);
        return;
      }
      if (event.key === 'ArrowDown') {
        if (this.isDesktopSidePanel()) return;
        event.preventDefault();
        if (this.state.detailsOpen) this.commitDetails(false);
        else this.requestClose('keyboard-down');
        return;
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        this.setZoom(this.state.zoom * 1.2);
        return;
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        this.setZoom(this.state.zoom / 1.2);
        return;
      }
      if (event.key === '0') {
        event.preventDefault();
        this.resetTransform();
        return;
      }
      if (event.key.toLowerCase() === 'l') {
        event.preventDefault();
        this.toggleLike().catch((error) => this.handleError(error));
      }
    }

    handleStagePointerStart(event) {
      if (!this.isOpen()) return;
      if (this.state.folderModalOpen) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (event.target === this.dom.video && event.pointerType === 'mouse') return;
      if (event.target.closest('.viewer-topbar, .viewer-toolbar')) return;
      if (this.state.carouselAnimating) this.finishCarouselAnimation();

      this.stopMomentum();
      this.state.velocityX = 0;
      this.state.velocityY = 0;
      this.state.pointers.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
        timeStamp: performance.now()
      });

      if (this.state.pointers.size === 1) {
        this.state.primaryPointerId = event.pointerId;
        this.state.primaryGesture = {
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
          mode: this.state.zoom > 1.01 ? 'pan' : 'pending',
          startPanX: this.state.panX,
          startPanY: this.state.panY,
          startDetailsProgress: this.state.detailsProgress
        };
        if (this.state.primaryGesture.mode === 'pan') this.dom.canvas.classList.add('is-panning');
      } else if (this.state.pointers.size === 2) {
        this.state.pinchStartDistance = this.getPointerDistance();
        this.state.pinchStartZoom = this.state.zoom;
        if (this.state.primaryGesture) this.state.primaryGesture.mode = 'pinch';
      }
    }

    handleStagePointerMove(event) {
      if (!this.state.pointers.has(event.pointerId)) return;

      const previous = this.state.pointers.get(event.pointerId);
      this.state.pointers.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
        timeStamp: performance.now()
      });

      if (this.state.pointers.size >= 2) {
        const distance = this.getPointerDistance();
        if (!this.state.pinchStartDistance) {
          this.state.pinchStartDistance = distance;
          this.state.pinchStartZoom = this.state.zoom;
        } else if (distance > 0) {
          const ratio = distance / this.state.pinchStartDistance;
          this.setZoom(this.state.pinchStartZoom * Math.pow(ratio, 1.18), this.getPointerCenter());
        }
        event.preventDefault();
        return;
      }

      const gesture = this.state.primaryGesture;
      if (!gesture || gesture.pointerId !== event.pointerId) return;

      const dxTotal = event.clientX - gesture.startX;
      const dyTotal = event.clientY - gesture.startY;
      const dx = previous ? event.clientX - previous.clientX : 0;
      const dy = previous ? event.clientY - previous.clientY : 0;
      if (Math.abs(dxTotal) > 8 || Math.abs(dyTotal) > 8) gesture.moved = true;

      if (gesture.mode === 'pan' || this.state.zoom > 1.01) {
        this.state.panX = gesture.startPanX + dxTotal;
        this.state.panY = gesture.startPanY + dyTotal;
        if (event.pointerType === 'touch') {
          this.state.velocityX = dx;
          this.state.velocityY = dy;
        }
        this.updateTransform();
        event.preventDefault();
        return;
      }

      if (gesture.mode === 'pending') {
        const absX = Math.abs(dxTotal);
        const absY = Math.abs(dyTotal);
        if (absX < 10 && absY < 10) return;
        if (absX > absY * 1.1) gesture.mode = 'swipe';
        else if (dyTotal > 0 && this.state.detailsProgress < 0.05) gesture.mode = 'dismiss';
        else if (this.isMobileSheet()) gesture.mode = 'details';
        else gesture.mode = 'idle';
      }

      if (gesture.mode === 'swipe') {
        this.markGestureActivity();
        if (event.pointerType === 'touch') this.state.velocityX = dx;
        this.updateCarouselDrag(dxTotal);
        event.preventDefault();
        return;
      }

      if (gesture.mode === 'dismiss') {
        this.markGestureActivity();
        this.cancelStageSettle();
        this.state.dismissOffsetY = Math.max(0, dyTotal);
        this.applyStageGesture();
        if (event.pointerType === 'touch') this.state.velocityY = dy;
        event.preventDefault();
        return;
      }

      if (gesture.mode === 'idle') return;

      this.markGestureActivity();
      const progress = clamp(gesture.startDetailsProgress - (dyTotal / Math.max(1, this.getSheetTravel())), 0, 1);
      this.applyDetailsProgress(progress, { immediate: true });
      if (event.pointerType === 'touch') this.state.velocityY = dy;
      event.preventDefault();
    }

    handleStagePointerEnd(event) {
      if (!this.state.pointers.has(event.pointerId)) return;

      this.state.pointers.delete(event.pointerId);
      if (this.state.pointers.size < 2) {
        this.state.pinchStartDistance = null;
        this.state.pinchStartZoom = this.state.zoom;
      }

      const gesture = this.state.primaryGesture;
      if (!gesture || gesture.pointerId !== event.pointerId) {
        if (!this.state.pointers.size) this.dom.canvas.classList.remove('is-panning');
        return;
      }

      this.dom.canvas.classList.remove('is-panning');

      if (this.state.pointers.size > 0) {
        const [nextPointerId, nextPoint] = this.state.pointers.entries().next().value;
        this.state.primaryPointerId = nextPointerId;
        this.state.primaryGesture = {
          pointerId: nextPointerId,
          pointerType: event.pointerType,
          startX: nextPoint.clientX,
          startY: nextPoint.clientY,
          moved: false,
          mode: this.state.zoom > 1.01 ? 'pan' : 'pending',
          startPanX: this.state.panX,
          startPanY: this.state.panY,
          startDetailsProgress: this.state.detailsProgress
        };
        return;
      }

      this.state.primaryPointerId = null;
      this.state.primaryGesture = null;

      if (gesture.mode === 'swipe') {
        const width = this.dom.stage.clientWidth || window.innerWidth || 1;
        const projected = (event.pointerType === 'touch')
          ? (event.clientX - gesture.startX) + (this.state.velocityX * 14)
          : (event.clientX - gesture.startX);
        if (Math.abs(projected) > width * 0.12) {
          this.step(projected < 0 ? 1 : -1, { dragOffsetX: this.state.carouselDragOffsetX }).catch((error) => this.handleError(error));
        } else this.animateCarouselToCurrent();
      } else if (gesture.mode === 'dismiss') {
        const height = this.dom.stage.clientHeight || window.innerHeight || 1;
        const projected = this.state.dismissOffsetY + Math.max(0, this.state.velocityY) * 14;
        if (projected > height * 0.16) this.requestClose('swipe-down', { closeOptions: { preserveGesture: true } });
        else this.resetStageGesture(true);
      } else if (gesture.mode === 'details') {
        this.commitDetails(this.shouldOpenDetails(this.state.detailsProgress, this.state.velocityY));
      }

      if (gesture.moved) this.markGestureActivity();
      this.state.velocityX = 0;
      this.state.velocityY = 0;
    }

    handleDetailsTouchStart(event) {
      if (!this.isMobileSheet()) return;
      if (!this.isOpen() || this.state.folderModalOpen || this.state.detailsProgress < 0.99) return;
      const touch = event.changedTouches?.[0];
      if (!touch) return;
      const scrollTarget = this.findScrollableDetailsAncestor(event.target);
      this.state.detailsTouchId = touch.identifier;
      this.state.detailsTouchGesture = {
        startX: touch.clientX,
        startY: touch.clientY,
        startProgress: this.state.detailsProgress,
        target: event.target,
        dragging: false,
        blurField: this.findDismissBlurField(event.target),
        scrollTarget,
        startScrollTop: scrollTarget?.scrollTop || 0
      };
    }

    handleDetailsTouchMove(event) {
      if (this.state.detailsTouchId === null || !this.state.detailsTouchGesture) return;
      const touch = Array.from(event.touches || []).find((item) => item.identifier === this.state.detailsTouchId);
      if (!touch) return;
      this.updateDetailsDismissGesture(this.state.detailsTouchGesture, touch.clientX, touch.clientY, event);
    }

    handleDetailsTouchEnd(event) {
      if (this.state.detailsTouchId === null) return;
      const stillTracked = Array.from(event.touches || []).some((item) => item.identifier === this.state.detailsTouchId);
      if (stillTracked) return;
      this.finishDetailsDismissGesture(this.state.detailsTouchGesture);
      this.state.detailsTouchId = null;
      this.state.detailsTouchGesture = null;
    }

    handleDetailsPointerStart(event) {
      if (!this.isMobileSheet()) return;
      if (!this.isOpen() || this.state.folderModalOpen || this.state.detailsProgress < 0.99) return;
      if (event.pointerType === 'touch') return;
      if (event.button !== 0) return;
      if (!event.target.closest('.viewer-details-handle')) return;
      const scrollTarget = this.findScrollableDetailsAncestor(event.target);
      this.state.detailsPointerGesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startProgress: this.state.detailsProgress,
        target: event.target,
        dragging: false,
        blurField: this.findDismissBlurField(event.target),
        scrollTarget,
        startScrollTop: scrollTarget?.scrollTop || 0
      };
    }

    handleDetailsPointerMove(event) {
      const gesture = this.state.detailsPointerGesture;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      this.updateDetailsDismissGesture(gesture, event.clientX, event.clientY, event);
    }

    handleDetailsPointerEnd(event) {
      const gesture = this.state.detailsPointerGesture;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      this.finishDetailsDismissGesture(gesture);
      this.state.detailsPointerGesture = null;
    }

    updateDetailsDismissGesture(gesture, clientX, clientY, event) {
      if (!gesture) return;
      const dx = clientX - gesture.startX;
      const dy = clientY - gesture.startY;
      const mostlyVertical = Math.abs(dy) > Math.abs(dx);
      const canDismiss = this.canStartDetailsDismiss(gesture.target, gesture.scrollTarget, gesture.startScrollTop);

      if (!gesture.dragging) {
        if (dy <= 0 || !mostlyVertical || !canDismiss) return;
        if (event.cancelable) event.preventDefault();
        if (Math.abs(dy) < 10) return;
        this.blurFieldForDismissGesture(gesture.blurField);
        gesture.dragging = true;
      }

      if (gesture.scrollTarget && gesture.scrollTarget.scrollTop > 0) {
        gesture.scrollTarget.scrollTop = 0;
      }
      this.markGestureActivity();
      this.state.velocityY = dy;
      const progress = clamp(gesture.startProgress - (dy / Math.max(1, this.getSheetTravel())), 0, 1);
      this.applyDetailsProgress(progress, { immediate: true });
      if (event.cancelable) event.preventDefault();
    }

    finishDetailsDismissGesture(gesture) {
      if (!gesture?.dragging) return;
      this.commitDetails(this.shouldOpenDetails(this.state.detailsProgress, this.state.velocityY));
      this.state.velocityY = 0;
    }

    handleStageWheel(event) {
      if (!this.isOpen()) return;

      if (event.ctrlKey) {
        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.08 : 0.92;
        this.setZoom(this.state.zoom * factor);
        return;
      }

      const mostlyVertical = Math.abs(event.deltaY) > Math.abs(event.deltaX) * 1.15;
      if (this.state.zoom > 1.01) {
        event.preventDefault();
        this.state.panX -= event.deltaX;
        this.state.panY -= event.deltaY;
        this.updateTransform();
        return;
      }

      if (!mostlyVertical || this.isDesktopSidePanel()) return;
      event.preventDefault();
      this.applyWheelDetailsDelta(event.deltaY);
    }

    handleDetailsWheel(event) {
      if (!this.isOpen() || this.isDesktopSidePanel()) return;
      if (this.state.zoom > 1.01) return;

      const mostlyVertical = Math.abs(event.deltaY) > Math.abs(event.deltaX) * 1.15;
      if (!mostlyVertical) return;

      const scrollingDown = event.deltaY > 0;
      const canDismiss = this.dom.details.scrollTop <= 2;
      const canReveal = event.deltaY < 0 && this.state.detailsProgress < 1;
      if (!canReveal && !(scrollingDown && canDismiss)) return;

      event.preventDefault();
      this.applyWheelDetailsDelta(event.deltaY);
    }

    applyWheelDetailsDelta(deltaY) {
      this.markGestureActivity();
      const factor = this.isMobileSheet() ? 1.8 : 1.2;
      const nextProgress = clamp(this.state.detailsProgress - ((deltaY / Math.max(1, this.getSheetTravel())) * factor), 0, 1);
      this.state.wheelLastDeltaY = deltaY;
      this.applyDetailsProgress(nextProgress, { immediate: true });
      this.scheduleWheelCommit();
    }

    scheduleWheelCommit() {
      if (this.state.wheelCommitTimer) window.clearTimeout(this.state.wheelCommitTimer);
      this.state.wheelCommitTimer = window.setTimeout(() => {
        this.commitDetails(this.shouldOpenDetails(this.state.detailsProgress, this.state.wheelLastDeltaY));
        this.state.wheelLastDeltaY = 0;
        this.state.wheelCommitTimer = 0;
      }, 90);
    }

    shouldOpenDetails(progress, velocityDelta = 0) {
      const projected = clamp(progress + ((-velocityDelta) * 0.015), 0, 1);
      return projected > 0.42;
    }

    findDismissBlurField(target) {
      if (!(target instanceof Element)) return null;
      return target.closest('.viewer-textarea, .viewer-text-input, .viewer-date-input');
    }

    blurFieldForDismissGesture(field) {
      if (!(field instanceof HTMLElement)) return;
      if (document.activeElement === field) field.blur();
    }

    canStartDetailsDismiss(target, scrollable = this.findScrollableDetailsAncestor(target), scrollTop = scrollable?.scrollTop || 0) {
      if (target?.closest?.('.viewer-details-handle')) return true;
      if (isTextEntryField(target)) return false;
      return !scrollable || scrollTop <= 2;
    }

    findScrollableDetailsAncestor(node) {
      let current = node instanceof Element ? node : null;
      while (current && current !== this.dom.details) {
        const style = window.getComputedStyle(current);
        const canScroll = current.scrollHeight > current.clientHeight + 4 && /(auto|scroll)/.test(style.overflowY || style.overflow || '');
        if (canScroll) return current;
        current = current.parentElement;
      }
      return this.dom.details;
    }

    handleDescriptionInput() {
      this.state.descriptionDirty = true;
      this.updateDescriptionSummary(this.getCurrentItem());
      this.updateStatus(this.getCurrentItem());
    }

    handleFileNameInput() {
      const value = String(this.dom.fileName.value || '').trim();
      if (!value) {
        this.setFileNameValidationState('invalid');
        return;
      }
      this.setFileNameValidationState('checking');
      if (this.state.fileNameValidationTimer) window.clearTimeout(this.state.fileNameValidationTimer);
      const token = ++this.state.fileNameValidationToken;
      this.state.fileNameValidationTimer = window.setTimeout(() => {
        this.validateFileNameDraft(token).catch((error) => this.handleError(error));
      }, 120);
    }

    handleDescriptionPaste(event) {
      if (!event.clipboardData) return;
      event.preventDefault();
      const text = event.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
    }

    clearDescriptionSaveTimer() {
      if (this.state.descriptionSaveTimer) window.clearTimeout(this.state.descriptionSaveTimer);
      this.state.descriptionSaveTimer = 0;
    }

    readDescriptionValue() {
      return normalizeDescriptionText(this.dom.description.value || '');
    }

    setDescriptionValue(value) {
      this.dom.description.value = value || '';
    }

    updateDescriptionSummary(item) {
      const descriptionText = this.state.descriptionDirty ? this.readDescriptionValue() : (item?.description || '');
      this.dom.descriptionSummary.textContent = descriptionText;
      this.dom.descriptionSummary.classList.toggle('hidden', !descriptionText);
    }

    setFileNameValidationState(state) {
      this.state.fileNameValidationState = state;
      this.dom.fileName.classList.toggle('is-invalid', state === 'invalid');
      this.dom.fileName.classList.toggle('is-checking', state === 'checking');
    }

    buildDraftSnapshot(item = this.getCurrentItem()) {
      if (!item) return null;
      return {
        itemId: item.id,
        itemBaseName: item.baseName || '',
        description: this.readDescriptionValue(),
        originalDescription: typeof this.options.getDescriptionValue === 'function'
          ? this.options.getDescriptionValue(item) || ''
          : (item.description || ''),
        baseName: String(this.dom.fileName.value || '').trim(),
        nextRootId: this.state.selectedFolderRootId || item.folderRootId || '',
        nextRelativePath: this.state.selectedFolderPath || '',
        currentRootId: item.folderRootId || '',
        currentRelativePath: item.folder === '.' ? '' : (item.folder || ''),
        isoDate: this.dom.dateInput.value || item.isoDate || '',
        originalIsoDate: item.isoDate || '',
        time: this.dom.timeInput.value || this.extractTimeValue(item),
        originalTime: this.extractTimeValue(item)
      };
    }

    queueDraftFlush(snapshot, { reason = '' } = {}) {
      if (!snapshot) return;
      this.state.saveQueue = this.state.saveQueue
        .then(() => this.flushDraftSnapshot(snapshot, { reason }))
        .catch((error) => this.handleError(error));
      return this.state.saveQueue;
    }

    async validateFileNameDraft(token = this.state.fileNameValidationToken) {
      const item = this.getCurrentItem();
      if (!item) return false;
      const baseName = String(this.dom.fileName.value || '').trim();
      if (!baseName) {
        this.setFileNameValidationState('invalid');
        return false;
      }
      if (baseName === (item.baseName || '')) {
        this.setFileNameValidationState('valid');
        return true;
      }
      if (typeof this.options.onValidateFileName !== 'function') {
        this.setFileNameValidationState('valid');
        return true;
      }
      const result = await this.options.onValidateFileName(item, baseName, this);
      if (token !== this.state.fileNameValidationToken) return false;
      const isValid = Boolean(result?.valid);
      this.setFileNameValidationState(isValid ? 'valid' : 'invalid');
      return isValid;
    }

    formatFolderLabel(item = this.getCurrentItem()) {
      if (!item) return '-';
      return `${item.folderRootLabel || ''}${item.folder && item.folder !== '.' ? ` / ${item.folder}` : ''}`.trim() || '-';
    }

    currentDraftFolderLabel() {
      const item = this.getCurrentItem();
      if (!item) return '-';
      const selectedRoot = (this.state.folderRoots || []).find((root) => root.rootId === this.state.selectedFolderRootId);
      const rootLabel = selectedRoot?.rootLabel || item.folderRootLabel || '';
      const folder = this.state.selectedFolderPath || '';
      return `${rootLabel}${folder ? ` / ${folder}` : ''}`.trim() || '-';
    }

    updateFolderDraftLabel() {
      if (this.dom.folderLabel) this.dom.folderLabel.textContent = this.currentDraftFolderLabel();
    }

    extractTimeValue(item = this.getCurrentItem()) {
      const match = String(item?.capturedAt || '').match(/T(\d{2}:\d{2})/);
      return match?.[1] || '12:00';
    }

    async openFolderModal() {
      if (typeof this.options.onLoadFolders !== 'function') return;
      const item = this.getCurrentItem();
      if (!item) return;
      this.state.folderLoading = true;
      this.state.folderMoveSubmitting = false;
      this.state.folderModalOpen = true;
      this.state.folderModalRootId = this.state.selectedFolderRootId || item.folderRootId || '';
      this.state.folderModalPath = this.state.selectedFolderPath || (item.folder === '.' ? '' : (item.folder || ''));
      this.renderFolderTree([]);
      this.dom.folderModal.classList.remove('hidden');
      this.dom.folderModal.setAttribute('aria-hidden', 'false');
      try {
        const payload = await this.options.onLoadFolders(this);
        this.state.folderRoots = Array.isArray(payload?.roots) ? payload.roots : [];
      } finally {
        this.state.folderLoading = false;
        this.renderFolderTree();
      }
    }

    closeFolderModal() {
      this.state.folderModalOpen = false;
      this.state.folderMoveSubmitting = false;
      this.dom.folderModal.classList.add('hidden');
      this.dom.folderModal.setAttribute('aria-hidden', 'true');
      this.updateFolderMoveButton();
      this.updateFolderDraftLabel();
    }

    canSubmitFolderMove(item = this.getCurrentItem()) {
      if (!item || typeof this.options.onMove !== 'function') return false;
      if (this.state.folderLoading || this.state.folderMoveSubmitting) return false;
      const nextRootId = this.state.folderModalRootId || '';
      if (!nextRootId) return false;
      const nextRelativePath = this.state.folderModalPath || '';
      const currentRootId = this.state.selectedFolderRootId || item.folderRootId || '';
      const currentRelativePath = this.state.selectedFolderPath || (item.folder === '.' ? '' : (item.folder || ''));
      return nextRootId !== currentRootId || nextRelativePath !== currentRelativePath;
    }

    updateFolderMoveButton() {
      if (!this.dom.folderMove) return;
      const disabled = !this.canSubmitFolderMove();
      this.dom.folderMove.disabled = disabled;
      this.dom.folderMove.textContent = this.state.folderMoveSubmitting ? 'Moving...' : 'Move';
    }

    renderFolderTree(roots = this.state.folderRoots || []) {
      this.dom.folderTree.classList.toggle('is-empty', !roots.length && !this.state.folderLoading);
      this.dom.folderTree.setAttribute('aria-busy', this.state.folderLoading ? 'true' : 'false');
      if (!roots.length) {
        this.dom.folderTree.innerHTML = this.state.folderLoading ? '' : '<p class="viewer-folder-empty">No folders available.</p>';
        this.updateFolderMoveButton();
        return;
      }
      const renderNode = (node, rootId, depth = 0) => {
        const selected = this.state.folderModalRootId === rootId && this.state.folderModalPath === node.relativePath;
        const indent = depth * 14;
        const modified = node.latestModifiedMs ? new Date(node.latestModifiedMs).toLocaleDateString() : '';
        const icon = node.pending
          ? renderPhIcon('spinner-gap', { spin: true })
          : renderPhIcon(escapeHtml(node.icon || 'folder'), { variant: 'duotone' });
        const meta = `${node.mediaCount || 0}${modified ? ` · ${escapeHtml(modified)}` : ''}`;
        return `
          <div class="upload-folder-node depth-${depth}">
            <button class="upload-folder-item ${selected ? 'is-selected' : ''} ${node.pending ? 'is-pending' : ''}" type="button" style="padding-left:${12 + indent}px" data-folder-root="${escapeHtml(rootId)}" data-folder-path="${escapeHtml(node.relativePath)}">
              <span class="upload-folder-item-main">${icon}<span>${escapeHtml(node.displayPath === '.' ? '(root)' : node.label)}</span></span>
              <span class="upload-folder-item-meta">${meta}</span>
            </button>
            ${(node.children || []).map((child) => renderNode(child, rootId, depth + 1)).join('')}
          </div>
        `;
      };
      this.dom.folderTree.innerHTML = roots.map((root) => `
        <section class="upload-folder-root ${root.rootId === this.state.folderModalRootId ? 'is-active-root' : ''}">
          <p class="upload-folder-root-label">${renderPhIcon('hard-drives', { variant: 'duotone' })} ${escapeHtml(root.rootLabel || '')} <span class="upload-folder-root-count">${root.tree?.mediaCount || 0}</span></p>
          ${renderNode(root.tree, root.rootId)}
        </section>
      `).join('');
      this.updateFolderMoveButton();
    }

    async submitFolderMove() {
      if (!this.canSubmitFolderMove()) return;
      const item = this.getCurrentItem();
      if (!item) return;
      this.state.folderMoveSubmitting = true;
      this.updateFolderMoveButton();
      try {
        const result = await this.options.onMove({ id: item.id }, {
          rootId: this.state.folderModalRootId,
          relativePath: this.state.folderModalPath || ''
        }, this);
        this.state.selectedFolderRootId = this.state.folderModalRootId;
        this.state.selectedFolderPath = this.state.folderModalPath || '';
        this.closeFolderModal();
        await this.reselectAfterMutation(item.id, result);
      } finally {
        this.state.folderMoveSubmitting = false;
        this.updateFolderMoveButton();
      }
    }

    async flushDraftSnapshot(snapshot, { reason = '' } = {}) {
      if (!snapshot) return;
      const currentItem = this.getCurrentItem();
      const sameCurrentItem = currentItem?.id === snapshot.itemId;

      if (typeof this.options.onSaveDescription === 'function' && snapshot.description !== snapshot.originalDescription) {
        await this.options.onSaveDescription({ id: snapshot.itemId }, snapshot.description, this);
        if (sameCurrentItem) this.state.descriptionDirty = false;
      }

      if (typeof this.options.onRename === 'function' && snapshot.baseName !== snapshot.itemBaseName) {
        let valid = false;
        if (snapshot.baseName) {
          if (typeof this.options.onValidateFileName === 'function') {
            const result = await this.options.onValidateFileName({ id: snapshot.itemId, baseName: snapshot.itemBaseName }, snapshot.baseName, this);
            valid = Boolean(result?.valid);
          } else {
            valid = true;
          }
        }
        if (valid) {
          await this.options.onRename({ id: snapshot.itemId, baseName: snapshot.itemBaseName }, snapshot.baseName, this);
        } else if (sameCurrentItem) {
          this.dom.fileName.value = snapshot.itemBaseName || '';
          this.setFileNameValidationState('valid');
        }
      }

      if (
        typeof this.options.onMove === 'function'
        && snapshot.nextRootId
        && (snapshot.nextRootId !== snapshot.currentRootId || snapshot.nextRelativePath !== snapshot.currentRelativePath)
      ) {
        await this.options.onMove({ id: snapshot.itemId }, {
          rootId: snapshot.nextRootId,
          relativePath: snapshot.nextRelativePath
        }, this);
      }

      if (
        typeof this.options.onSaveDateTime === 'function'
        && (snapshot.isoDate !== snapshot.originalIsoDate || snapshot.time !== snapshot.originalTime)
      ) {
        await this.options.onSaveDateTime({ id: snapshot.itemId }, {
          isoDate: snapshot.isoDate,
          time: snapshot.time
        }, this);
      }

      if (reason) void reason;
    }

    flushPendingChanges({ reason = '' } = {}) {
      const snapshot = this.buildDraftSnapshot();
      return this.queueDraftFlush(snapshot, { reason });
    }

    async reselectAfterMutation(previousId, result, { forceDateToast = false } = {}) {
      if (this.state.closing || !this.isOpen()) return;
      const targetId = result?.photo?.id || result?.id || previousId;
      const items = this.getItems();
      if (!items.length) {
        this.close({ animate: false });
        return;
      }
      const nextIndex = items.findIndex((entry) => entry.id === targetId);
      if (nextIndex < 0) {
        this.close({ animate: false });
        return;
      }
      this.state.index = nextIndex;
      this.render(0, { forceDateToast });
    }

    handleError(error) {
      if (typeof this.options.onError === 'function') {
        this.options.onError(error);
        return;
      }
      console.error(error);
    }

    getItems() {
      const items = this.options.getItems?.();
      return Array.isArray(items) ? items : [];
    }

    isOpen() {
      return !this.root.classList.contains('hidden');
    }

    isMobileSheet() {
      return window.innerWidth <= 900;
    }

    isDesktopSidePanel() {
      return !this.isMobileSheet();
    }

    canWriteClipboardText() {
      return typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';
    }

    canWriteClipboardItems() {
      return typeof navigator !== 'undefined'
        && typeof navigator.clipboard?.write === 'function'
        && typeof window.ClipboardItem === 'function';
    }

    canShareCurrentPlatform() {
      if (typeof this.options.onShare === 'function') return true;
      if (typeof navigator.share === 'function') return true;
      return this.canWriteClipboardItems() || this.canWriteClipboardText();
    }

    updateShareButtonVisibility() {
      this.dom.share.classList.toggle('hidden', !this.canShareCurrentPlatform());
    }

    async copyCurrentMediaToClipboard(item) {
      if (!item?.fullUrl) return false;
      if (item.type === 'video' || !this.canWriteClipboardItems()) return false;

      const response = await fetch(item.fullUrl, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Unable to fetch media for clipboard copy: ${response.status}`);

      const blob = await response.blob();
      const type = blob.type || 'image/png';
      await navigator.clipboard.write([
        new window.ClipboardItem({
          [type]: blob,
          'text/plain': new Blob([item.fullUrl], { type: 'text/plain' })
        })
      ]);
      return true;
    }

    getCurrentIndex() {
      return this.state.index;
    }

    getCurrentItem() {
      return this.getItems()[this.state.index] || null;
    }

    getItemAt(index) {
      return this.getItems()[index] || null;
    }

    clearCloseAnimationTimer() {
      if (this.state.closeAnimationTimer) window.clearTimeout(this.state.closeAnimationTimer);
      this.state.closeAnimationTimer = 0;
    }

    clearCarouselAnimationTimer() {
      if (this.state.carouselAnimationTimer) window.clearTimeout(this.state.carouselAnimationTimer);
      this.state.carouselAnimationTimer = 0;
    }

    getWindowRadius() {
      return 2;
    }

    getSlotWidth() {
      return this.dom.stage.clientWidth || window.innerWidth || 1;
    }

    getMaxIndex() {
      return this.getItems().length - 1;
    }

    canNavigateDirection(direction, fromIndex = this.state.index) {
      if (direction < 0) return fromIndex > 0;
      if (direction > 0) return fromIndex < this.getMaxIndex();
      return false;
    }

    updateNavState() {
      const disablePrev = !this.canNavigateDirection(-1);
      const disableNext = !this.canNavigateDirection(1);
      this.dom.prev.disabled = disablePrev;
      this.dom.next.disabled = disableNext;
      this.dom.prev.classList.toggle('is-disabled', disablePrev);
      this.dom.next.classList.toggle('is-disabled', disableNext);
    }

    buildRenderedIndexes(centerIndex, extraIndexes = []) {
      const items = this.getItems();
      if (!items.length) return [];
      const radius = this.getWindowRadius();
      const start = Math.max(0, centerIndex - radius);
      const end = Math.min(items.length - 1, centerIndex + radius);
      const indexes = [];
      for (let index = start; index <= end; index += 1) indexes.push(index);
      extraIndexes.forEach((index) => {
        if (index < 0 || index >= items.length) return;
        if (!indexes.includes(index)) indexes.push(index);
      });
      indexes.sort((a, b) => a - b);
      return indexes;
    }

    findRenderedPosition(index) {
      return this.state.renderedIndexes.indexOf(index);
    }

    getTrackXForPosition(position) {
      return -(position * this.getSlotWidth());
    }

    setCarouselTranslate(x) {
      this.state.carouselTranslateX = x;
      this.root.style.setProperty('--viewer-carousel-x', `${Math.round(x)}px`);
    }

    recenterCurrentSlide() {
      if (!this.isOpen() || this.state.index < 0 || this.state.carouselAnimating) return;
      this.rebuildCarouselWindow(this.state.index);
      const currentPosition = this.findRenderedPosition(this.state.index);
      if (currentPosition >= 0) this.setCarouselTranslate(this.getTrackXForPosition(currentPosition));
    }

    stopCarouselAnimation({ jumpToCurrent = true } = {}) {
      this.clearCarouselAnimationTimer();
      this.state.animationToken += 1;
      this.state.carouselAnimating = false;
      this.state.carouselAnimationDirection = 0;
      this.root.classList.remove('is-carousel-settling');
      if (jumpToCurrent && this.isOpen() && this.state.index >= 0) {
        this.recenterCurrentSlide();
      }
    }

    finishCarouselAnimation() {
      if (!this.state.carouselAnimating) return;
      this.stopCarouselAnimation({ jumpToCurrent: false });
      this.render(0, {
        skipAnnounce: true,
        skipDetails: true,
        contentIndex: this.state.index,
        detailIndex: this.state.index,
        mountIndex: this.state.index
      });
    }

    handleCarouselTransitionEnd(event) {
      if (event.target !== this.dom.carouselTrack || event.propertyName !== 'transform') return;
      this.finishCarouselAnimation();
    }

    getPreviewSrc(item) {
      if (!item) return '';
      if (item.type === 'video') return item.previewUrl || item.thumbUrl || '';
      return item.thumbUrl || item.fullUrl || '';
    }

    buildPreviewElement(item) {
      const preview = document.createElement('div');
      preview.className = 'viewer-slot-preview';
      if (!item) {
        preview.classList.add('is-empty');
        return preview;
      }
      const src = this.getPreviewSrc(item);
      if (!src) {
        preview.classList.add('is-empty');
        return preview;
      }
      preview.innerHTML = item.type === 'video'
        ? `
          <video muted autoplay loop playsinline preload="metadata" aria-hidden="true"></video>
          <span class="viewer-slot-video-mark">${renderPhIcon('play-fill', { variant: 'fill' })}</span>
        `
        : '<img alt="" draggable="false" />';
      return preview;
    }

    buildFullSlotElement(item) {
      const full = document.createElement('div');
      full.className = 'viewer-slot-full is-hidden';
      if (!item || item.type === 'video') return full;
      full.innerHTML = '<img alt="" draggable="false" />';
      return full;
    }

    async syncSlotPreviewSource(slot) {
      if (!(slot instanceof HTMLElement)) return;
      const itemIndex = Number(slot.dataset.itemIndex);
      const item = this.getItemAt(itemIndex);
      if (!item) return;
      if (item.type === 'video') {
        const video = slot.querySelector('.viewer-slot-preview video');
        const nextSrc = this.getPreviewSrc(item);
        if (video && nextSrc && video.getAttribute('src') !== nextSrc) {
          video.setAttribute('src', nextSrc);
          video.load();
        }
        return;
      }
      const image = slot.querySelector('.viewer-slot-preview img');
      const nextSrc = this.getPreviewSrc(item);
      if (!image || !nextSrc) return;
      const requestKey = `${item.id}:${nextSrc}`;
      const existingObjectUrl = window.mediaAssetCache?.peekObjectUrl(nextSrc);
      if (existingObjectUrl && slot.dataset.previewRequestKey === requestKey && image.getAttribute('src') === existingObjectUrl) {
        return;
      }
      slot.dataset.previewRequestKey = requestKey;
      const objectUrl = existingObjectUrl || await window.mediaAssetCache?.getObjectUrl(nextSrc, { fallbackFetch: true });
      if (!objectUrl) return;
      if (slot.dataset.previewRequestKey !== requestKey || slot.dataset.itemId !== item.id) return;
      if (image.getAttribute('src') !== objectUrl) image.setAttribute('src', objectUrl);
    }

    setSlotPreviewHidden(slot, hidden) {
      if (!(slot instanceof HTMLElement)) return;
      const preview = slot.querySelector('.viewer-slot-preview');
      if (preview) preview.classList.toggle('is-hidden', Boolean(hidden));
    }

    setSlotFullHidden(slot, hidden) {
      if (!(slot instanceof HTMLElement)) return;
      const full = slot.querySelector('.viewer-slot-full');
      if (full) full.classList.toggle('is-hidden', Boolean(hidden));
    }

    async syncSlotFullSource(slot, item = this.getItemAt(Number(slot?.dataset?.itemIndex || -1))) {
      if (!(slot instanceof HTMLElement) || !item || item.type === 'video' || !item.fullUrl) return;
      const image = slot.querySelector('.viewer-slot-full img');
      if (!image) return;
      const requestKey = `${item.id}:${item.fullUrl}`;
      const existingObjectUrl = window.mediaAssetCache?.peekObjectUrl(item.fullUrl);
      if (existingObjectUrl && slot.dataset.fullRequestKey === requestKey && image.getAttribute('src') === existingObjectUrl) {
        this.setSlotFullHidden(slot, false);
        return;
      }
      slot.dataset.fullRequestKey = requestKey;
      const objectUrl = existingObjectUrl || await this.loadFullImage(item);
      if (!objectUrl) return;
      if (slot.dataset.fullRequestKey !== requestKey || slot.dataset.itemId !== item.id) return;
      if (image.getAttribute('src') !== objectUrl) image.setAttribute('src', objectUrl);
      this.setSlotFullHidden(slot, false);
    }

    setMountedSlotPreviewHidden(hidden) {
      const mountedSlot = this.dom.mediaFrame.parentElement;
      if (mountedSlot instanceof HTMLElement) this.setSlotPreviewHidden(mountedSlot, hidden);
    }

    clearPreviewHideTimer() {
      if (!this.state.previewHideTimer) return;
      window.clearTimeout(this.state.previewHideTimer);
      this.state.previewHideTimer = 0;
    }

    scheduleMountedSlotPreviewHidden(hidden, { delay = 0, token = this.state.loadToken } = {}) {
      this.clearPreviewHideTimer();
      if (!hidden || delay <= 0) {
        this.setMountedSlotPreviewHidden(hidden);
        return;
      }
      this.state.previewHideTimer = window.setTimeout(() => {
        this.state.previewHideTimer = 0;
        if (token !== this.state.loadToken) return;
        this.setMountedSlotPreviewHidden(true);
      }, delay);
    }

    setMediaFrameLoaded(loaded) {
      this.dom.mediaFrame.classList.toggle('is-awaiting-media', !loaded);
    }

    isMediaFrameLoaded() {
      return !this.dom.mediaFrame.classList.contains('is-awaiting-media');
    }

    normalizeAssetUrl(src) {
      if (!src) return '';
      try {
        return new URL(src, window.location.href).href;
      } catch (error) {
        return String(src);
      }
    }

    waitForDisplayedImage(image, src) {
      if (!(image instanceof HTMLImageElement) || !src) return Promise.resolve(false);
      const targetSrc = this.normalizeAssetUrl(src);
      const currentSrc = () => this.normalizeAssetUrl(image.currentSrc || image.src || image.getAttribute('src') || '');
      const decodeImage = () => {
        if (typeof image.decode !== 'function') return Promise.resolve(true);
        return image.decode()
          .then(() => true)
          .catch(() => image.naturalWidth > 0 && image.naturalHeight > 0);
      };

      if (image.complete && image.naturalWidth > 0 && currentSrc() === targetSrc) {
        return decodeImage();
      }

      return new Promise((resolve) => {
        let settled = false;
        const cleanup = () => {
          image.removeEventListener('load', handleLoad);
          image.removeEventListener('error', handleError);
        };
        const finish = (loaded) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (!loaded) {
            resolve(false);
            return;
          }
          decodeImage().then((decoded) => {
            resolve(Boolean(decoded) && image.naturalWidth > 0 && currentSrc() === targetSrc);
          });
        };
        const handleLoad = () => finish(true);
        const handleError = () => finish(false);
        image.addEventListener('load', handleLoad, { once: true });
        image.addEventListener('error', handleError, { once: true });
        if (image.complete) finish(image.naturalWidth > 0 && currentSrc() === targetSrc);
      });
    }

    async revealCurrentImage(src, token = this.state.loadToken) {
      if (!src) return false;
      this.dom.image.src = src;
      this.dom.image.classList.remove('hidden');
      const ready = await this.waitForDisplayedImage(this.dom.image, src);
      if (token !== this.state.loadToken || !ready) return false;
      this.setMediaFrameLoaded(true);
      this.scheduleMountedSlotPreviewHidden(true, { delay: 220, token });
      this.setLoadingState(false);
      this.updateTransform();
      return true;
    }

    refreshRenderedPreview(item) {
      if (!item?.id) return;
      this.carouselSlots.forEach((slot) => {
        if (!(slot instanceof HTMLElement) || slot.dataset.itemId !== item.id) return;
        const image = slot.querySelector('.viewer-slot-preview img');
        if (image?.getAttribute('src')) return;
        void this.syncSlotPreviewSource(slot);
      });
    }

    refreshRenderedFullImage(item) {
      if (!item?.id) return;
      this.carouselSlots.forEach((slot) => {
        if (!(slot instanceof HTMLElement) || slot.dataset.itemId !== item.id) return;
        if (slot.contains(this.dom.mediaFrame)) return;
        void this.syncSlotFullSource(slot, item);
      });
    }

    primePreviewMedia(item) {
      const previewSrc = this.getPreviewSrc(item);
      if (!previewSrc) return;
      void window.mediaAssetCache?.warm(previewSrc, { fallbackFetch: true });
    }

    updateCarouselSlotState(slot, itemIndex, { mountMediaFrame = false, currentIndex = -1 } = {}) {
      const item = this.getItemAt(itemIndex);
      slot.dataset.itemIndex = String(itemIndex);
      slot.dataset.itemId = item?.id || '';
      slot.classList.toggle('viewer-slot-current', itemIndex === currentIndex);
      slot.classList.toggle('is-empty', !item);
      if (!item) return slot;
      this.primePreviewMedia(item);
      this.setSlotPreviewHidden(slot, false);
      this.setSlotFullHidden(slot, true);
      void this.syncSlotPreviewSource(slot);
      if (mountMediaFrame) {
        slot.append(this.dom.mediaFrame);
        this.setSlotPreviewHidden(slot, this.isMediaFrameLoaded());
      } else if (this.state.loadedFullMedia.has(item.id)) {
        void this.syncSlotFullSource(slot, item);
      }
      return slot;
    }

    createCarouselSlot(itemIndex, { mountMediaFrame = false, currentIndex = -1 } = {}) {
      const item = this.getItemAt(itemIndex);
      const slot = document.createElement('div');
      slot.className = 'viewer-slot';
      if (!item) {
        slot.classList.add('is-empty');
        return slot;
      }
      slot.dataset.itemIndex = String(itemIndex);
      slot.dataset.itemId = item.id || '';
      slot.append(this.buildPreviewElement(item));
      slot.append(this.buildFullSlotElement(item));
      return this.updateCarouselSlotState(slot, itemIndex, { mountMediaFrame, currentIndex });
    }

    rebuildCarouselWindow(centerIndex, extraIndexes = [], { mountIndex = centerIndex } = {}) {
      const renderedIndexes = this.buildRenderedIndexes(centerIndex, extraIndexes);
      if (this.dom.mediaFrame.parentNode) this.dom.mediaFrame.parentNode.removeChild(this.dom.mediaFrame);
      const orderedSlots = renderedIndexes.map((itemIndex) => {
        const item = this.getItemAt(itemIndex);
        const cachedSlot = this.carouselSlots.get(itemIndex);
        const slot = cachedSlot && cachedSlot.dataset.itemId === (item?.id || '')
          ? cachedSlot
          : this.createCarouselSlot(itemIndex);
        this.carouselSlots.set(itemIndex, slot);
        return this.updateCarouselSlotState(slot, itemIndex, {
          mountMediaFrame: itemIndex === mountIndex,
          currentIndex: centerIndex
        });
      });
      const desiredSlots = new Set(orderedSlots);
      Array.from(this.dom.carouselTrack.children)
        .filter((node) => node instanceof HTMLElement && !desiredSlots.has(node))
        .forEach((node) => this.dom.carouselTrack.removeChild(node));
      orderedSlots.forEach((slot, position) => {
        const currentNode = this.dom.carouselTrack.children[position];
        if (currentNode !== slot) this.dom.carouselTrack.insertBefore(slot, currentNode || null);
      });
      this.state.renderedIndexes = renderedIndexes;
      this.updateNavState();
    }

    loadFullImage(item) {
      if (!item || item.type === 'video' || !item.fullUrl) return Promise.resolve('');
      const existingObjectUrl = window.mediaAssetCache?.peekObjectUrl(item.fullUrl);
      if (existingObjectUrl) {
        this.state.loadedFullMedia.add(item.id);
        return Promise.resolve(existingObjectUrl);
      }
      const pending = this.state.pendingFullImageLoads.get(item.id);
      if (pending) return pending.promise;

      const promise = Promise.resolve(window.mediaAssetCache?.getObjectUrl(item.fullUrl, { fallbackFetch: true }))
        .then((objectUrl) => {
          if (objectUrl) {
            this.state.loadedFullMedia.add(item.id);
            this.refreshRenderedFullImage(item);
          }
          return objectUrl || '';
        })
        .catch(() => '')
        .finally(() => {
          this.state.pendingFullImageLoads.delete(item.id);
        });

      this.state.pendingFullImageLoads.set(item.id, { promise });
      return promise;
    }

    primeFullImage(item) {
      void this.loadFullImage(item);
    }

    primeNeighbors(centerIndex = this.state.index) {
      const items = this.getItems();
      const radius = 1;
      for (let offset = 1; offset <= radius; offset += 1) {
        const left = items[centerIndex - offset];
        const right = items[centerIndex + offset];
        if (left) this.primeFullImage(left);
        if (right) this.primeFullImage(right);
      }
    }

    getBackgroundPreloadLimit() {
      return 2;
    }

    buildBackgroundPreloadQueue(centerIndex = this.state.index) {
      const items = this.getItems();
      const queue = [];
      const queuedIds = new Set();
      if (!items.length) return { queue, queuedIds };

      const pushIndex = (itemIndex) => {
        const item = items[itemIndex];
        if (!item || item.type === 'video' || !item.fullUrl) return;
        if (this.state.loadedFullMedia.has(item.id) || this.state.pendingFullImageLoads.has(item.id) || queuedIds.has(item.id)) return;
        queue.push(item);
        queuedIds.add(item.id);
      };

      pushIndex(centerIndex);
      for (let offset = 1; offset < items.length; offset += 1) {
        pushIndex(centerIndex - offset);
        pushIndex(centerIndex + offset);
      }

      return { queue, queuedIds };
    }

    scheduleBackgroundPreload(centerIndex = this.state.index) {
      const { queue, queuedIds } = this.buildBackgroundPreloadQueue(centerIndex);
      this.state.backgroundPreloadQueue = queue;
      this.state.backgroundPreloadQueuedIds = queuedIds;
      this.drainBackgroundPreloadQueue();
    }

    drainBackgroundPreloadQueue() {
      while (this.state.backgroundPreloadActive < this.getBackgroundPreloadLimit() && this.state.backgroundPreloadQueue.length) {
        const nextItem = this.state.backgroundPreloadQueue.shift();
        if (!nextItem) break;
        this.state.backgroundPreloadQueuedIds.delete(nextItem.id);
        if (!nextItem.fullUrl || nextItem.type === 'video' || this.state.loadedFullMedia.has(nextItem.id)) continue;

        this.state.backgroundPreloadActive += 1;
        this.loadFullImage(nextItem).finally(() => {
          this.state.backgroundPreloadActive = Math.max(0, this.state.backgroundPreloadActive - 1);
          this.drainBackgroundPreloadQueue();
        });
      }
    }

    resetCloseAnimationState() {
      this.clearCloseAnimationTimer();
      this.root.classList.remove('is-closing', 'is-closing-fade', 'is-stage-closing');
    }

    prepareForClose() {
      this.clearPreviewHideTimer();
      if (this.state.wheelCommitTimer) {
        window.clearTimeout(this.state.wheelCommitTimer);
        this.state.wheelCommitTimer = 0;
      }
      this.closeFolderModal();
      this.stopMomentum();
      this.stopCarouselAnimation({ jumpToCurrent: false });
      this.state.pointers.clear();
      this.state.primaryGesture = null;
      this.state.primaryPointerId = null;
      this.state.pinchStartDistance = null;
      this.state.pinchStartZoom = this.state.zoom;
      this.state.detailsTouchId = null;
      this.state.detailsTouchGesture = null;
      this.state.detailsPointerGesture = null;
      this.state.velocityX = 0;
      this.state.velocityY = 0;
      this.dom.canvas.classList.remove('is-panning');
    }

    clearRenderedMedia() {
      this.clearPreviewHideTimer();
      this.dom.video.pause();
      this.dom.video.removeAttribute('src');
      this.dom.video.load();
      this.dom.video.poster = '';
      this.dom.image.removeAttribute('src');
      this.setLoadingState(false);
      if (this.dom.mediaFrame.parentNode) this.dom.mediaFrame.parentNode.removeChild(this.dom.mediaFrame);
      this.dom.carouselTrack.replaceChildren();
      this.state.renderedIndexes = [];
      this.setCarouselTranslate(0);
    }

    requestClose(reason = 'request', detail = {}) {
      this.state.pendingCloseRequest = { reason, ...detail };
      if (typeof this.options.onRequestClose === 'function') {
        this.options.onRequestClose({ reason, viewer: this, ...detail });
        return;
      }
      this.close(detail.closeOptions || {}).catch((error) => this.handleError(error));
    }

    open(index, { forceDateToast = false } = {}) {
      const items = this.getItems();
      if (!items.length) return false;
      this.state.index = clamp(index, 0, items.length - 1);
      this.state.descriptionDirty = false;
      this.root.classList.remove('hidden');
      this.stopCarouselAnimation({ jumpToCurrent: false });
      this.resetCloseAnimationState();
      this.state.pendingCloseRequest = null;
      this.state.closing = false;
      this.setChromeVisible(true, { immediate: true });
      this.resetStageGesture(false);
      this.commitDetails(false, { immediate: true });
      this.options.onOpen?.({ viewer: this, item: this.getCurrentItem(), index: this.state.index, forceDateToast });
      this.render(0, { forceDateToast });
      return true;
    }

    async close({ animate = true, preserveGesture = null } = {}) {
      if (!this.isOpen() && !this.state.closing) return;
      const closeOptions = this.state.pendingCloseRequest?.closeOptions || {};
      const shouldPreserveGesture = Boolean(preserveGesture ?? closeOptions.preserveGesture);
      this.flushPendingChanges({ reason: 'viewer-close' });
      this.prepareForClose();

      const finishClose = () => {
        this.clearRenderedMedia();
        this.resetStageGesture(false);
        this.commitDetails(false, { immediate: true });
        this.resetTransform();
        this.resetCloseAnimationState();
        this.root.classList.remove('details-open', 'is-stage-settling', 'is-details-animating', 'is-carousel-settling');
        this.root.classList.add('hidden');
        this.state.closing = false;
        this.state.pendingCloseRequest = null;
        this.options.onClose?.({ viewer: this });
      };

      if (!animate) {
        finishClose();
        return;
      }

      this.resetCloseAnimationState();
      this.state.closing = true;
      this.root.classList.add('is-closing');
      if (shouldPreserveGesture) {
        this.root.classList.add('is-stage-closing');
        requestAnimationFrame(() => {
          if (!this.state.closing) return;
          const height = this.dom.stage.clientHeight || window.innerHeight || 1;
          this.state.dismissOffsetY = Math.max(this.state.dismissOffsetY, height + 56);
          this.state.swipeOffsetX *= 0.16;
          this.applyStageGesture({ dismissing: true });
        });
        this.state.closeAnimationTimer = window.setTimeout(finishClose, 240);
        return;
      }

      this.root.classList.add('is-closing-fade');
      this.state.closeAnimationTimer = window.setTimeout(finishClose, 220);
    }

    refresh({ preferredIndex = this.state.index, direction = 0, forceDateToast = false } = {}) {
      const items = this.getItems();
      if (!items.length) return false;
      this.state.index = clamp(preferredIndex, 0, items.length - 1);
      this.stopCarouselAnimation({ jumpToCurrent: false });
      if (this.isOpen()) this.render(direction, { forceDateToast });
      return true;
    }

    async step(direction, { dragOffsetX = 0 } = {}) {
      const normalizedDirection = direction > 0 ? 1 : -1;
      if (!this.canNavigateDirection(normalizedDirection)) {
        this.animateCarouselToCurrent(dragOffsetX);
        return;
      }
      if (this.state.carouselAnimating) this.finishCarouselAnimation();
      if (this.state.zoom > 1.01) this.resetTransform();
      this.flushPendingChanges({ reason: 'navigate' });
      const previousIndex = this.state.index;
      this.state.index = previousIndex + normalizedDirection;
      this.render(normalizedDirection, {
        animate: true,
        outgoingIndex: previousIndex,
        dragOffsetX,
        contentIndex: previousIndex,
        detailIndex: this.state.index,
        mountIndex: previousIndex
      });
    }

    stopMomentum() {
      if (this.state.momentumFrame) {
        cancelAnimationFrame(this.state.momentumFrame);
        this.state.momentumFrame = null;
      }
    }

    startMomentum() {
      this.stopMomentum();
      const step = () => {
        this.state.velocityX *= 0.92;
        this.state.velocityY *= 0.92;
        if (Math.abs(this.state.velocityX) < 0.08 && Math.abs(this.state.velocityY) < 0.08) {
          this.state.velocityX = 0;
          this.state.velocityY = 0;
          this.state.momentumFrame = null;
          return;
        }
        this.state.panX += this.state.velocityX;
        this.state.panY += this.state.velocityY;
        this.updateTransform();
        this.state.momentumFrame = requestAnimationFrame(step);
      };
      this.state.momentumFrame = requestAnimationFrame(step);
    }

    resetTransform() {
      this.stopMomentum();
      this.state.zoom = 1;
      this.state.panX = 0;
      this.state.panY = 0;
      this.state.velocityX = 0;
      this.state.velocityY = 0;
      this.updateTransform();
    }

    activeNode() {
      return this.dom.image.classList.contains('hidden') ? this.dom.video : this.dom.image;
    }

    getMediaSafeInsets() {
      if (!this.state.chromeVisible) {
        return {
          top: 0,
          right: 0,
          bottom: 0,
          left: 0
        };
      }

      const styles = window.getComputedStyle(this.root);
      const readInset = (name) => {
        const value = Number.parseFloat(styles.getPropertyValue(name));
        return Number.isFinite(value) ? Math.max(0, value) : 0;
      };

      return {
        top: readInset('--viewer-media-safe-top'),
        right: readInset('--viewer-media-safe-right'),
        bottom: readInset('--viewer-media-safe-bottom'),
        left: readInset('--viewer-media-safe-left')
      };
    }

    getBaseSize() {
      const stageRect = this.dom.stage.getBoundingClientRect();
      const node = this.activeNode();
      const naturalWidth = node.videoWidth || node.naturalWidth || node.clientWidth || 1;
      const naturalHeight = node.videoHeight || node.naturalHeight || node.clientHeight || 1;
      const safeInsets = this.getMediaSafeInsets();
      const availableWidth = Math.max(1, stageRect.width - safeInsets.left - safeInsets.right);
      const availableHeight = Math.max(1, stageRect.height - safeInsets.top - safeInsets.bottom);
      const scale = Math.min(availableWidth / naturalWidth, availableHeight / naturalHeight, 1);
      return {
        stageWidth: stageRect.width,
        stageHeight: stageRect.height,
        availableWidth,
        availableHeight,
        fittedWidth: naturalWidth * scale,
        fittedHeight: naturalHeight * scale
      };
    }

    updateTransform() {
      const node = this.activeNode();
      const isVisible = node && !node.classList.contains('hidden');
      if (!isVisible) {
        this.dom.zoomReset.textContent = '100%';
        this.dom.canvas.classList.remove('is-pannable', 'is-panning');
        this.root.style.setProperty('--viewer-canvas-pan-x', '0px');
        this.root.style.setProperty('--viewer-canvas-pan-y', '0px');
        this.root.style.setProperty('--viewer-canvas-scale', '1');
        return;
      }

      const base = this.getBaseSize();
      const effectiveZoom = this.state.zoom;
      const maxPanX = Math.max(0, (base.fittedWidth * effectiveZoom - base.availableWidth) / 2);
      const maxPanY = Math.max(0, (base.fittedHeight * effectiveZoom - base.availableHeight) / 2);
      this.state.panX = clamp(this.state.panX, -maxPanX, maxPanX);
      this.state.panY = clamp(this.state.panY, -maxPanY, maxPanY);
      this.root.style.setProperty('--viewer-canvas-pan-x', `${this.state.panX}px`);
      this.root.style.setProperty('--viewer-canvas-pan-y', `${this.state.panY}px`);
      this.root.style.setProperty('--viewer-canvas-scale', `${this.state.zoom}`);
      this.dom.zoomReset.textContent = `${Math.round(this.state.zoom * 100)}%`;
      this.dom.canvas.classList.toggle('is-pannable', this.state.zoom > 1.01);
    }

    setZoom(nextZoom, origin = null) {
      this.stopMomentum();
      const previousZoom = this.state.zoom;
      const clampedZoom = clamp(nextZoom, 1, 6);
      if (origin && previousZoom > 0) {
        const stageRect = this.dom.stage.getBoundingClientRect();
        const ox = origin.clientX - stageRect.left - stageRect.width / 2;
        const oy = origin.clientY - stageRect.top - stageRect.height / 2;
        const ratio = clampedZoom / previousZoom;
        this.state.panX = (this.state.panX - ox) * ratio + ox;
        this.state.panY = (this.state.panY - oy) * ratio + oy;
      }
      this.state.zoom = clampedZoom;
      if (this.state.zoom === 1) {
        this.state.panX = 0;
        this.state.panY = 0;
      }
      this.updateTransform();
    }

    commitDetails(open, { immediate = false } = {}) {
      const nextOpen = Boolean(open);
      if (this.state.detailsOpen && !nextOpen) {
        this.flushPendingChanges({ reason: 'details-close' }).catch((error) => this.handleError(error));
      }
      this.state.detailsOpen = nextOpen;
      this.applyDetailsProgress(this.state.detailsOpen ? 1 : 0, { immediate });
    }

    toggleChrome() {
      this.setChromeVisible(!this.state.chromeVisible);
    }

    setChromeVisible(visible, { immediate = false } = {}) {
      const nextVisible = Boolean(visible);
      if (!nextVisible && this.state.detailsProgress > 0.02 && this.isMobileSheet()) return;
      this.state.chromeVisible = nextVisible;
      this.applyChromeState({ immediate });
    }

    applyChromeState({ immediate = false } = {}) {
      this.root.classList.toggle('is-chrome-hidden', !this.state.chromeVisible);
      this.root.classList.toggle('is-chrome-immediate', immediate);

      const activeElement = document.activeElement;
      if (!this.state.chromeVisible && activeElement instanceof HTMLElement && activeElement.closest('.viewer-topbar, .viewer-nav, .viewer-toolbar, .viewer-zoom-toolbar')) {
        activeElement.blur();
      }

      if (immediate) {
        window.setTimeout(() => {
          this.root.classList.remove('is-chrome-immediate');
        }, 0);
      }

      this.updateTransform();
    }

    startDetailsAnimation() {
      if (this.state.detailsAnimationTimer) window.clearTimeout(this.state.detailsAnimationTimer);
      this.root.classList.add('is-details-animating');
      this.state.detailsAnimationTimer = window.setTimeout(() => {
        this.root.classList.remove('is-details-animating');
        this.recenterCurrentSlide();
      }, 320);
    }

    cancelDetailsAnimation() {
      if (this.state.detailsAnimationTimer) window.clearTimeout(this.state.detailsAnimationTimer);
      this.state.detailsAnimationTimer = 0;
      this.root.classList.remove('is-details-animating');
    }

    getSheetTravel() {
      const rect = this.dom.details.getBoundingClientRect();
      return Math.max(rect.height + 28, 260);
    }

    applyDetailsProgress(progress, { immediate = false } = {}) {
      this.state.detailsProgress = clamp(progress, 0, 1);
      if (immediate) this.cancelDetailsAnimation();
      else this.startDetailsAnimation();
      if (this.state.detailsProgress > 0.02) this.setChromeVisible(true, { immediate });

      const mobileOffset = Math.round((1 - this.state.detailsProgress) * this.getSheetTravel());
      const mobileDetailsHeight = Math.round(this.dom.details.getBoundingClientRect().height || 0);
      const mobileVisibleHeight = Math.max(0, Math.min(mobileDetailsHeight, mobileDetailsHeight - mobileOffset));
      const desktopShift = Math.round((1 - this.state.detailsProgress) * 28);
      const desktopWidth = Math.round(this.state.detailsProgress * 340);
      const desktopGap = 0;
      this.root.style.setProperty('--viewer-details-progress', this.state.detailsProgress.toFixed(4));
      this.root.style.setProperty('--viewer-details-offset', `${mobileOffset}px`);
      this.root.style.setProperty('--viewer-mobile-details-visible', `${mobileVisibleHeight}px`);
      this.root.style.setProperty('--viewer-details-desktop-shift', `${desktopShift}px`);
      this.root.style.setProperty('--viewer-details-desktop-width', `${desktopWidth}px`);
      this.root.style.setProperty('--viewer-details-desktop-gap', `${desktopGap}px`);
      this.root.style.setProperty('--viewer-details-desktop-opacity', this.state.detailsProgress.toFixed(4));
      this.root.classList.toggle('details-open', this.state.detailsProgress > 0.02);
      this.dom.details.classList.toggle('open', this.state.detailsProgress > 0.55);
      this.dom.info.classList.toggle('is-active', this.state.detailsProgress > 0.55);
      this.updateTransform();
    }

    markGestureActivity() {
      this.state.suppressClickUntil = performance.now() + 260;
    }

    cancelStageSettle() {
      if (this.state.stageSettleTimer) window.clearTimeout(this.state.stageSettleTimer);
      this.state.stageSettleTimer = 0;
      this.root.classList.remove('is-stage-settling');
    }

    resetStageGesture(animate = true) {
      if (animate) {
        this.cancelStageSettle();
        this.root.classList.add('is-stage-settling');
        this.state.stageSettleTimer = window.setTimeout(() => {
          this.root.classList.remove('is-stage-settling');
        }, 260);
      } else {
        this.cancelStageSettle();
      }

      this.state.swipeOffsetX = 0;
      this.state.dismissOffsetY = 0;
      this.applyStageGesture();
    }

    applyStageGesture({ dismissing = false } = {}) {
      const width = this.dom.stage.clientWidth || window.innerWidth || 1;
      const height = this.dom.stage.clientHeight || window.innerHeight || 1;
      const horizontalProgress = Math.min(Math.abs(this.state.swipeOffsetX) / width, 1);
      const verticalProgress = Math.min(this.state.dismissOffsetY / height, 1);
      const fade = dismissing
        ? Math.max(horizontalProgress * 0.14, verticalProgress)
        : Math.max(horizontalProgress * 0.14, verticalProgress * 0.74);
      const scale = 1 - Math.max(horizontalProgress * 0.04, verticalProgress * (dismissing ? 0.1 : 0.08));
      const rotate = clamp(this.state.swipeOffsetX / Math.max(width, 1), -1, 1) * 3.5;

      this.root.style.setProperty('--viewer-swipe-x', `${Math.round(this.state.swipeOffsetX)}px`);
      this.root.style.setProperty('--viewer-dismiss-y', `${Math.round(this.state.dismissOffsetY)}px`);
      this.root.style.setProperty('--viewer-frame-scale', `${scale.toFixed(4)}`);
      this.root.style.setProperty('--viewer-frame-rotate', `${rotate.toFixed(2)}deg`);
      this.root.style.setProperty('--viewer-gesture-opacity', `${(1 - fade).toFixed(4)}`);
    }

    getRelativeItem(offset) {
      const items = this.getItems();
      if (!items.length) return null;
      const index = this.state.index + offset;
      if (index < 0 || index >= items.length) return null;
      return items[index] || null;
    }

    setLoadingState(active) {
      this.state.loadingActive = Boolean(active);
      this.updateStatus(this.getCurrentItem());
    }

    getDateStatusInfo(item) {
      if (!item) return { indexWithinDate: 1, totalWithinDate: 1 };
      const items = this.getItems();
      if (this.state.dateStatusItemsRef !== items) {
        const grouped = new Map();
        items.forEach((entry) => {
          const key = entry?.isoDate || '';
          const bucket = grouped.get(key) || [];
          bucket.push(entry?.id || '');
          grouped.set(key, bucket);
        });

        const cache = new Map();
        grouped.forEach((ids) => {
          const total = ids.length || 1;
          ids.forEach((id, index) => {
            cache.set(id, {
              indexWithinDate: index + 1,
              totalWithinDate: total
            });
          });
        });

        this.state.dateStatusItemsRef = items;
        this.state.dateStatusCache = cache;
      }

      return this.state.dateStatusCache.get(item.id) || { indexWithinDate: 1, totalWithinDate: 1 };
    }

    updateStatus(item) {
      if (!item) {
        this.dom.count.textContent = '';
        this.dom.caption.innerHTML = '';
        this.dom.caption.classList.add('is-empty');
        this.dom.caption.classList.remove('is-loading');
        this.updateDescriptionSummary(null);
        return;
      }

      const { indexWithinDate, totalWithinDate } = this.getDateStatusInfo(item);
      this.dom.count.textContent = item.dateLabel || item.isoDate || '';
      this.dom.caption.innerHTML = `${this.state.loadingActive ? renderPhIcon('spinner-gap', { spin: true }) : ''}${indexWithinDate} / ${totalWithinDate}`;
      this.dom.caption.classList.toggle('is-empty', false);
      this.dom.caption.classList.toggle('is-loading', this.state.loadingActive);
      this.updateDescriptionSummary(item);
    }

    updateLikeButton(item = this.getCurrentItem()) {
      const liked = Boolean(item?.liked);
      this.dom.like.classList.toggle('is-active', liked);
      this.dom.like.classList.toggle('is-saving', this.state.likeSaving);
      this.dom.like.setAttribute('aria-label', liked ? 'Unlike media' : 'Like media');
      this.dom.like.innerHTML = liked
        ? renderPhIcon('heart', { variant: 'fill' })
        : renderPhIcon('heart', { variant: 'regular' });
    }

    renderDetails(item) {
      const resolution = item?.width && item?.height ? `${item.width} × ${item.height}` : '-';
      const size = formatFileSize(item?.size) || '-';
      this.dom.detailsMeta.textContent = `${resolution} / ${size}`;
      this.state.fileNameValidationToken += 1;
      if (this.state.fileNameValidationTimer) window.clearTimeout(this.state.fileNameValidationTimer);
      this.state.fileNameValidationTimer = 0;
      this.dom.fileName.value = item?.baseName || (item?.fileName && item?.ext ? item.fileName.slice(0, -item.ext.length) : '') || '';
      this.setFileNameValidationState('valid');
      this.dom.fileExtension.textContent = item?.ext || '';
      this.state.selectedFolderRootId = item?.folderRootId || '';
      this.state.selectedFolderPath = item?.folder === '.' ? '' : (item?.folder || '');
      this.updateFolderDraftLabel();
      this.dom.dateInput.value = item?.isoDate || '';
      this.dom.timeInput.value = this.extractTimeValue(item);
      this.setDescriptionValue(typeof this.options.getDescriptionValue === 'function'
        ? this.options.getDescriptionValue(item) || ''
        : (item?.description || ''));
      this.state.descriptionDirty = false;
      this.updateLikeButton(item);
      this.updateStatus(item);
      this.applyDetailsProgress(this.state.detailsProgress, { immediate: true });
    }

    animateCarouselToCurrent(startOffsetX = this.state.carouselDragOffsetX) {
      if (this.state.index < 0) return;
      const currentPosition = this.findRenderedPosition(this.state.index);
      if (currentPosition < 0) {
        this.rebuildCarouselWindow(this.state.index);
        this.animateCarouselToCurrent(startOffsetX);
        return;
      }
      const startX = this.getTrackXForPosition(currentPosition) + startOffsetX;
      const endX = this.getTrackXForPosition(currentPosition);
      this.state.carouselDragOffsetX = 0;
      this.startCarouselAnimation(startX, endX, 0);
    }

    startCarouselAnimation(startX, endX, direction) {
      this.clearCarouselAnimationTimer();
      const token = ++this.state.animationToken;
      this.state.carouselAnimating = true;
      this.state.carouselAnimationDirection = direction;
      this.root.classList.remove('is-carousel-settling');
      this.setCarouselTranslate(startX);
      void this.dom.carouselTrack.offsetWidth;
      this.root.classList.add('is-carousel-settling');
      requestAnimationFrame(() => {
        if (token !== this.state.animationToken) return;
        this.setCarouselTranslate(endX);
      });
      this.state.carouselAnimationTimer = window.setTimeout(() => {
        if (token !== this.state.animationToken) return;
        this.finishCarouselAnimation();
      }, 320);
    }

    updateCarouselDrag(rawOffsetX) {
      const currentPosition = this.findRenderedPosition(this.state.index);
      if (currentPosition < 0) return;
      let adjusted = rawOffsetX;
      if ((rawOffsetX > 0 && !this.canNavigateDirection(-1)) || (rawOffsetX < 0 && !this.canNavigateDirection(1))) {
        adjusted *= 0.28;
      }
      this.state.carouselDragOffsetX = adjusted;
      this.root.classList.remove('is-carousel-settling');
      this.setCarouselTranslate(this.getTrackXForPosition(currentPosition) + adjusted);
    }

    render(direction = 0, {
      forceDateToast = false,
      animate = false,
      outgoingIndex = null,
      dragOffsetX = 0,
      contentIndex = this.state.index,
      detailIndex = this.state.index,
      mountIndex = this.state.index,
      skipAnnounce = false,
      skipDetails = false
    } = {}) {
      const detailItem = this.getItemAt(detailIndex);
      const contentItem = this.getItemAt(contentIndex);
      if (!detailItem || !contentItem) return;

      this.closeFolderModal();
      this.dom.video.pause();
      this.dom.video.removeAttribute('src');
      this.dom.video.load();
      this.dom.video.poster = '';

      if (!skipDetails) this.renderDetails(detailItem);
      this.state.loadToken += 1;
      const token = this.state.loadToken;
      this.state.pointers.clear();
      this.state.primaryGesture = null;
      this.state.primaryPointerId = null;
      this.state.pinchStartDistance = null;
      this.stopMomentum();
      this.state.velocityX = 0;
      this.state.velocityY = 0;
      this.resetStageGesture(false);
      this.resetTransform();
      this.state.carouselDragOffsetX = 0;
      this.setLoadingState(true);
      this.scheduleMountedSlotPreviewHidden(false);
      this.setMediaFrameLoaded(false);
      if (contentItem.type === 'image') {
        this.dom.image.classList.remove('hidden');
        this.dom.image.removeAttribute('src');
        const previewSrc = this.getPreviewSrc(contentItem);
        if (previewSrc) {
          const previewToken = token;
          window.mediaAssetCache?.getObjectUrl(previewSrc, { fallbackFetch: true }).then((objectUrl) => {
            if (!objectUrl || previewToken !== this.state.loadToken) return;
            this.dom.image.src = objectUrl;
          }).catch(() => {});
        }
      } else {
        this.dom.image.classList.add('hidden');
        this.dom.image.removeAttribute('src');
      }
      this.dom.video.classList.add('hidden');
      this.dom.video.removeAttribute('src');
      this.dom.video.load();
      this.dom.video.poster = '';
      this.primeFullImage(contentItem);
      if (detailItem.id !== contentItem.id) this.primeFullImage(detailItem);
      this.primeNeighbors(detailIndex);
      this.updateNavState();
      if (!skipAnnounce) this.options.onItemChange?.(detailItem, this.state.index, { direction, forceDateToast, viewer: this });

      if (contentItem.type === 'video') {
        this.dom.video.classList.remove('hidden');
        if (contentItem.thumbUrl) this.dom.video.poster = contentItem.thumbUrl;
        else this.dom.video.removeAttribute('poster');
        this.dom.video.addEventListener('loadeddata', () => {
          if (token !== this.state.loadToken) return;
          this.state.loadedFullMedia.add(contentItem.id);
          this.setMediaFrameLoaded(true);
          this.scheduleMountedSlotPreviewHidden(true, { delay: 220, token });
          this.setLoadingState(false);
          this.updateTransform();
        }, { once: true });
        this.dom.video.src = contentItem.fullUrl;
        this.dom.video.load();
      } else {
        this.dom.image.alt = contentItem.fileName || 'Selected media';
        if (this.state.loadedFullMedia.has(contentItem.id) && contentItem.fullUrl) {
          this.loadFullImage(contentItem).then((objectUrl) => {
            if (!objectUrl || token !== this.state.loadToken) return false;
            return this.revealCurrentImage(objectUrl, token);
          }).then((revealed) => {
            if (revealed || token !== this.state.loadToken) return;
            this.setLoadingState(false);
            this.updateTransform();
          });
        } else {
          this.loadFullImage(contentItem).then((objectUrl) => {
            if (token !== this.state.loadToken) return;
            if (objectUrl) {
              this.revealCurrentImage(objectUrl, token).then((revealed) => {
                if (revealed || token !== this.state.loadToken) return;
                this.setLoadingState(false);
                this.updateTransform();
              });
              return;
            }
            this.setLoadingState(false);
            this.updateTransform();
          });
        }
      }

      this.rebuildCarouselWindow(detailIndex, animate && outgoingIndex !== null ? [outgoingIndex] : [], { mountIndex });
      const currentPosition = this.findRenderedPosition(detailIndex);
      const outgoingPosition = outgoingIndex === null ? currentPosition : this.findRenderedPosition(outgoingIndex);
      const restingX = currentPosition >= 0 ? this.getTrackXForPosition(currentPosition) : 0;
      if (!animate) this.setCarouselTranslate(restingX);

      if (animate && currentPosition >= 0) {
        const startPosition = outgoingPosition >= 0 ? outgoingPosition : currentPosition;
        this.startCarouselAnimation(
          this.getTrackXForPosition(startPosition) + dragOffsetX,
          restingX,
          direction
        );
      }

      if (!animate && !this.state.carouselAnimating) {
        this.scheduleBackgroundPreload(detailIndex);
      }
    }

    getPointerDistance() {
      const points = Array.from(this.state.pointers.values());
      if (points.length < 2) return 0;
      const [a, b] = points;
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }

    getPointerCenter() {
      const points = Array.from(this.state.pointers.values());
      if (points.length < 2) return null;
      const [a, b] = points;
      return {
        clientX: (a.clientX + b.clientX) / 2,
        clientY: (a.clientY + b.clientY) / 2
      };
    }

    async toggleLike() {
      const item = this.getCurrentItem();
      if (!item || this.state.likeSaving) return;

      const previous = Boolean(item.liked);
      const nextLiked = !previous;
      item.liked = nextLiked;
      this.state.likeSaving = true;
      this.updateLikeButton(item);

      try {
        if (typeof this.options.onToggleLike === 'function') {
          const result = await this.options.onToggleLike(item, nextLiked, this);
          if (typeof result === 'boolean') item.liked = result;
          else if (result && Object.prototype.hasOwnProperty.call(result, 'liked')) item.liked = Boolean(result.liked);
        }
      } catch (error) {
        item.liked = previous;
        throw error;
      } finally {
        this.state.likeSaving = false;
        this.updateLikeButton(this.getCurrentItem());
      }
    }

    async downloadCurrent() {
      const item = this.getCurrentItem();
      if (!item) return;

      if (typeof this.options.onDownload === 'function') {
        await this.options.onDownload(item, this);
        return;
      }

      if (!item.fullUrl) return;
      const link = document.createElement('a');
      link.href = item.fullUrl;
      link.download = item.fileName || '';
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }

    async shareCurrent() {
      const item = this.getCurrentItem();
      if (!item) return;

      if (typeof this.options.onShare === 'function') {
        await this.options.onShare(item, this);
        return;
      }

      const shareUrl = item.fullUrl || window.location.href;
      const shareData = {
        title: item.fileName || 'Media',
        text: item.description || item.fileName || 'Media',
        url: shareUrl
      };

      if (typeof navigator.share === 'function') {
        await navigator.share(shareData);
        return;
      }

      try {
        if (await this.copyCurrentMediaToClipboard(item)) {
          return;
        }
      } catch (error) {
        console.warn('Image clipboard copy failed, falling back to URL copy.', error);
      }

      if (this.canWriteClipboardText()) {
        await navigator.clipboard.writeText(shareUrl);
        return;
      }

      throw new Error('Sharing is not supported on this device.');
    }

    async saveDescriptionIfNeeded({ force = false } = {}) {
      if (!force && !this.state.descriptionDirty) return;
      await this.saveDescription();
    }
  }

  window.createMediaViewer = function createMediaViewer(options) {
    return new MediaViewer(options);
  };
}());
