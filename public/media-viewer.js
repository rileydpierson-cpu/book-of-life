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

  class MediaViewer {
    constructor(options = {}) {
      this.options = options;
      this.state = {
        index: -1,
        loadToken: 0,
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
        tagsDraft: [],
        tagsSaving: false,
        tagsSaveTimer: 0,
        tagFocusOutTimer: 0,
        likeSaving: false,
        dateModalOpen: false,
        dateSaving: false,
        suppressClickUntil: 0,
        pendingCloseRequest: null,
        closeAnimationTimer: 0,
        carouselCommitTimer: 0,
        suppressCarouselCommit: false,
        loadedFullMedia: new Set(),
        carouselAnimationFrame: 0,
        carouselAnimationDirection: 0,
        carouselAnimating: false,
        queuedStepDirection: 0,
        pendingFullImageLoads: new Map(),
        slotMediaRegistry: new Map()
      };

      this.handleResize = this.handleResize.bind(this);
      this.handleKeydown = this.handleKeydown.bind(this);
      this.handleCarouselScroll = this.handleCarouselScroll.bind(this);
      this.handleStagePointerMove = this.handleStagePointerMove.bind(this);
      this.handleStagePointerEnd = this.handleStagePointerEnd.bind(this);
      this.handleDetailsTouchMove = this.handleDetailsTouchMove.bind(this);
      this.handleDetailsTouchEnd = this.handleDetailsTouchEnd.bind(this);
      this.handleDetailsPointerMove = this.handleDetailsPointerMove.bind(this);
      this.handleDetailsPointerEnd = this.handleDetailsPointerEnd.bind(this);

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
              <div class="viewer-topbar-group">
                <button class="viewer-close viewer-info-button" data-role="info" type="button" aria-label="Show media details">
                  <i class="fa-solid fa-circle-info"></i>
                </button>
                <button class="viewer-close viewer-like-button" data-role="like" type="button" aria-label="Like media">
                  <i class="fa-solid fa-heart"></i>
                </button>
              </div>
              <div class="viewer-status">
                <p class="viewer-status-count" data-role="count"></p>
                <p class="viewer-status-caption" data-role="caption"></p>
              </div>
              <div class="viewer-topbar-group viewer-topbar-group-right">
                <button class="viewer-close viewer-delete-button hidden" data-role="delete" type="button" aria-label="Delete media">
                  <i class="fa-solid fa-trash"></i>
                </button>
                <button class="viewer-close" data-role="close" type="button" aria-label="Close viewer">
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>
            </header>

            <button class="viewer-nav viewer-nav-left" data-role="prev" type="button" aria-label="Previous media">
              <i class="fa-solid fa-chevron-left"></i>
            </button>

            <div class="viewer-stage" data-role="stage">
              <div class="viewer-carousel" data-role="carousel">
                <div class="viewer-slot viewer-slot-side" data-role="slot-prev">
                  <div class="viewer-slot-preview" data-role="slot-prev-media"></div>
                </div>
                <div class="viewer-slot viewer-slot-current" data-role="slot-current">
                  <div class="viewer-media-frame" data-role="media-frame">
                    <div class="viewer-canvas" data-role="canvas">
                      <img class="viewer-image hidden" data-role="image" alt="Selected media" draggable="false" />
                      <video class="viewer-video hidden" data-role="video" controls playsinline preload="metadata" draggable="false"></video>
                    </div>
                  </div>
                </div>
                <div class="viewer-slot viewer-slot-side" data-role="slot-next">
                  <div class="viewer-slot-preview" data-role="slot-next-media"></div>
                </div>
              </div>
              <div class="viewer-loading hidden" data-role="loading" aria-hidden="true">
                <i class="fa-solid fa-spinner fa-spin"></i>
              </div>
            </div>

            <button class="viewer-nav viewer-nav-right" data-role="next" type="button" aria-label="Next media">
              <i class="fa-solid fa-chevron-right"></i>
            </button>

            <div class="viewer-toolbar">
              <button class="viewer-tool" data-role="zoom-out" type="button" aria-label="Zoom out">
                <i class="fa-solid fa-magnifying-glass-minus"></i>
              </button>
              <button class="viewer-tool viewer-tool-percent" data-role="zoom-reset" type="button" aria-label="Reset zoom">100%</button>
              <button class="viewer-tool" data-role="zoom-in" type="button" aria-label="Zoom in">
                <i class="fa-solid fa-magnifying-glass-plus"></i>
              </button>
            </div>
          </section>

          <aside class="viewer-details" data-role="details">
            <div class="viewer-details-handle" data-role="details-handle"></div>
            <div class="viewer-details-head">
              <div class="viewer-details-copy">
                <p class="viewer-details-kicker" data-role="details-kicker"></p>
                <h2 class="viewer-details-title" data-role="details-title"></h2>
              </div>
              <button class="viewer-inline-action viewer-edit-date-button" data-role="edit-date" type="button">Edit date</button>
            </div>

            <div class="viewer-description-editor">
              <div class="viewer-section-head">
                <span>Description</span>
                <span class="viewer-section-note">Saves when you leave</span>
              </div>
              <div
                class="viewer-description-input"
                data-role="description"
                data-placeholder="Add a note about this memory"
                contenteditable="true"
                spellcheck="true"
              ></div>
            </div>

            <div class="viewer-tags-editor" data-role="tags-editor">
              <div class="viewer-section-head">
                <span>Tags</span>
                <span class="viewer-section-note">Saves when you leave</span>
              </div>
              <div class="viewer-tag-composer" data-role="tag-composer">
                <div class="viewer-tag-list" data-role="tag-list"></div>
                <div
                  class="viewer-tag-input"
                  data-role="tag-input"
                  data-placeholder="Add a tag and press Enter"
                  contenteditable="true"
                  spellcheck="false"
                ></div>
              </div>
              <div class="viewer-tag-suggestions" data-role="tag-suggestions"></div>
            </div>

            <div class="viewer-details-meta" data-role="details-meta"></div>
          </aside>
        </div>

        <div class="viewer-modal hidden" data-role="date-modal" aria-hidden="true">
          <div class="viewer-modal-backdrop" data-role="date-modal-backdrop"></div>
          <div class="viewer-modal-card" role="dialog" aria-modal="true" aria-label="Change media date">
            <div class="viewer-modal-head">
              <div>
                <p class="viewer-modal-kicker">Timeline Date</p>
                <h3 class="viewer-modal-title">Move this memory</h3>
              </div>
              <button class="viewer-close viewer-modal-close" data-role="date-cancel" type="button" aria-label="Close date editor">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
            <label class="viewer-date-field">
              <span>Display this media on</span>
              <input class="viewer-date-input" data-role="date-input" type="date" />
            </label>
            <p class="viewer-modal-copy" data-role="date-copy"></p>
            <div class="viewer-modal-actions">
              <button class="viewer-inline-action" data-role="date-reset" type="button">Use detected date</button>
              <button class="viewer-inline-action viewer-inline-action-strong" data-role="date-save" type="button">Save date</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(this.root);

      this.dom = {
        backdrop: this.root.querySelector('[data-role="backdrop"]'),
        close: this.root.querySelector('[data-role="close"]'),
        deleteButton: this.root.querySelector('[data-role="delete"]'),
        info: this.root.querySelector('[data-role="info"]'),
        like: this.root.querySelector('[data-role="like"]'),
        prev: this.root.querySelector('[data-role="prev"]'),
        next: this.root.querySelector('[data-role="next"]'),
        stage: this.root.querySelector('[data-role="stage"]'),
        carousel: this.root.querySelector('[data-role="carousel"]'),
        slotPrev: this.root.querySelector('[data-role="slot-prev"]'),
        slotCurrent: this.root.querySelector('[data-role="slot-current"]'),
        slotNext: this.root.querySelector('[data-role="slot-next"]'),
        slotPrevMedia: this.root.querySelector('[data-role="slot-prev-media"]'),
        slotNextMedia: this.root.querySelector('[data-role="slot-next-media"]'),
        mediaFrame: this.root.querySelector('[data-role="media-frame"]'),
        canvas: this.root.querySelector('[data-role="canvas"]'),
        image: this.root.querySelector('[data-role="image"]'),
        video: this.root.querySelector('[data-role="video"]'),
        loading: this.root.querySelector('[data-role="loading"]'),
        details: this.root.querySelector('[data-role="details"]'),
        detailsHandle: this.root.querySelector('[data-role="details-handle"]'),
        detailsMeta: this.root.querySelector('[data-role="details-meta"]'),
        detailsKicker: this.root.querySelector('[data-role="details-kicker"]'),
        detailsTitle: this.root.querySelector('[data-role="details-title"]'),
        editDate: this.root.querySelector('[data-role="edit-date"]'),
        description: this.root.querySelector('[data-role="description"]'),
        tagsEditor: this.root.querySelector('[data-role="tags-editor"]'),
        tagComposer: this.root.querySelector('[data-role="tag-composer"]'),
        tagList: this.root.querySelector('[data-role="tag-list"]'),
        tagInput: this.root.querySelector('[data-role="tag-input"]'),
        tagSuggestions: this.root.querySelector('[data-role="tag-suggestions"]'),
        zoomIn: this.root.querySelector('[data-role="zoom-in"]'),
        zoomOut: this.root.querySelector('[data-role="zoom-out"]'),
        zoomReset: this.root.querySelector('[data-role="zoom-reset"]'),
        count: this.root.querySelector('[data-role="count"]'),
        caption: this.root.querySelector('[data-role="caption"]'),
        dateModal: this.root.querySelector('[data-role="date-modal"]'),
        dateModalBackdrop: this.root.querySelector('[data-role="date-modal-backdrop"]'),
        dateCancel: this.root.querySelector('[data-role="date-cancel"]'),
        dateInput: this.root.querySelector('[data-role="date-input"]'),
        dateCopy: this.root.querySelector('[data-role="date-copy"]'),
        dateReset: this.root.querySelector('[data-role="date-reset"]'),
        dateSave: this.root.querySelector('[data-role="date-save"]')
      };

      if (typeof this.options.onDelete === 'function') {
        this.dom.deleteButton.classList.remove('hidden');
      }
      if (typeof this.options.onSaveDate !== 'function') {
        this.dom.editDate.hidden = true;
      }

      this.attachEvents();
      this.applyStageGesture();
      this.applyChromeState({ immediate: true });
      this.applyDetailsProgress(0, { immediate: true });
      this.setDescriptionValue('');
      this.setTagInputValue('');
      this.renderTagEditor();
    }

    attachEvents() {
      this.dom.close.addEventListener('click', () => this.requestClose('button'));
      this.dom.info.addEventListener('click', () => this.commitDetails(!this.state.detailsOpen));
      this.dom.like.addEventListener('click', () => {
        this.toggleLike().catch((error) => this.handleError(error));
      });
      this.dom.editDate.addEventListener('click', () => this.openDateModal());
      this.dom.deleteButton.addEventListener('click', () => {
        if (typeof this.options.onDelete !== 'function') return;
        Promise.resolve(this.options.onDelete(this.getCurrentItem(), this.state.index, this)).catch((error) => this.handleError(error));
      });
      this.dom.prev.addEventListener('click', () => this.step(-1));
      this.dom.next.addEventListener('click', () => this.step(1));
      this.dom.zoomIn.addEventListener('click', () => this.setZoom(this.state.zoom * 1.2));
      this.dom.zoomOut.addEventListener('click', () => this.setZoom(this.state.zoom / 1.2));
      this.dom.zoomReset.addEventListener('click', () => this.resetTransform());
      this.dom.backdrop.addEventListener('click', () => this.requestClose('backdrop'));

      this.dom.description.addEventListener('input', () => this.handleDescriptionInput());
      this.dom.description.addEventListener('blur', () => {
        this.saveDescriptionIfNeeded({ force: true }).catch((error) => this.handleError(error));
      });
      this.dom.description.addEventListener('keydown', (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          this.saveDescriptionIfNeeded({ force: true }).catch((error) => this.handleError(error));
        }
      });
      this.dom.description.addEventListener('paste', (event) => this.handleDescriptionPaste(event));

      this.dom.tagsEditor.addEventListener('focusin', () => this.clearTagFocusOutTimer());
      this.dom.tagsEditor.addEventListener('focusout', () => this.scheduleTagSaveOnLeave());
      this.dom.tagInput.addEventListener('input', () => this.handleTagInputInput());
      this.dom.tagInput.addEventListener('keydown', (event) => this.handleTagInputKeydown(event));
      this.dom.tagInput.addEventListener('paste', (event) => this.handleTagInputPaste(event));
      this.dom.tagList.addEventListener('click', (event) => {
        const removeButton = event.target.closest('[data-remove-tag]');
        if (!removeButton) return;
        this.removeTag(removeButton.dataset.removeTag);
      });
      this.dom.tagSuggestions.addEventListener('click', (event) => {
        const suggestion = event.target.closest('[data-add-tag]');
        if (!suggestion) return;
        this.addTag(suggestion.dataset.addTag);
      });

      this.dom.dateModalBackdrop.addEventListener('click', () => this.closeDateModal());
      this.dom.dateCancel.addEventListener('click', () => this.closeDateModal());
      this.dom.dateReset.addEventListener('click', () => {
        this.saveDateOverride(null).catch((error) => this.handleError(error));
      });
      this.dom.dateSave.addEventListener('click', () => {
        this.saveDateOverride(this.dom.dateInput.value || null).catch((error) => this.handleError(error));
      });
      this.dom.dateInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        this.saveDateOverride(this.dom.dateInput.value || null).catch((error) => this.handleError(error));
      });

      this.dom.details.addEventListener('click', (event) => event.stopPropagation());
      this.dom.stage.addEventListener('click', (event) => {
        if (performance.now() < this.state.suppressClickUntil) return;
        if (event.target.closest('button')) return;
        if (event.target === this.dom.image || event.target === this.dom.video) {
          if (this.state.detailsProgress <= 0.02) this.toggleChrome();
          return;
        }
        if (this.state.detailsProgress > 0.08 && this.isMobileSheet()) {
          this.commitDetails(false);
          return;
        }
        this.requestClose('stage');
      });

      this.dom.stage.addEventListener('wheel', (event) => this.handleStageWheel(event), { passive: false });
      this.dom.details.addEventListener('wheel', (event) => this.handleDetailsWheel(event), { passive: false });

      this.dom.stage.addEventListener('dblclick', (event) => {
        if (event.target === this.dom.video) return;
        if (this.state.zoom > 1.01) this.resetTransform();
        else this.setZoom(2, { clientX: event.clientX, clientY: event.clientY });
      });

      this.dom.image.addEventListener('load', () => {
        this.updateLoadingPosition();
        this.updateTransform();
      });
      this.dom.video.addEventListener('loadedmetadata', () => {
        this.updateLoadingPosition();
        this.updateTransform();
      });
      this.dom.video.addEventListener('play', () => {
        this.resetStageGesture(false);
      });

      this.dom.stage.addEventListener('pointerdown', (event) => this.handleStagePointerStart(event));
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

      this.dom.carousel.addEventListener('scroll', this.handleCarouselScroll, { passive: true });
      window.addEventListener('resize', this.handleResize);
      document.addEventListener('keydown', this.handleKeydown);
    }

    handleResize() {
      if (!this.isOpen()) return;
      this.applyDetailsProgress(this.state.detailsProgress, { immediate: true });
      this.centerCarousel();
      this.updateTransform();
      this.updateLoadingPosition();
    }

    handleKeydown(event) {
      if (!this.isOpen()) return;

      if (this.state.dateModalOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          this.closeDateModal();
        }
        return;
      }

      const activeElement = document.activeElement;
      if (activeElement && activeElement.closest('.viewer-description-input, .viewer-tag-input')) {
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
        this.step(-1);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        this.step(1);
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
      if (this.state.dateModalOpen) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (event.target === this.dom.video && event.pointerType === 'mouse') return;
      if (event.target.closest('.viewer-topbar, .viewer-toolbar')) return;
      if (this.state.carouselAnimating) {
        this.stopCarouselAnimation();
        this.clearCarouselCommitTimer();
      }

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
        if (absX > absY * 1.1) gesture.mode = 'native-scroll';
        else if (dyTotal > 0 && this.state.detailsProgress < 0.05) gesture.mode = 'dismiss';
        else if (this.isMobileSheet()) gesture.mode = 'details';
        else gesture.mode = 'idle';
      }

      if (gesture.mode === 'native-scroll') return;

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

      if (gesture.mode === 'native-scroll') {
        this.resetStageGesture(false);
      } else if (gesture.mode === 'dismiss') {
        const height = this.dom.stage.clientHeight || window.innerHeight || 1;
        const projected = this.state.dismissOffsetY + Math.max(0, this.state.velocityY) * 14;
        if (projected > height * 0.16) this.requestClose('swipe-down', { closeOptions: { preserveGesture: true } });
        else this.resetStageGesture(true);
      } else {
        this.commitDetails(this.shouldOpenDetails(this.state.detailsProgress, this.state.velocityY));
      }

      if (gesture.moved) this.markGestureActivity();
      this.state.velocityX = 0;
      this.state.velocityY = 0;
    }

    handleDetailsTouchStart(event) {
      if (!this.isMobileSheet()) return;
      if (!this.isOpen() || this.state.dateModalOpen || this.state.detailsProgress < 0.99) return;
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
      if (!this.isOpen() || this.state.dateModalOpen || this.state.detailsProgress < 0.99) return;
      if (event.pointerType === 'touch') return;
      if (event.button !== 0) return;
      if (!event.target.closest('.viewer-details-handle, .viewer-details-head')) return;
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
      return target.closest('.viewer-description-input, .viewer-tag-input');
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
      this.syncDescriptionEmptyState();
      this.clearDescriptionSaveTimer();
      this.updateStatus(this.getCurrentItem());
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
      return normalizeDescriptionText(this.dom.description.innerText || '');
    }

    setDescriptionValue(value) {
      this.dom.description.textContent = value || '';
      this.syncDescriptionEmptyState();
    }

    syncDescriptionEmptyState() {
      const hasText = Boolean(this.readDescriptionValue());
      this.dom.description.classList.toggle('is-empty', !hasText);
    }

    handleTagInputInput() {
      this.syncTagInputEmptyState();
      this.clearTagsSaveTimer();
    }

    handleTagInputKeydown(event) {
      const inputValue = this.readTagInputValue();
      if (event.key === 'Enter') {
        event.preventDefault();
        if (inputValue) this.commitPendingTagInput();
        return;
      }
      if (event.key === ',') {
        event.preventDefault();
        if (inputValue) this.commitPendingTagInput();
        return;
      }
      if (event.key === 'Tab') {
        if (inputValue) {
          event.preventDefault();
          this.commitPendingTagInput();
        }
        return;
      }
      if (event.key === 'Backspace' && !inputValue && this.state.tagsDraft.length) {
        event.preventDefault();
        this.removeTag(this.state.tagsDraft[this.state.tagsDraft.length - 1]);
      }
    }

    handleTagInputPaste(event) {
      if (!event.clipboardData) return;
      event.preventDefault();
      const text = event.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
    }

    commitPendingTagInput() {
      const tag = this.readTagInputValue();
      if (!tag) return false;
      this.setTagInputValue('');
      return this.addTag(tag);
    }

    addTag(value) {
      const tag = normalizeTag(value);
      if (!tag) return false;
      if (this.state.tagsDraft.some((item) => item.toLowerCase() === tag.toLowerCase())) return false;
      this.state.tagsDraft = [...this.state.tagsDraft, tag];
      this.renderTagEditor();
      return true;
    }

    removeTag(value) {
      const tag = normalizeTag(value).toLowerCase();
      const nextTags = this.state.tagsDraft.filter((item) => item.toLowerCase() !== tag);
      if (nextTags.length === this.state.tagsDraft.length) return;
      this.state.tagsDraft = nextTags;
      this.renderTagEditor();
    }

    clearTagsSaveTimer() {
      if (this.state.tagsSaveTimer) window.clearTimeout(this.state.tagsSaveTimer);
      this.state.tagsSaveTimer = 0;
    }

    scheduleTagSaveOnLeave() {
      this.clearTagFocusOutTimer();
      this.state.tagFocusOutTimer = window.setTimeout(() => {
        const activeElement = document.activeElement;
        if (activeElement && this.dom.tagsEditor.contains(activeElement)) return;
        this.commitPendingTagInput();
        this.saveTagsIfNeeded({ force: true }).catch((error) => this.handleError(error));
      }, 0);
    }

    clearTagFocusOutTimer() {
      if (this.state.tagFocusOutTimer) window.clearTimeout(this.state.tagFocusOutTimer);
      this.state.tagFocusOutTimer = 0;
    }

    readTagInputValue() {
      return normalizeTag(this.dom.tagInput.innerText || '');
    }

    setTagInputValue(value) {
      this.dom.tagInput.textContent = value || '';
      this.syncTagInputEmptyState();
    }

    syncTagInputEmptyState() {
      const hasText = Boolean(this.readTagInputValue());
      this.dom.tagInput.classList.toggle('is-empty', !hasText);
    }

    getSuggestedTags() {
      const counts = new Map();
      this.getItems().forEach((item) => {
        (Array.isArray(item?.tags) ? item.tags : []).forEach((tag) => {
          const normalized = normalizeTag(tag);
          if (!normalized) return;
          counts.set(normalized, (counts.get(normalized) || 0) + 1);
        });
      });
      const active = new Set(this.state.tagsDraft.map((tag) => tag.toLowerCase()));
      return Array.from(counts.entries())
        .filter(([tag]) => !active.has(tag.toLowerCase()))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([tag]) => tag);
    }

    renderTagEditor() {
      this.dom.tagList.innerHTML = this.state.tagsDraft.length
        ? this.state.tagsDraft.map((tag) => `
            <span class="viewer-tag-chip">
              <span>${escapeHtml(tag)}</span>
              <button type="button" class="viewer-tag-chip-remove" data-remove-tag="${escapeHtml(tag)}" aria-label="Remove ${escapeHtml(tag)}">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </span>
          `).join('')
        : '<span class="viewer-tag-empty">No tags yet</span>';

      const suggestions = this.getSuggestedTags();
      this.dom.tagSuggestions.innerHTML = suggestions.length
        ? suggestions.map((tag) => `<button type="button" class="viewer-tag-suggestion" data-add-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('')
        : '';
      this.dom.tagSuggestions.classList.toggle('hidden', !suggestions.length);
      this.dom.tagComposer.classList.toggle('is-saving', this.state.tagsSaving);
    }

    syncDateModalState(item = this.getCurrentItem()) {
      const usingManualDate = item?.dateSource === 'manual';
      this.dom.dateInput.value = item?.isoDate || '';
      this.dom.dateCopy.textContent = usingManualDate
        ? 'This media is using a manual timeline date. Clear it to go back to the detected date.'
        : `This media is using its ${item?.dateSource || 'detected'} date. Pick a new day to override it.`;
      this.dom.dateReset.disabled = this.state.dateSaving || !usingManualDate;
      this.dom.dateReset.textContent = usingManualDate ? 'Use detected date' : 'Using detected date';
      this.dom.dateSave.disabled = this.state.dateSaving;
      this.dom.dateSave.textContent = this.state.dateSaving ? 'Saving...' : 'Save date';
    }

    openDateModal() {
      const item = this.getCurrentItem();
      if (!item || typeof this.options.onSaveDate !== 'function') return;
      this.state.dateModalOpen = true;
      this.dom.dateModal.classList.remove('hidden');
      this.dom.dateModal.setAttribute('aria-hidden', 'false');
      this.syncDateModalState(item);
      requestAnimationFrame(() => this.dom.dateInput.focus());
    }

    closeDateModal({ force = false } = {}) {
      if (this.state.dateSaving && !force) return;
      this.state.dateModalOpen = false;
      this.dom.dateModal.classList.add('hidden');
      this.dom.dateModal.setAttribute('aria-hidden', 'true');
      this.state.dateSaving = false;
      this.syncDateModalState(this.getCurrentItem());
    }

    async saveDateOverride(isoDate) {
      const item = this.getCurrentItem();
      if (!item || typeof this.options.onSaveDate !== 'function' || this.state.dateSaving) return;
      const currentId = item.id;
      const currentIndex = this.state.index;

      this.state.dateSaving = true;
      this.syncDateModalState(item);

      try {
        const nextIsoDate = String(isoDate || '').trim();
        const result = await this.options.onSaveDate(item, nextIsoDate || null, this);
        if (result && typeof result === 'object') {
          if (Object.prototype.hasOwnProperty.call(result, 'isoDate')) item.isoDate = result.isoDate;
          if (Object.prototype.hasOwnProperty.call(result, 'dateLabel')) item.dateLabel = result.dateLabel;
          if (Object.prototype.hasOwnProperty.call(result, 'capturedAt')) item.capturedAt = result.capturedAt;
          if (Object.prototype.hasOwnProperty.call(result, 'dateSource')) item.dateSource = result.dateSource;
        }
        this.closeDateModal({ force: true });
        if (this.state.closing || !this.isOpen()) return;

        const items = this.getItems();
        if (!items.length) {
          this.close({ animate: false });
          return;
        }

        const nextIndex = items.findIndex((entry) => entry.id === currentId);
        this.state.index = nextIndex >= 0
          ? nextIndex
          : clamp(currentIndex, 0, items.length - 1);
        this.render(0, { forceDateToast: true });
      } finally {
        this.state.dateSaving = false;
        this.syncDateModalState(this.getCurrentItem());
      }
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

    getCurrentIndex() {
      return this.state.index;
    }

    getCurrentItem() {
      return this.getItems()[this.state.index] || null;
    }

    clearCloseAnimationTimer() {
      if (this.state.closeAnimationTimer) window.clearTimeout(this.state.closeAnimationTimer);
      this.state.closeAnimationTimer = 0;
    }

    clearCarouselCommitTimer() {
      if (this.state.carouselCommitTimer) window.clearTimeout(this.state.carouselCommitTimer);
      this.state.carouselCommitTimer = 0;
    }

    stopCarouselAnimation() {
      if (this.state.carouselAnimationFrame) cancelAnimationFrame(this.state.carouselAnimationFrame);
      this.state.carouselAnimationFrame = 0;
      this.state.carouselAnimating = false;
      this.state.carouselAnimationDirection = 0;
      this.state.suppressCarouselCommit = false;
    }

    clearQueuedStepDirection() {
      this.state.queuedStepDirection = 0;
    }

    getCarouselPageWidth() {
      return this.dom.carousel.clientWidth || this.dom.stage.clientWidth || 1;
    }

    setCarouselPage(pageIndex, behavior = 'auto') {
      const left = this.getCarouselPageWidth() * pageIndex;
      this.stopCarouselAnimation();
      if (behavior === 'smooth') {
        const startLeft = this.dom.carousel.scrollLeft || 0;
        const delta = left - startLeft;
        if (Math.abs(delta) <= 1) {
          this.dom.carousel.scrollLeft = left;
          this.state.suppressCarouselCommit = false;
          return;
        }
        const duration = 150;
        const startTime = performance.now();
        this.state.suppressCarouselCommit = true;
        this.state.carouselAnimating = true;
        this.state.carouselAnimationDirection = delta > 0 ? 1 : -1;
        const tick = (now) => {
          const progress = Math.min(1, (now - startTime) / duration);
          const eased = 1 - Math.pow(1 - progress, 3);
          this.dom.carousel.scrollLeft = startLeft + (delta * eased);
          if (progress < 1) {
            this.state.carouselAnimationFrame = requestAnimationFrame(tick);
            return;
          }
          this.state.carouselAnimationFrame = 0;
          this.state.carouselAnimating = false;
          this.state.carouselAnimationDirection = 0;
          this.state.suppressCarouselCommit = false;
        };
        this.state.carouselAnimationFrame = requestAnimationFrame(tick);
        return;
      }
      this.state.suppressCarouselCommit = true;
      this.dom.carousel.scrollLeft = left;
      this.state.suppressCarouselCommit = false;
    }

    centerCarousel() {
      this.setCarouselPage(1, 'auto');
    }

    handleCarouselScroll() {
      if (!this.isOpen() || this.state.suppressCarouselCommit || this.state.zoom > 1.01) return;
      this.clearCarouselCommitTimer();
      this.state.carouselCommitTimer = window.setTimeout(() => {
        this.commitCarouselNavigation().catch((error) => this.handleError(error));
      }, 110);
    }

    async commitCarouselNavigation() {
      if (!this.isOpen() || this.state.suppressCarouselCommit) return;
      this.clearCarouselCommitTimer();
      const width = this.getCarouselPageWidth();
      const page = Math.round((this.dom.carousel.scrollLeft || 0) / Math.max(width, 1));
      if (page === 1) return;
      const items = this.getItems();
      if (items.length < 2) {
        this.centerCarousel();
        return;
      }
      const direction = page > 1 ? 1 : -1;
      this.commitPendingTagInput();
      await this.saveTagsIfNeeded({ force: true }).catch((error) => this.handleError(error));
      await this.saveDescriptionIfNeeded({ force: true }).catch((error) => this.handleError(error));
      this.state.index = (this.state.index + direction + items.length) % items.length;
      this.rotateCarouselSlots(direction);
      this.render(direction, { preserveCarousel: true });
      if (this.state.queuedStepDirection) {
        const nextDirection = this.state.queuedStepDirection;
        this.clearQueuedStepDirection();
        this.step(nextDirection);
      }
    }

    resetCloseAnimationState() {
      this.clearCloseAnimationTimer();
      this.root.classList.remove('is-closing', 'is-closing-fade', 'is-stage-closing');
    }

    prepareForClose() {
      if (this.state.wheelCommitTimer) {
        window.clearTimeout(this.state.wheelCommitTimer);
        this.state.wheelCommitTimer = 0;
      }
      this.stopCarouselAnimation();
      this.clearCarouselCommitTimer();
      this.clearQueuedStepDirection();
      this.state.suppressCarouselCommit = false;
      this.clearTagFocusOutTimer();
      this.closeDateModal({ force: true });
      this.stopMomentum();
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
      this.dom.video.pause();
      this.dom.video.removeAttribute('src');
      this.dom.video.load();
      this.dom.video.poster = '';
      this.dom.image.removeAttribute('src');
      this.dom.loading.classList.add('hidden');
      this.dom.loading.style.right = '14px';
      this.dom.loading.style.bottom = '14px';
      Array.from(this.dom.carousel.children).forEach((slot) => this.clearSlot(slot));
      this.dom.carousel.replaceChildren();
      this.dom.slotPrev = null;
      this.dom.slotCurrent = null;
      this.dom.slotNext = null;
      this.dom.slotPrevMedia = null;
      this.dom.slotNextMedia = null;
    }

    requestClose(reason = 'request', detail = {}) {
      this.state.pendingCloseRequest = { reason, ...detail };
      if (typeof this.options.onRequestClose === 'function') {
        this.options.onRequestClose({ reason, viewer: this, ...detail });
        return;
      }
      this.close(detail.closeOptions || {});
    }

    open(index, { forceDateToast = false } = {}) {
      const items = this.getItems();
      if (!items.length) return false;
      this.state.index = clamp(index, 0, items.length - 1);
      this.state.descriptionDirty = false;
      this.root.classList.remove('hidden');
      this.clearCarouselCommitTimer();
      this.clearQueuedStepDirection();
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

    close({ animate = true, preserveGesture = null } = {}) {
      if (!this.isOpen() && !this.state.closing) return;
      const closeOptions = this.state.pendingCloseRequest?.closeOptions || {};
      const shouldPreserveGesture = Boolean(preserveGesture ?? closeOptions.preserveGesture);
      this.commitPendingTagInput();
      this.saveTagsIfNeeded({ force: true }).catch((error) => this.handleError(error));
      this.saveDescriptionIfNeeded({ force: true }).catch((error) => this.handleError(error));
      this.clearDescriptionSaveTimer();
      this.clearTagsSaveTimer();
      this.prepareForClose();

      const finishClose = () => {
        this.clearRenderedMedia();
        this.clearCarouselCommitTimer();
        this.resetStageGesture(false);
        this.commitDetails(false, { immediate: true });
        this.resetTransform();
        this.resetCloseAnimationState();
        this.root.classList.remove('details-open', 'is-stage-settling', 'is-details-animating');
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
      if (this.isOpen()) this.render(direction, { forceDateToast });
      return true;
    }

    step(direction) {
      const items = this.getItems();
      if (items.length < 2) return;
      const normalizedDirection = direction > 0 ? 1 : -1;
      if (this.state.carouselAnimating && this.state.carouselAnimationDirection === Math.sign(direction || 0)) {
        this.state.queuedStepDirection = normalizedDirection;
        this.stopCarouselAnimation();
        this.clearCarouselCommitTimer();
        this.dom.carousel.scrollLeft = this.getCarouselPageWidth() * (normalizedDirection > 0 ? 2 : 0);
        this.commitCarouselNavigation().catch((error) => this.handleError(error));
        return;
      }
      if (this.state.carouselAnimating) {
        this.stopCarouselAnimation();
        this.clearQueuedStepDirection();
        this.centerCarousel();
      }
      if (this.state.zoom > 1.01) this.resetTransform();
      this.clearCarouselCommitTimer();
      this.clearQueuedStepDirection();
      this.setCarouselPage(normalizedDirection > 0 ? 2 : 0, 'smooth');
      this.state.carouselCommitTimer = window.setTimeout(() => {
        this.commitCarouselNavigation().catch((error) => this.handleError(error));
      }, 165);
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

    getBaseSize() {
      const stageRect = this.dom.stage.getBoundingClientRect();
      const node = this.activeNode();
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

    updateLoadingPosition() {
      if (this.dom.loading.classList.contains('hidden')) return;
      const node = this.activeNode();
      const stageRect = this.dom.stage.getBoundingClientRect();
      const naturalWidth = node.videoWidth || node.naturalWidth || node.clientWidth || 0;
      const naturalHeight = node.videoHeight || node.naturalHeight || node.clientHeight || 0;
      if (!naturalWidth || !naturalHeight || !stageRect.width || !stageRect.height) {
        this.dom.loading.style.right = '14px';
        this.dom.loading.style.bottom = '14px';
        return;
      }
      const scale = Math.min(stageRect.width / naturalWidth, stageRect.height / naturalHeight, 1);
      const fittedWidth = naturalWidth * scale;
      const fittedHeight = naturalHeight * scale;
      const insetX = Math.max(0, (stageRect.width - fittedWidth) / 2);
      const insetY = Math.max(0, (stageRect.height - fittedHeight) / 2);
      this.dom.loading.style.right = `${Math.max(10, insetX + 10)}px`;
      this.dom.loading.style.bottom = `${Math.max(10, insetY + 10)}px`;
    }

    updateTransform() {
      const node = this.activeNode();
      const isVisible = node && !node.classList.contains('hidden');
      if (!isVisible) {
        this.dom.zoomReset.textContent = '100%';
        this.dom.canvas.classList.remove('is-pannable', 'is-panning');
        this.dom.carousel.classList.remove('is-zoomed');
        this.root.style.setProperty('--viewer-canvas-pan-x', '0px');
        this.root.style.setProperty('--viewer-canvas-pan-y', '0px');
        this.root.style.setProperty('--viewer-canvas-scale', '1');
        return;
      }

      const base = this.getBaseSize();
      const detailScale = this.isMobileSheet() ? 1 + (this.state.detailsProgress * 0.08) : 1;
      const effectiveZoom = this.state.zoom * detailScale;
      const maxPanX = Math.max(0, (base.fittedWidth * effectiveZoom - base.stageWidth) / 2);
      const maxPanY = Math.max(0, (base.fittedHeight * effectiveZoom - base.stageHeight) / 2);
      this.state.panX = clamp(this.state.panX, -maxPanX, maxPanX);
      this.state.panY = clamp(this.state.panY, -maxPanY, maxPanY);
      this.root.style.setProperty('--viewer-canvas-pan-x', `${this.state.panX}px`);
      this.root.style.setProperty('--viewer-canvas-pan-y', `${this.state.panY}px`);
      this.root.style.setProperty('--viewer-canvas-scale', `${this.state.zoom}`);
      this.dom.zoomReset.textContent = `${Math.round(this.state.zoom * 100)}%`;
      this.updateLoadingPosition();
      this.dom.canvas.classList.toggle('is-pannable', this.state.zoom > 1.01);
      this.dom.carousel.classList.toggle('is-zoomed', this.state.zoom > 1.01);
      if (this.state.zoom > 1.01) {
        const centerLeft = this.getCarouselPageWidth();
        if (Math.abs((this.dom.carousel.scrollLeft || 0) - centerLeft) > 1) this.centerCarousel();
      }
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
      this.state.detailsOpen = Boolean(open);
      this.applyDetailsProgress(this.state.detailsOpen ? 1 : 0, { immediate });
    }

    toggleChrome() {
      this.setChromeVisible(!this.state.chromeVisible);
    }

    setChromeVisible(visible, { immediate = false } = {}) {
      const nextVisible = Boolean(visible);
      if (!nextVisible && this.state.detailsProgress > 0.02) return;
      this.state.chromeVisible = nextVisible;
      this.applyChromeState({ immediate });
    }

    applyChromeState({ immediate = false } = {}) {
      this.root.classList.toggle('is-chrome-hidden', !this.state.chromeVisible);
      this.root.classList.toggle('is-chrome-immediate', immediate);

      const activeElement = document.activeElement;
      if (!this.state.chromeVisible && activeElement instanceof HTMLElement && activeElement.closest('.viewer-topbar, .viewer-nav, .viewer-toolbar')) {
        activeElement.blur();
      }

      if (immediate) {
        window.setTimeout(() => {
          this.root.classList.remove('is-chrome-immediate');
        }, 0);
      }
    }

    startDetailsAnimation() {
      if (this.state.detailsAnimationTimer) window.clearTimeout(this.state.detailsAnimationTimer);
      this.root.classList.add('is-details-animating');
      this.state.detailsAnimationTimer = window.setTimeout(() => {
        this.root.classList.remove('is-details-animating');
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
      const desktopShift = Math.round((1 - this.state.detailsProgress) * 28);
      const desktopWidth = Math.round(this.state.detailsProgress * 340);
      const desktopGap = Math.round(this.state.detailsProgress * 18);
      this.root.style.setProperty('--viewer-details-progress', this.state.detailsProgress.toFixed(4));
      this.root.style.setProperty('--viewer-details-offset', `${mobileOffset}px`);
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
      const index = (this.state.index + offset + items.length) % items.length;
      return items[index] || null;
    }

    getSlotPreviewSrc(item) {
      if (!item) return '';
      if (item.type === 'video') return item.thumbUrl || '';
      if (this.state.loadedFullMedia.has(item.id) && item.fullUrl) return item.fullUrl;
      return item.thumbUrl || item.fullUrl || '';
    }

    registerSlotMedia(item, media) {
      if (!item?.id || !media) return;
      const key = item.id;
      if (!this.state.slotMediaRegistry.has(key)) this.state.slotMediaRegistry.set(key, new Set());
      this.state.slotMediaRegistry.get(key).add(media);
    }

    unregisterSlotMedia(itemId, media) {
      if (!itemId || !media) return;
      const bucket = this.state.slotMediaRegistry.get(itemId);
      if (!bucket) return;
      bucket.delete(media);
      if (!bucket.size) this.state.slotMediaRegistry.delete(itemId);
    }

    updateRegisteredSlotMedia(item) {
      if (!item?.id) return;
      const bucket = this.state.slotMediaRegistry.get(item.id);
      if (!bucket?.size) return;
      const src = this.getSlotPreviewSrc(item);
      bucket.forEach((media) => {
        const img = media.querySelector('img');
        if (img && src && img.getAttribute('src') !== src) img.setAttribute('src', src);
      });
    }

    primeFullImage(item) {
      if (!item || item.type === 'video' || !item.fullUrl || this.state.loadedFullMedia.has(item.id)) return;
      if (this.state.pendingFullImageLoads.has(item.id)) return;
      const loader = new Image();
      const finish = () => {
        this.state.pendingFullImageLoads.delete(item.id);
      };
      loader.onload = () => {
        this.state.loadedFullMedia.add(item.id);
        finish();
        this.updateRegisteredSlotMedia(item);
      };
      loader.onerror = finish;
      this.state.pendingFullImageLoads.set(item.id, loader);
      loader.src = item.fullUrl;
    }

    buildSlotMediaElement(item) {
      const src = this.getSlotPreviewSrc(item);
      const media = document.createElement('div');
      media.className = 'viewer-slot-preview';
      if (!item || !src) {
        media.classList.add('is-empty');
        return media;
      }
      media.innerHTML = `
        <img src="${escapeHtml(src)}" alt="" draggable="false" />
        ${item.type === 'video' ? '<span class="viewer-slot-video-mark"><i class="fa-solid fa-play"></i></span>' : ''}
      `;
      media.dataset.mediaId = item.id;
      this.registerSlotMedia(item, media);
      this.primeFullImage(item);
      return media;
    }

    syncCarouselSlotRefs() {
      const slots = Array.from(this.dom.carousel.children).filter((node) => node instanceof HTMLElement);
      const positions = ['prev', 'current', 'next'];
      slots.forEach((slot, index) => {
        const position = positions[index] || `slot-${index}`;
        slot.classList.add('viewer-slot');
        slot.classList.toggle('viewer-slot-current', index === 1);
        slot.classList.toggle('viewer-slot-side', index !== 1);
        slot.setAttribute('data-role', `slot-${position}`);
        slot.dataset.slotPosition = position;
      });
      this.dom.slotPrev = slots[0] || null;
      this.dom.slotCurrent = slots[1] || null;
      this.dom.slotNext = slots[2] || null;
      this.dom.slotPrevMedia = this.dom.slotPrev?.querySelector('.viewer-slot-preview') || null;
      this.dom.slotNextMedia = this.dom.slotNext?.querySelector('.viewer-slot-preview') || null;
    }

    clearSlot(slot) {
      if (!slot) return;
      const preview = slot.querySelector('.viewer-slot-preview');
      const mediaId = preview?.dataset?.mediaId || '';
      if (preview) this.unregisterSlotMedia(mediaId, preview);
      if (this.dom.mediaFrame.parentNode === slot) slot.removeChild(this.dom.mediaFrame);
      slot.replaceChildren();
      slot.dataset.itemId = '';
      slot.classList.add('is-empty');
    }

    populateSideSlot(slot, item) {
      if (!slot) return;
      this.clearSlot(slot);
      slot.dataset.itemId = item?.id || '';
      if (!item) return;
      slot.classList.remove('is-empty');
      slot.appendChild(this.buildSlotMediaElement(item));
    }

    mountCurrentSlot(slot, item) {
      if (!slot) return;
      this.clearSlot(slot);
      slot.dataset.itemId = item?.id || '';
      if (!item) return;
      slot.classList.remove('is-empty');
      slot.appendChild(this.dom.mediaFrame);
    }

    createCarouselSlot(item, { current = false } = {}) {
      const slot = document.createElement('div');
      slot.className = 'viewer-slot';
      if (current) this.mountCurrentSlot(slot, item);
      else this.populateSideSlot(slot, item);
      return slot;
    }

    rebuildCarouselSlots() {
      const items = this.getItems();
      const currentItem = this.getCurrentItem();
      const prevItem = items.length > 1 ? this.getRelativeItem(-1) : null;
      const nextItem = items.length > 1 ? this.getRelativeItem(1) : null;
      Array.from(this.dom.carousel.children).forEach((slot) => this.clearSlot(slot));
      this.dom.carousel.replaceChildren(
        this.createCarouselSlot(prevItem),
        this.createCarouselSlot(currentItem, { current: true }),
        this.createCarouselSlot(nextItem)
      );
      this.syncCarouselSlotRefs();
      this.centerCarousel();
    }

    rotateCarouselSlots(direction) {
      const slots = Array.from(this.dom.carousel.children).filter((node) => node instanceof HTMLElement);
      if (slots.length !== 3) {
        this.rebuildCarouselSlots();
        return;
      }

      if (direction > 0) {
        const [prevSlot, currentSlot, nextSlot] = slots;
        this.mountCurrentSlot(nextSlot, this.getCurrentItem());
        this.populateSideSlot(currentSlot, this.getRelativeItem(-1));
        this.clearSlot(prevSlot);
        prevSlot.remove();
        this.dom.carousel.appendChild(this.createCarouselSlot(this.getRelativeItem(1)));
      } else {
        const [prevSlot, currentSlot, nextSlot] = slots;
        this.mountCurrentSlot(prevSlot, this.getCurrentItem());
        this.populateSideSlot(currentSlot, this.getRelativeItem(1));
        this.clearSlot(nextSlot);
        nextSlot.remove();
        this.dom.carousel.prepend(this.createCarouselSlot(this.getRelativeItem(-1)));
      }

      this.syncCarouselSlotRefs();
      this.centerCarousel();
    }

    updateStatus(item) {
      if (!item) {
        this.dom.count.textContent = '';
        this.dom.caption.textContent = '';
        return;
      }

      const sameDateItems = this.getItems().filter((entry) => entry.isoDate === item.isoDate);
      const indexWithinDate = Math.max(0, sameDateItems.findIndex((entry) => entry.id === item.id)) + 1;
      const totalWithinDate = sameDateItems.length || 1;
      const draftDescription = this.state.descriptionDirty ? this.readDescriptionValue() : '';
      const descriptionText = draftDescription || item?.description || '';
      this.dom.count.textContent = `${item.dateLabel || item.isoDate || ''}  -  ${indexWithinDate} / ${totalWithinDate}`;
      this.dom.caption.textContent = descriptionText;
      this.dom.caption.classList.toggle('is-empty', !descriptionText);
    }

    updateLikeButton(item = this.getCurrentItem()) {
      const liked = Boolean(item?.liked);
      this.dom.like.classList.toggle('is-active', liked);
      this.dom.like.classList.toggle('is-saving', this.state.likeSaving);
      this.dom.like.setAttribute('aria-label', liked ? 'Unlike media' : 'Like media');
    }

    renderDetails(item) {
      const rows = (typeof this.options.getDetailRows === 'function' ? this.options.getDetailRows(item) : defaultDetailRows(item)) || [];
      this.dom.detailsMeta.innerHTML = rows
        .map(([label, value]) => `<div class="viewer-meta-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value || '-'))}</strong></div>`)
        .join('');

      const sourceLabel = item?.dateSource ? `Date source: ${item.dateSource}` : (item?.type === 'video' ? 'Video memory' : 'Photo memory');
      this.dom.detailsKicker.textContent = sourceLabel;
      this.dom.detailsTitle.textContent = item?.fileName || 'Untitled media';
      this.setDescriptionValue(typeof this.options.getDescriptionValue === 'function'
        ? this.options.getDescriptionValue(item) || ''
        : (item?.description || ''));
      this.state.descriptionDirty = false;
      this.clearDescriptionSaveTimer();
      this.state.tagsDraft = Array.isArray(item?.tags) ? [...item.tags] : [];
      this.clearTagFocusOutTimer();
      this.setTagInputValue('');
      this.renderTagEditor();
      this.updateLikeButton(item);
      this.updateStatus(item);
      this.applyDetailsProgress(this.state.detailsProgress, { immediate: true });
    }

    render(direction = 0, { forceDateToast = false, preserveCarousel = false } = {}) {
      const item = this.getCurrentItem();
      if (!item) return;

      this.closeDateModal();
      this.dom.video.pause();
      this.dom.video.removeAttribute('src');
      this.dom.video.load();
      this.dom.video.poster = '';

      this.renderDetails(item);
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
      if (!preserveCarousel) this.rebuildCarouselSlots();
      this.dom.loading.classList.remove('hidden');
      this.dom.loading.style.right = '14px';
      this.dom.loading.style.bottom = '14px';
      const initialImageSrc = item.type === 'image' ? this.getSlotPreviewSrc(item) : '';
      if (item.type === 'image' && initialImageSrc) {
        this.dom.image.src = initialImageSrc;
        this.dom.image.classList.remove('hidden');
      } else {
        this.dom.image.classList.add('hidden');
        this.dom.image.removeAttribute('src');
      }
      this.dom.video.classList.add('hidden');
      this.dom.video.removeAttribute('src');
      this.dom.video.load();
      this.dom.video.poster = '';
      this.primeFullImage(item);

      if (item.type === 'video') {
        this.dom.video.classList.remove('hidden');
        if (item.thumbUrl) {
          const posterImage = new Image();
          posterImage.onload = () => {
            if (token !== this.state.loadToken) return;
            this.dom.video.poster = item.thumbUrl;
          };
          posterImage.src = item.thumbUrl;
        }
        this.dom.video.addEventListener('loadeddata', () => {
          if (token !== this.state.loadToken) return;
          this.state.loadedFullMedia.add(item.id);
          this.dom.loading.classList.add('hidden');
          this.updateTransform();
        }, { once: true });
        this.dom.video.src = item.fullUrl;
        this.dom.video.load();
      } else {
        this.dom.image.alt = item.fileName || 'Selected media';
        if (this.state.loadedFullMedia.has(item.id) && item.fullUrl) {
          this.dom.image.src = item.fullUrl;
          this.dom.image.classList.remove('hidden');
          this.dom.loading.classList.add('hidden');
          this.updateTransform();
          this.updateLoadingPosition();
          this.options.onItemChange?.(item, this.state.index, { direction, forceDateToast, viewer: this });
          return;
        }
        const fullImage = new Image();
        fullImage.onload = () => {
          if (token !== this.state.loadToken) return;
          this.state.loadedFullMedia.add(item.id);
          this.dom.image.src = item.fullUrl;
          this.dom.image.classList.remove('hidden');
          this.dom.loading.classList.add('hidden');
          this.updateTransform();
        };
        fullImage.onerror = () => {
          if (token !== this.state.loadToken) return;
          this.dom.loading.classList.add('hidden');
        };
        fullImage.src = item.fullUrl;

        requestAnimationFrame(() => {
          this.updateTransform();
          this.updateLoadingPosition();
        });
      }

      this.options.onItemChange?.(item, this.state.index, { direction, forceDateToast, viewer: this });
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

    async saveTagsIfNeeded({ force = false } = {}) {
      const item = this.getCurrentItem();
      if (!item || typeof this.options.onSaveTags !== 'function' || this.state.tagsSaving) return;

      if (!force && !this.state.tagsDraft.length && !(Array.isArray(item.tags) && item.tags.length)) return;

      this.clearTagsSaveTimer();
      const nextTags = Array.from(new Set(this.state.tagsDraft.map((tag) => normalizeTag(tag)).filter(Boolean)));
      const currentTags = Array.isArray(item.tags) ? item.tags : [];
      const sameTags = nextTags.length === currentTags.length
        && nextTags.every((tag, index) => tag === currentTags[index]);
      if (sameTags) return;

      this.state.tagsSaving = true;
      this.renderTagEditor();

      try {
        const result = await this.options.onSaveTags(item, nextTags, this);
        if (Array.isArray(result)) item.tags = result;
        else if (result && Array.isArray(result.tags)) item.tags = result.tags;
        else item.tags = nextTags;
        this.state.tagsDraft = Array.isArray(item.tags) ? [...item.tags] : [];
      } finally {
        this.state.tagsSaving = false;
        this.renderTagEditor();
      }
    }

    async saveDescriptionIfNeeded({ force = false } = {}) {
      const item = this.getCurrentItem();
      if (!item || typeof this.options.onSaveDescription !== 'function') return;
      if (this.state.descriptionSaving || (!this.state.descriptionDirty && !force)) return;

      this.clearDescriptionSaveTimer();
      const description = this.readDescriptionValue();
      const currentDescription = typeof this.options.getDescriptionValue === 'function'
        ? this.options.getDescriptionValue(item) || ''
        : (item.description || '');

      if (description === currentDescription) {
        this.state.descriptionDirty = false;
        this.updateStatus(this.getCurrentItem());
        return;
      }

      this.state.descriptionSaving = true;
      try {
        const result = await this.options.onSaveDescription(item, description, this);
        if (typeof result === 'string') item.description = result;
        else if (result && Object.prototype.hasOwnProperty.call(result, 'description')) item.description = result.description || '';
        else item.description = description;
        this.state.descriptionDirty = false;
        this.setDescriptionValue(item.description || '');
      } finally {
        this.state.descriptionSaving = false;
        this.updateStatus(this.getCurrentItem());
      }
    }
  }

  window.createMediaViewer = function createMediaViewer(options) {
    return new MediaViewer(options);
  };
}());
