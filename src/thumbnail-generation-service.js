const { mapLimit } = require('./utils');

function idleThumbnailStatus() {
  return {
    running: false,
    queued: false,
    current: 0,
    total: 0,
    percent: 100,
    generated: 0,
    failed: 0,
    startedAt: '',
    completedAt: '',
    error: ''
  };
}

class ThumbnailGenerationService {
  constructor({ indexer, imageService, concurrency = 2, onGenerated = null } = {}) {
    this.indexer = indexer;
    this.imageService = imageService;
    this.concurrency = Math.max(1, Number(concurrency) || 2);
    this.onGenerated = typeof onGenerated === 'function' ? onGenerated : null;
    this.pending = new Map();
    this.running = false;
    this.status = idleThumbnailStatus();
  }

  getStatus() {
    return {
      ...idleThumbnailStatus(),
      ...this.status,
      running: this.running,
      queued: this.pending.size > 0
    };
  }

  queueAll() {
    return this.queuePhotos(Array.from(this.indexer?.state?.photosById?.values?.() || []));
  }

  queuePhotos(photos = []) {
    let queued = 0;
    for (const photo of photos) {
      if (!photo?.id || !this.imageService?.needsDerivatives(photo)) continue;
      if (!this.pending.has(photo.id)) queued += 1;
      this.pending.set(photo.id, { ...photo });
    }
    if (this.pending.size) setImmediate(() => this.run().catch(() => {}));
    return { queued, status: this.getStatus() };
  }

  async run() {
    if (this.running || !this.pending.size) return this.getStatus();
    this.running = true;
    this.status = {
      ...idleThumbnailStatus(),
      running: true,
      total: this.pending.size,
      percent: 0,
      startedAt: new Date().toISOString()
    };

    while (this.pending.size) {
      const batch = Array.from(this.pending.values());
      this.pending.clear();
      if (this.status.current > 0) this.status.total += batch.length;
      await mapLimit(batch, this.concurrency, async (photo) => {
        try {
          const generated = await this.generate(photo);
          if (generated) {
            this.status.generated += 1;
            Promise.resolve(this.onGenerated?.(photo)).catch((error) => {
              console.warn(`Cloud derivative publish skipped for ${photo.filePath || photo.id}: ${error.message}`);
            });
          }
        } catch (error) {
          this.status.failed += 1;
          this.status.error = error.message || 'Thumbnail generation failed.';
          console.warn(`Thumbnail generation skipped for ${photo.filePath || photo.id}: ${this.status.error}`);
        } finally {
          this.status.current += 1;
          this.status.percent = Math.round((this.status.current / Math.max(1, this.status.total)) * 100);
        }
      });
    }

    this.running = false;
    this.status.running = false;
    this.status.percent = 100;
    this.status.completedAt = new Date().toISOString();
    return this.getStatus();
  }

  async generate(photo) {
    if (!this.imageService.needsDerivatives(photo)) return false;
    await this.imageService.ensureThumb(photo);
    if (photo.type === 'video') await this.imageService.ensureVideoPreview(photo);
    return true;
  }
}

module.exports = {
  ThumbnailGenerationService,
  idleThumbnailStatus
};
