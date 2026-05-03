const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { loadConfig } = require('./src/config');
const { TimelineIndexer } = require('./src/indexer');
const { ImageService } = require('./src/image-service');
const {
  isExifWritableImage,
  isVideoMetadataWritable,
  writeExifDatedImage,
  writeVideoCreatedDate
} = require('./src/media-metadata');
const { AuthService } = require('./src/auth');
const { dateToIsoLocal } = require('./src/utils');

function sendNoStoreFile(res, filePath) {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(filePath);
}

function isValidIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function sanitizeFileName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim() || `upload-${Date.now()}`;
}

function uniqueDestinationPath(dirPath, fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let candidate = path.join(dirPath, fileName);
  let counter = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dirPath, `${base} ${counter}${ext}`);
    counter += 1;
  }
  return candidate;
}

function uniqueFolderPath(parentDir, folderName) {
  let candidate = path.join(parentDir, folderName);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(parentDir, `${folderName} (${counter})`);
    counter += 1;
  }
  return candidate;
}

function ensurePathInside(root, target) {
  const relative = path.relative(root, target);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) || relative === '';
}

function countMediaInDirectory(currentPath) {
  let mediaCount = 0;
  let latestModifiedMs = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(currentPath, { withFileTypes: true });
  } catch (error) {
    return { mediaCount, latestModifiedMs };
  }

  for (const entry of entries) {
    if (entry.name === '.trash' || entry.name === '.LifeServerTrash') continue;
    const absoluteChild = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      const nested = countMediaInDirectory(absoluteChild);
      mediaCount += nested.mediaCount;
      latestModifiedMs = Math.max(latestModifiedMs, nested.latestModifiedMs);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (['.jpg','.jpeg','.png','.webp','.gif','.bmp','.tif','.tiff','.avif','.heic','.heif','.mp4','.mov','.m4v','.webm','.avi','.mkv','.3gp'].includes(ext)) {
        mediaCount += 1;
      }
      try {
        const stat = fs.statSync(absoluteChild);
        latestModifiedMs = Math.max(latestModifiedMs, stat.mtimeMs || 0);
      } catch (error) {}
    }
  }
  try {
    const stat = fs.statSync(currentPath);
    latestModifiedMs = Math.max(latestModifiedMs, stat.mtimeMs || 0);
  } catch (error) {}
  return { mediaCount, latestModifiedMs };
}

function folderNodeFromAbsolute(rootPath, currentPath, relativePath = '') {
  const children = [];
  let entries = [];
  try {
    entries = fs.readdirSync(currentPath, { withFileTypes: true });
  } catch (error) {}
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '.trash' || entry.name === '.LifeServerTrash') continue;
    const absoluteChild = path.join(currentPath, entry.name);
    const childRelative = relativePath ? path.posix.join(relativePath, entry.name) : entry.name;
    children.push(folderNodeFromAbsolute(rootPath, absoluteChild, childRelative));
  }
  children.sort((a, b) => (b.latestModifiedMs || 0) - (a.latestModifiedMs || 0) || a.label.localeCompare(b.label));
  const counts = countMediaInDirectory(currentPath);
  return {
    label: relativePath ? path.basename(currentPath) : (path.basename(rootPath) || rootPath),
    relativePath,
    displayPath: relativePath ? relativePath : '.',
    children,
    mediaCount: counts.mediaCount,
    latestModifiedMs: counts.latestModifiedMs,
    icon: relativePath ? 'folder-open' : 'hard-drive'
  };
}

function buildFolderTree(roots) {
  return roots.map((rootPath, index) => ({
    rootId: String(index),
    rootLabel: path.basename(rootPath) || rootPath,
    rootPath,
    tree: folderNodeFromAbsolute(rootPath, rootPath, ''),
    latestModifiedMs: countMediaInDirectory(rootPath).latestModifiedMs
  })).sort((a, b) => (b.latestModifiedMs || 0) - (a.latestModifiedMs || 0) || a.rootLabel.localeCompare(b.rootLabel));
}

function moveToTrash(rootPath, filePath) {
  const trashRoot = path.join(rootPath, '.trash');
  fs.mkdirSync(trashRoot, { recursive: true });
  const relative = path.relative(rootPath, filePath);
  const datedFolder = dateToIsoLocal(new Date());
  const destinationDir = path.join(trashRoot, datedFolder, path.dirname(relative));
  fs.mkdirSync(destinationDir, { recursive: true });
  return uniqueDestinationPath(destinationDir, path.basename(filePath));
}

function createUploader(cacheDir) {
  const uploadTmpDir = path.join(cacheDir, 'uploads-tmp');
  fs.mkdirSync(uploadTmpDir, { recursive: true });
  return multer({
    dest: uploadTmpDir,
    limits: {
      files: 64,
      fileSize: 1024 * 1024 * 1024
    }
  });
}

async function runMulter(req, res, middleware) {
  await new Promise((resolve, reject) => {
    middleware(req, res, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function copyUploadedFileWithOptionalDate({
  file,
  destination,
  setExifDate,
  targetIsoDate
}) {
  if (!setExifDate) {
    await fs.promises.copyFile(file.path, destination);
    return false;
  }

  if (isExifWritableImage(destination)) {
    try {
      await writeExifDatedImage(file.path, destination, targetIsoDate);
      return true;
    } catch (error) {
      console.warn(`Upload metadata write skipped for ${destination}: ${error.message}`);
    }
  } else if (isVideoMetadataWritable(destination)) {
    try {
      await writeVideoCreatedDate(file.path, destination, targetIsoDate);
      return true;
    } catch (error) {
      console.warn(`Upload metadata write skipped for ${destination}: ${error.message}`);
    }
  }

  await fs.promises.copyFile(file.path, destination);
  return false;
}

async function main() {
  const projectRoot = __dirname;
  const publicDir = path.join(projectRoot, 'public');
  const config = loadConfig(projectRoot);
  const app = express();
  const indexer = new TimelineIndexer(config);
  const imageService = new ImageService(config, indexer);
  const auth = new AuthService(config);
  const uploader = createUploader(config.paths.cacheDir);

  app.disable('x-powered-by');
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: false, limit: '8mb' }));

  await indexer.init();
  setInterval(() => indexer.scheduleRebuild('interval'), config.indexing.rebuildIntervalMs).unref();

  app.use('/vendor/fontawesome', express.static(path.join(projectRoot, 'node_modules', '@fortawesome', 'fontawesome-free'), {
    etag: true,
    maxAge: '1d'
  }));
  app.use('/vendor/exifr', express.static(path.join(projectRoot, 'node_modules', 'exifr', 'dist'), {
    etag: true,
    maxAge: '1d'
  }));
  app.use('/vendor/markdown-it', express.static(path.join(projectRoot, 'node_modules', 'markdown-it'), {
    etag: true,
    maxAge: '1d'
  }));

  app.get('/login', (req, res) => {
    if (!auth.enabled) {
      res.redirect('/');
      return;
    }
    if (auth.getSession(req)) {
      res.redirect('/');
      return;
    }
    sendNoStoreFile(res, path.join(publicDir, 'login.html'));
  });

  app.get('/login.css', (req, res) => sendNoStoreFile(res, path.join(publicDir, 'login.css')));
  app.get('/login.js', (req, res) => sendNoStoreFile(res, path.join(publicDir, 'login.js')));
  app.get('/editor.css', (req, res) => sendNoStoreFile(res, path.join(publicDir, 'editor.css')));
  app.get('/media-viewer.css', (req, res) => sendNoStoreFile(res, path.join(publicDir, 'media-viewer.css')));
  app.get('/editor.js', (req, res) => sendNoStoreFile(res, path.join(publicDir, 'editor.js')));
  app.get('/media-viewer.js', (req, res) => sendNoStoreFile(res, path.join(publicDir, 'media-viewer.js')));

  app.post('/auth/login', (req, res) => {
    if (!auth.enabled) {
      res.json({ ok: true, disabled: true, redirectTo: '/' });
      return;
    }

    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const allowed = auth.canAttemptLogin(ip);
    if (!allowed.ok) {
      res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
      return;
    }

    const secret = typeof req.body?.secret === 'string' ? req.body.secret : '';
    if (!auth.authenticate(secret)) {
      auth.recordFailedLogin(ip);
      res.status(401).json({ ok: false, error: 'That secret was not accepted.' });
      return;
    }

    auth.recordSuccessfulLogin(ip);
    const token = auth.createSession();
    auth.setSessionCookie(res, token);
    res.json({ ok: true, redirectTo: '/' });
  });

  app.post('/auth/logout', (req, res) => {
    auth.destroySession(req, res);
    res.json({ ok: true, redirectTo: auth.enabled ? '/login' : '/' });
  });

  app.use(auth.middleware());
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(express.static(publicDir, {
    index: false,
    etag: true,
    maxAge: '10m'
  }));

  app.get('/api/auth/status', (req, res) => {
    res.json({ ok: true, enabled: auth.enabled, authenticated: true });
  });

  app.get('/api/bootstrap', (req, res) => {
    res.json(indexer.getBootstrap());
  });

  app.get('/api/timeline', (req, res) => {
    const startIndex = req.query.start !== undefined ? Number(req.query.start) : null;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : config.indexing.chunkSize;
    const anchorDate = typeof req.query.anchor === 'string' ? req.query.anchor : null;

    res.json(indexer.getTimelineChunk({
      anchorDate,
      startIndex,
      limit
    }));
  });

  app.get('/api/search', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    res.json(indexer.search(query));
  });

  app.get('/api/year/:year', (req, res) => {
    const payload = indexer.getYear(req.params.year);
    if (!payload) {
      res.status(404).json({ error: 'Year not found' });
      return;
    }
    res.json(payload);
  });

  app.get('/api/month/:monthKey', (req, res) => {
    const payload = indexer.getMonth(req.params.monthKey);
    if (!payload) {
      res.status(404).json({ error: 'Month not found' });
      return;
    }
    res.json(payload);
  });

  app.get('/api/entry/:date', async (req, res) => {
    try {
      const isoDate = req.params.date;
      if (!isValidIsoDate(isoDate)) {
        res.status(400).json({ error: 'Invalid entry date.' });
        return;
      }

      const createIfMissing = req.query.create === '1';
      const entry = await indexer.getEntry(isoDate, { createIfMissing });
      if (!entry) {
        res.status(404).json({ error: 'Entry not found.' });
        return;
      }
      res.json(entry);
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to load entry.' });
    }
  });

  app.post('/api/entry/:date', async (req, res) => {
    try {
      const isoDate = req.params.date;
      if (!isValidIsoDate(isoDate)) {
        res.status(400).json({ error: 'Invalid entry date.' });
        return;
      }

      const raw = typeof req.body?.raw === 'string' ? req.body.raw : '';
      const day = await indexer.saveEntry(isoDate, raw);
      res.json({ ok: true, day, isoDate, removed: !day });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to save entry.' });
    }
  });

  app.get('/api/upload/folders', (req, res) => {
    const roots = buildFolderTree(config.paths.photoFolders || []);
    res.json({ roots: roots.map(({ rootId, rootLabel, tree }) => ({ rootId, rootLabel, tree })) });
  });

  app.post('/api/upload/folders', async (req, res) => {
    try {
      const rootId = String(req.body?.rootId || '0');
      const relativePath = String(req.body?.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
      const folderName = sanitizeFileName(req.body?.folderName || 'New Folder');
      const selectedRoot = config.paths.photoFolders[Number(rootId)];
      if (!selectedRoot) {
        res.status(400).json({ error: 'Invalid upload root.' });
        return;
      }
      const baseDir = path.resolve(selectedRoot, relativePath || '.');
      if (!ensurePathInside(selectedRoot, baseDir)) {
        res.status(400).json({ error: 'Invalid upload folder.' });
        return;
      }
      const targetDir = uniqueFolderPath(baseDir, folderName);
      await fs.promises.mkdir(targetDir, { recursive: true });
      res.json({ ok: true, relativePath: path.relative(selectedRoot, targetDir).replace(/\\/g, '/') || '.' });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to create folder.' });
    }
  });

  app.post('/api/upload/media', async (req, res) => {
    const uploadedPaths = [];
    try {
      await runMulter(req, res, uploader.array('files', 64));
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) {
        res.status(400).json({ error: 'No files were uploaded.' });
        return;
      }

      const rootId = String(req.body?.rootId || '0');
      const relativePath = String(req.body?.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
      const targetIsoDate = typeof req.body?.targetIsoDate === 'string' ? req.body.targetIsoDate : '';
      let fileDates = [];
      try {
        const parsed = JSON.parse(typeof req.body?.fileDates === 'string' ? req.body.fileDates : '[]');
        fileDates = Array.isArray(parsed) ? parsed.map((value) => (isValidIsoDate(value) ? value : '')) : [];
      } catch (error) {
        fileDates = [];
      }
      const selectedRoot = config.paths.photoFolders[Number(rootId)];
      if (!selectedRoot) {
        res.status(400).json({ error: 'Invalid upload root.' });
        return;
      }

      const destinationDir = path.resolve(selectedRoot, relativePath || '.');
      if (!ensurePathInside(selectedRoot, destinationDir)) {
        res.status(400).json({ error: 'Invalid upload folder.' });
        return;
      }
      await fs.promises.mkdir(destinationDir, { recursive: true });

      const copied = [];
      for (const [index, file] of files.entries()) {
        const original = sanitizeFileName(file.originalname || path.basename(file.path));
        const destination = uniqueDestinationPath(destinationDir, original);
        const perFileIsoDate = fileDates[index] || targetIsoDate || '';
        try {
          const createdDateApplied = await copyUploadedFileWithOptionalDate({
            file,
            destination,
            setExifDate: isValidIsoDate(perFileIsoDate),
            targetIsoDate: perFileIsoDate
          });
          uploadedPaths.push(destination);
          copied.push({
            fileName: path.basename(destination),
            folder: relativePath || '.',
            size: file.size || 0,
            createdDateApplied,
            isoDate: perFileIsoDate || null
          });
        } catch (error) {
          await fs.promises.rm(destination, { force: true }).catch(() => {});
          throw error;
        } finally {
          await fs.promises.rm(file.path, { force: true }).catch(() => {});
        }
      }

      await indexer.rebuild('upload');
      const distinctDates = new Set(copied.map((item) => item.isoDate).filter(Boolean));
      res.json({
        ok: true,
        copied,
        count: copied.length,
        folder: relativePath || '.',
        isoDate: distinctDates.size === 1 ? Array.from(distinctDates)[0] : (targetIsoDate || null),
        dateMode: distinctDates.size ? 'per-file' : 'existing'
      });
    } catch (error) {
      for (const filePath of uploadedPaths) await fs.promises.rm(filePath, { force: true }).catch(() => {});
      const cleanup = Array.isArray(req.files) ? req.files : [];
      for (const file of cleanup) await fs.promises.rm(file.path, { force: true }).catch(() => {});
      res.status(500).json({ error: error.message || 'Upload failed.' });
    }
  });

  app.post('/api/media/:photoId/tags', async (req, res) => {
    try {
      const tags = Array.isArray(req.body?.tags) ? req.body.tags : String(req.body?.tags || '').split(',');
      const photo = await indexer.setPhotoTags(req.params.photoId, tags);
      if (!photo) {
        res.status(404).json({ error: 'Media not found.' });
        return;
      }
      res.json({ ok: true, photoId: req.params.photoId, tags: photo.tags || [] });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to save tags.' });
    }
  });

  app.post('/api/media/:photoId/description', async (req, res) => {
    try {
      const photo = await indexer.setPhotoDescription(req.params.photoId, req.body?.description || '');
      if (!photo) {
        res.status(404).json({ error: 'Media not found.' });
        return;
      }
      res.json({ ok: true, photoId: req.params.photoId, description: photo.description || '' });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to save description.' });
    }
  });

  app.post('/api/media/:photoId/like', async (req, res) => {
    try {
      const photo = await indexer.setPhotoLiked(req.params.photoId, Boolean(req.body?.liked));
      if (!photo) {
        res.status(404).json({ error: 'Media not found.' });
        return;
      }
      res.json({ ok: true, photoId: req.params.photoId, liked: Boolean(photo.liked) });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to save like state.' });
    }
  });

  app.post('/api/media/:photoId/date', async (req, res) => {
    try {
      const isoDate = typeof req.body?.isoDate === 'string' ? req.body.isoDate.trim() : '';
      if (isoDate && !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
        res.status(400).json({ error: 'Invalid date.' });
        return;
      }
      const photo = await indexer.setPhotoDateOverride(req.params.photoId, isoDate || null);
      if (!photo) {
        res.status(404).json({ error: 'Media not found.' });
        return;
      }
      res.json({
        ok: true,
        photoId: req.params.photoId,
        isoDate: photo.isoDate,
        capturedAt: photo.capturedAt,
        dateSource: photo.dateSource || 'manual'
      });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to save date override.' });
    }
  });

  app.delete('/api/media/:photoId', async (req, res) => {
    try {
      const photo = indexer.getPhoto(req.params.photoId);
      if (!photo) {
        res.status(404).json({ error: 'Media not found.' });
        return;
      }
      const root = (config.paths.photoFolders || []).find((item) => ensurePathInside(item, photo.filePath));
      if (!root) {
        res.status(400).json({ error: 'That file is outside the configured photo folders.' });
        return;
      }
      const trashPath = moveToTrash(root, photo.filePath);
      await fs.promises.mkdir(path.dirname(trashPath), { recursive: true });
      await fs.promises.rename(photo.filePath, trashPath);
      await indexer.rebuild('delete-media');
      res.json({ ok: true, photoId: req.params.photoId, isoDate: photo.isoDate, trashedTo: trashPath });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Delete failed.' });
    }
  });

  app.get('/today', async (req, res) => {
    const isoDate = dateToIsoLocal(new Date());
    res.redirect(`/edit/${isoDate}?create=1`);
  });

  app.get('/edit/:date', async (req, res) => {
    const isoDate = req.params.date;
    if (!isValidIsoDate(isoDate)) {
      res.status(400).send('Invalid entry date.');
      return;
    }
    sendNoStoreFile(res, path.join(publicDir, 'editor.html'));
  });

  app.get('/media/thumb/:photoId', async (req, res) => {
    await imageService.sendThumb(res, req.params.photoId);
  });

  app.get('/media/full/:photoId', async (req, res) => {
    await imageService.sendFull(res, req.params.photoId);
  });

  app.get('/media/journal-inline/:imageName', async (req, res) => {
    await imageService.sendJournalInline(res, decodeURIComponent(req.params.imageName));
  });

  app.get('*', (req, res) => {
    sendNoStoreFile(res, path.join(publicDir, 'index.html'));
  });

  app.listen(config.server.port, () => {
    console.log(`LifeServer running on port ${config.server.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
