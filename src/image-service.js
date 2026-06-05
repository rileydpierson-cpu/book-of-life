const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const { hash } = require('./utils');

const execFileAsync = promisify(execFile);
const HEIC_EXTENSIONS = new Set(['.heic', '.heif']);
const VIDEO_DISPLAY_PRESETS = new Set(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow']);

class ImageService {
  constructor(config, indexer) {
    this.config = config;
    this.indexer = indexer;
    this.cacheDir = config.paths.cacheDir;
    this.pending = new Map();
  }

  isOriginalUnavailable(photo) {
    return photo?.originalAvailable === false;
  }

  originalUnavailableMessage(photo = {}) {
    switch (photo.availability) {
      case 'root-unavailable':
        return 'Drive unavailable. Reconnect it to open originals.';
      case 'cloud-only':
        return 'Original is stored in cloud to save space.';
      case 'missing-cloud-risk':
        return 'Original is missing from this device, but a cloud copy exists.';
      case 'missing-unapproved':
        return 'Original is missing from this device.';
      default:
        return 'Original media is unavailable on this device.';
    }
  }

  sendOriginalUnavailable(res, photo) {
    res.status(410).send(this.originalUnavailableMessage(photo));
  }

  isHeic(filePath) {
    return HEIC_EXTENSIONS.has(path.extname(filePath).toLowerCase());
  }

  async sendThumb(res, photoId) {
    const photo = this.indexer.getPhoto(photoId);
    if (!photo) {
      res.status(404).send('Not found');
      return;
    }

    try {
      const cachePath = await this.ensureThumb(photo);
      res.set('Cache-Control', 'private, max-age=31536000, immutable');
      res.sendFile(cachePath);
    } catch (error) {
      if (this.isOriginalUnavailable(photo)) {
        res.status(404).send('Cached thumbnail unavailable');
        return;
      }
      console.error('Thumbnail error', error);
      res.status(500).send('Thumbnail generation failed');
    }
  }

  async sendPreview(res, photoId) {
    const photo = this.indexer.getPhoto(photoId);
    if (!photo || photo.type !== 'video') {
      res.status(404).send('Not found');
      return;
    }

    try {
      const cachePath = await this.ensureVideoPreview(photo);
      res.set('Cache-Control', 'private, max-age=31536000, immutable');
      res.sendFile(cachePath);
    } catch (error) {
      if (this.isOriginalUnavailable(photo)) {
        res.status(404).send('Cached preview unavailable');
        return;
      }
      console.error('Video preview error', error);
      res.status(500).send('Video preview generation failed');
    }
  }

  async sendFull(res, photoId) {
    const photo = this.indexer.getPhoto(photoId);
    if (!photo) {
      res.status(404).send('Not found');
      return;
    }

    try {
      if (this.isOriginalUnavailable(photo)) {
        this.sendOriginalUnavailable(res, photo);
        return;
      }
      if (photo.type === 'video') {
        res.set('Accept-Ranges', 'bytes');
        res.set('Cache-Control', 'private, max-age=86400');
        res.sendFile(photo.filePath);
        return;
      }
      if (this.isHeic(photo.filePath)) {
        const convertedPath = await this.ensureHeicFull(photo);
        res.set('Cache-Control', 'private, max-age=31536000, immutable');
        res.sendFile(convertedPath);
        return;
      }
      res.set('Cache-Control', 'private, max-age=86400');
      res.sendFile(photo.filePath);
    } catch (error) {
      console.error('Full image error', error);
      res.status(500).send('Image delivery failed');
    }
  }

  async sendDisplay(res, photoId) {
    const photo = this.indexer.getPhoto(photoId);
    if (!photo) {
      res.status(404).send('Not found');
      return;
    }

    if (!this.config.mediaOptimization?.enabled) {
      await this.sendFull(res, photoId);
      return;
    }

    try {
      if (this.isOriginalUnavailable(photo)) {
        this.sendOriginalUnavailable(res, photo);
        return;
      }
      const cachePath = photo.type === 'video'
        ? await this.ensureVideoDisplay(photo)
        : await this.ensureImageDisplay(photo);
      if (photo.type === 'video') res.set('Accept-Ranges', 'bytes');
      res.set('Cache-Control', 'private, max-age=31536000, immutable');
      res.sendFile(cachePath);
    } catch (error) {
      console.error('Display media error', error);
      res.status(500).send('Optimized media generation failed');
    }
  }

  async sendDownload(res, photoId) {
    const photo = this.indexer.getPhoto(photoId);
    if (!photo) {
      res.status(404).send('Not found');
      return;
    }

    try {
      if (this.isOriginalUnavailable(photo)) {
        this.sendOriginalUnavailable(res, photo);
        return;
      }
      res.set('Cache-Control', 'private, max-age=86400');
      res.download(photo.filePath, photo.fileName || path.basename(photo.filePath));
    } catch (error) {
      console.error('Download media error', error);
      if (!res.headersSent) res.status(500).send('Media download failed');
    }
  }

  async sendJournalInline(res, imageName) {
    const filePath = this.indexer.getJournalImageByName(imageName);
    if (!filePath) {
      res.status(404).send('Not found');
      return;
    }

    try {
      if (this.isHeic(filePath)) {
        const stat = await fs.promises.stat(filePath);
        const converted = await this.ensureHeicConverted({
          filePath,
          id: hash(filePath),
          mtimeMs: stat.mtimeMs,
          size: stat.size
        }, 'journal-inline');
        res.set('Cache-Control', 'private, max-age=31536000, immutable');
        res.sendFile(converted);
        return;
      }
      res.set('Cache-Control', 'private, max-age=86400');
      res.sendFile(filePath);
    } catch (error) {
      console.error('Inline image error', error);
      res.status(500).send('Inline image delivery failed');
    }
  }

  async ensureThumb(photo) {
    const key = hash(`${photo.filePath}|${photo.mtimeMs}|${photo.size}|thumb-v6`);
    const outputPath = path.join(this.cacheDir, 'thumbs', `${key}.webp`);
    if (fs.existsSync(outputPath)) return outputPath;
    if (this.isOriginalUnavailable(photo)) throw new Error('Original media is unavailable.');

    return this.withLock(`thumb:${key}`, async () => {
      if (fs.existsSync(outputPath)) return outputPath;

      if (photo.type === 'video') {
        await this.ensureVideoThumb(photo, outputPath);
        return outputPath;
      }

      const source = this.isHeic(photo.filePath)
        ? await this.ensureHeicConverted(photo, 'thumb-source')
        : photo.filePath;

      try {
        await sharp(source, { limitInputPixels: false, failOn: 'none' })
          .rotate()
          .resize({ width: 300, height: null, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 58, effort: 4 })
          .toFile(outputPath);
      } catch (error) {
        await sharp(source, { limitInputPixels: false, failOn: 'none' })
          .rotate()
          .resize({ width: 300, height: null, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 60, effort: 3 })
          .toFile(outputPath);
      }

      return outputPath;
    });
  }

  async ensureVideoThumb(photo, outputPath) {
    const tempOutput = `${outputPath}.tmp.webp`;
    const attempts = [
      ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '00:00:00.300', '-i', photo.filePath, '-frames:v', '1', '-vf', 'scale=300:-2:force_original_aspect_ratio=decrease', tempOutput],
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', photo.filePath, '-frames:v', '1', '-vf', 'thumbnail,scale=300:-2:force_original_aspect_ratio=decrease', tempOutput]
    ];

    for (const args of attempts) {
      try {
        await execFileAsync('ffmpeg', args);
        await fs.promises.rename(tempOutput, outputPath);
        return;
      } catch (error) {
        await fs.promises.rm(tempOutput, { force: true }).catch(() => {});
      }
    }

    await sharp({
      create: {
        width: 300,
        height: 200,
        channels: 3,
        background: { r: 24, g: 26, b: 31 }
      }
    })
      .webp({ quality: 72 })
      .toFile(outputPath);
  }

  async ensureVideoPreview(photo) {
    const key = hash(`${photo.filePath}|${photo.mtimeMs}|${photo.size}|preview-v1`);
    const outputPath = path.join(this.cacheDir, 'thumbs', `${key}.webm`);
    if (fs.existsSync(outputPath)) return outputPath;
    if (this.isOriginalUnavailable(photo)) throw new Error('Original media is unavailable.');

    return this.withLock(`preview:${key}`, async () => {
      if (fs.existsSync(outputPath)) return outputPath;

      const tempOutput = `${outputPath}.tmp.webm`;
      const attempts = [
        [
          '-hide_banner', '-loglevel', 'error', '-y',
          '-ss', '00:00:00.150',
          '-t', '1.4',
          '-i', photo.filePath,
          '-an',
          '-vf', 'fps=10,scale=300:-2:force_original_aspect_ratio=decrease',
          '-c:v', 'libvpx-vp9',
          '-b:v', '0',
          '-crf', '40',
          '-deadline', 'realtime',
          '-cpu-used', '5',
          tempOutput
        ],
        [
          '-hide_banner', '-loglevel', 'error', '-y',
          '-t', '1.4',
          '-i', photo.filePath,
          '-an',
          '-vf', 'fps=10,scale=300:-2:force_original_aspect_ratio=decrease',
          '-c:v', 'libvpx-vp9',
          '-b:v', '0',
          '-crf', '40',
          '-deadline', 'realtime',
          '-cpu-used', '5',
          tempOutput
        ]
      ];

      for (const args of attempts) {
        try {
          await execFileAsync('ffmpeg', args);
          await fs.promises.rename(tempOutput, outputPath);
          return outputPath;
        } catch (error) {
          await fs.promises.rm(tempOutput, { force: true }).catch(() => {});
        }
      }

      throw new Error(`Failed to generate WebM preview for ${photo.filePath}`);
    });
  }

  displaySettingsSignature() {
    const settings = this.config.mediaOptimization || {};
    return [
      settings.enabled ? 'on' : 'off',
      `img${Number(settings.imageMaxEdge || 2560)}`,
      `q${Number(settings.imageQuality || 86)}`,
      `vh${Number(settings.videoMaxHeight || 1080)}`,
      `crf${Number(settings.videoCrf || 22)}`,
      `preset${settings.videoPreset || 'medium'}`
    ].join('|');
  }

  async ensureImageDisplay(photo) {
    const settings = this.config.mediaOptimization || {};
    const maxEdge = Math.max(1, Number(settings.imageMaxEdge || 2560));
    const quality = Math.max(1, Math.min(100, Number(settings.imageQuality || 86)));
    const key = hash(`${photo.filePath}|${photo.mtimeMs}|${photo.size}|display-image-v1|${this.displaySettingsSignature()}`);
    const outputPath = path.join(this.cacheDir, 'display', `${key}.webp`);
    if (fs.existsSync(outputPath)) return outputPath;

    return this.withLock(`display-image:${key}`, async () => {
      if (fs.existsSync(outputPath)) return outputPath;
      const tempOutput = `${outputPath}.tmp.webp`;
      const source = this.isHeic(photo.filePath)
        ? await this.ensureHeicConverted(photo, 'display-source')
        : photo.filePath;

      try {
        await sharp(source, { limitInputPixels: false, failOn: 'none' })
          .rotate()
          .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
          .webp({ quality, effort: 5 })
          .toFile(tempOutput);
        await fs.promises.rename(tempOutput, outputPath);
        return outputPath;
      } catch (error) {
        await fs.promises.rm(tempOutput, { force: true }).catch(() => {});
        throw error;
      }
    });
  }

  async ensureVideoDisplay(photo) {
    const settings = this.config.mediaOptimization || {};
    const maxHeight = Math.max(2, Number(settings.videoMaxHeight || 1080));
    const crf = Math.max(0, Math.min(51, Number(settings.videoCrf || 22)));
    const preset = VIDEO_DISPLAY_PRESETS.has(String(settings.videoPreset || 'medium'))
      ? String(settings.videoPreset || 'medium')
      : 'medium';
    const key = hash(`${photo.filePath}|${photo.mtimeMs}|${photo.size}|display-video-v1|${this.displaySettingsSignature()}`);
    const outputPath = path.join(this.cacheDir, 'display', `${key}.mp4`);
    if (fs.existsSync(outputPath)) return outputPath;

    return this.withLock(`display-video:${key}`, async () => {
      if (fs.existsSync(outputPath)) return outputPath;
      const tempOutput = `${outputPath}.tmp.mp4`;
      const vf = `scale=-2:'min(${maxHeight},ih)':force_original_aspect_ratio=decrease`;
      const args = [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', photo.filePath,
        '-map', '0:v:0',
        '-map', '0:a?',
        '-vf', vf,
        '-c:v', 'libx264',
        '-preset', preset,
        '-crf', String(crf),
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '160k',
        '-movflags', '+faststart',
        tempOutput
      ];

      try {
        await execFileAsync('ffmpeg', args);
        await fs.promises.rename(tempOutput, outputPath);
        return outputPath;
      } catch (error) {
        await fs.promises.rm(tempOutput, { force: true }).catch(() => {});
        throw error;
      }
    });
  }

  async ensureHeicFull(photo) {
    return this.ensureHeicConverted(photo, 'full');
  }

  async ensureHeicConverted(photo, variant) {
    const key = hash(`${photo.filePath}|${photo.mtimeMs}|${photo.size}|${variant}`);
    const outputPath = path.join(this.cacheDir, 'converted', `${key}.jpg`);
    if (fs.existsSync(outputPath)) return outputPath;

    return this.withLock(`heic:${key}`, async () => {
      if (fs.existsSync(outputPath)) return outputPath;
      const inputBuffer = await fs.promises.readFile(photo.filePath);
      const convertedBuffer = await heicConvert({
        buffer: inputBuffer,
        format: 'JPEG',
        quality: 0.9
      });
      await fs.promises.writeFile(outputPath, convertedBuffer);
      return outputPath;
    });
  }

  async withLock(key, fn) {
    if (this.pending.has(key)) return this.pending.get(key);

    const promise = Promise.resolve()
      .then(fn)
      .finally(() => {
        this.pending.delete(key);
      });

    this.pending.set(key, promise);
    return promise;
  }
}

module.exports = { ImageService };
