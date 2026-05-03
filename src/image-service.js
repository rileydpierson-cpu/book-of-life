const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const { hash } = require('./utils');

const execFileAsync = promisify(execFile);
const HEIC_EXTENSIONS = new Set(['.heic', '.heif']);

class ImageService {
  constructor(config, indexer) {
    this.config = config;
    this.indexer = indexer;
    this.cacheDir = config.paths.cacheDir;
    this.pending = new Map();
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
      console.error('Thumbnail error', error);
      res.status(500).send('Thumbnail generation failed');
    }
  }

  async sendFull(res, photoId) {
    const photo = this.indexer.getPhoto(photoId);
    if (!photo) {
      res.status(404).send('Not found');
      return;
    }

    try {
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
    const key = hash(`${photo.filePath}|${photo.mtimeMs}|${photo.size}|thumb-v4`);
    const outputPath = path.join(this.cacheDir, 'thumbs', `${key}.jpg`);
    if (fs.existsSync(outputPath)) return outputPath;

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
          // .resize({ width: 700, height: 520, fit: 'inside', withoutEnlargement: true })
          .resize({ width: 300, height: null, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 58, mozjpeg: true })
          .toFile(outputPath);
      } catch (error) {
        await sharp(source, { limitInputPixels: false, failOn: 'none' })
          .rotate()
          // .resize({ width: 700, height: 520, fit: 'inside', withoutEnlargement: true })
          .resize({ width: 300, height: null, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 60, mozjpeg: true })
          .toFile(outputPath);
      }

      return outputPath;
    });
  }

  async ensureVideoThumb(photo, outputPath) {
    const tempOutput = `${outputPath}.tmp.jpg`;
    const attempts = [
      ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '00:00:00.300', '-i', photo.filePath, '-frames:v', '1', '-vf', 'scale=700:520:force_original_aspect_ratio=decrease', tempOutput],
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', photo.filePath, '-frames:v', '1', '-vf', 'thumbnail,scale=700:520:force_original_aspect_ratio=decrease', tempOutput]
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
        width: 700,
        height: 520,
        channels: 3,
        background: { r: 24, g: 26, b: 31 }
      }
    })
      .jpeg({ quality: 72 })
      .toFile(outputPath);
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
