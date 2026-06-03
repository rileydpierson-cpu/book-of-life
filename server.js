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
const { dateToIsoLocal, ensureDirSync } = require('./src/utils');
const { SyncService } = require('./src/sync-service');
const { CloudEntryStore } = require('./src/cloud-entry-store');
const { DesktopSyncSettingsStore } = require('./src/desktop-sync-settings');
const { JournalCloudSync } = require('./src/journal-cloud-sync');
const { SupabaseDesktopSync } = require('./src/supabase-desktop-sync');
const { desktopTrayStatus } = require('./src/desktop-tray-status');
const { DESKTOP_STORAGE_MODES, ENTRY_IMPORT_MODES, MEDIA_CLOUD_POLICIES } = require('./shared/sync-contracts');
const {
  copyImportedEntries,
  desktopOnboardingStatus,
  entryImportModeFromPayload,
  hasOnboardingSource,
  normalizeOnboardingMediaFolders
} = require('./src/desktop-onboarding');

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
    if (entry.name === '.trash' || entry.name === '.LifeServerTrash' || entry.name === '.BookOfLifeTrash' || entry.name === '.LifeServer' || entry.name === '.BookOfLife') continue;
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
    if (entry.name === '.trash' || entry.name === '.LifeServerTrash' || entry.name === '.BookOfLifeTrash' || entry.name === '.LifeServer' || entry.name === '.BookOfLife') continue;
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
    icon: relativePath ? 'folder-open' : 'hard-drives'
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

function currentJournalFolderPath(config) {
  return path.join(config.paths.journalVault, config.paths.journalFolderName);
}

function normalizeFolderListFromSettings(settings, config) {
  const enabledFolders = Array.isArray(settings.mediaFolders)
    ? settings.mediaFolders
        .filter((folder) => folder?.enabled !== false && String(folder?.path || '').trim())
        .map((folder) => path.resolve(String(folder.path)))
    : [];
  const deviceRoot = config.paths.deviceSyncRoot ? [config.paths.deviceSyncRoot] : [];
  return [...enabledFolders, ...deviceRoot]
    .filter((folder, index, list) => list.indexOf(folder) === index);
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

async function copyUploadedFilePreservingOriginal(file, destination) {
  await fs.promises.copyFile(file.path, destination);
  return {
    preservedOriginal: true
  };
}

async function copyUploadedFileWithOptionalDate({
  file,
  destination,
  setExifDate,
  targetIsoDate,
  targetCapturedAt
}) {
  if (!setExifDate) {
    await copyUploadedFilePreservingOriginal(file, destination);
    return false;
  }

  if (isExifWritableImage(destination)) {
    try {
      await writeExifDatedImage(file.path, destination, targetIsoDate, { capturedAt: targetCapturedAt });
      return true;
    } catch (error) {
      console.warn(`Upload metadata write skipped for ${destination}: ${error.message}`);
    }
  } else if (isVideoMetadataWritable(destination)) {
    try {
      await writeVideoCreatedDate(file.path, destination, targetIsoDate, { capturedAt: targetCapturedAt });
      return true;
    } catch (error) {
      console.warn(`Upload metadata write skipped for ${destination}: ${error.message}`);
    }
  }

  await copyUploadedFilePreservingOriginal(file, destination);
  return false;
}

async function main() {
  const startupStartedAt = Date.now();
  const projectRoot = __dirname;
  const publicDir = path.join(projectRoot, 'public');
  const distDir = path.join(projectRoot, 'dist');
  const desktopIconPath = [
    process.env.BOOK_OF_LIFE_DESKTOP_ICON_PATH,
    path.join(projectRoot, 'apps', 'desktop', 'assets', 'icon.png')
  ].find((candidate) => candidate && fs.existsSync(candidate));
  const config = loadConfig(projectRoot);
  const app = express();
  const indexer = new TimelineIndexer(config);
  const imageService = new ImageService(config, indexer);
  const auth = new AuthService(config);
  const uploader = createUploader(config.paths.cacheDir);
  const cloudEntryStore = new CloudEntryStore({ cacheDir: config.paths.cacheDir });
  const desktopSyncSettings = new DesktopSyncSettingsStore({ cacheDir: config.paths.cacheDir });
  const desktopCloudSync = new SupabaseDesktopSync({
    settingsStore: desktopSyncSettings,
    cloudEntryStore,
    indexer
  });
  const appCloudSettings = {
    cloudApiBaseUrl: config.cloud.apiBaseUrl,
    supabaseUrl: config.cloud.supabaseUrl,
    supabasePublishableKey: config.cloud.supabasePublishableKey
  };
  const defaultCloudScope = {
    userId: config.cloud.userId || 'local-user',
    libraryId: config.cloud.libraryId || 'default-library',
    deviceId: config.cloud.deviceId || 'local-desktop'
  };
  const syncService = new SyncService({
    cacheDir: config.paths.cacheDir,
    indexer,
    entryStore: cloudEntryStore,
    defaultScope: defaultCloudScope,
    authenticate: async ({ username, password }) => {
      const normalizedUsername = String(username || '').trim();
      if (normalizedUsername) {
        try {
          return auth.authenticateMobileAccount(normalizedUsername, password);
        } catch (error) {
          return { ok: false, error: error.message || 'That account was not accepted.' };
        }
      }
      return { ok: false, error: 'That account was not accepted.' };
    },
    getFolderTree: () => buildFolderTree(config.paths.photoFolders || []),
    createFolder: async (rootId, relativePath, folderName) => {
      const selectedRoot = config.paths.photoFolders[Number(rootId)];
      if (!selectedRoot) throw new Error('Invalid upload root.');
      const safeRelative = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
      const baseDir = path.resolve(selectedRoot, safeRelative || '.');
      if (!ensurePathInside(selectedRoot, baseDir)) throw new Error('Invalid upload folder.');
      const targetDir = uniqueFolderPath(baseDir, sanitizeFileName(folderName || 'New Folder'));
      await fs.promises.mkdir(targetDir, { recursive: true });
      return { rootId, relativePath: path.relative(selectedRoot, targetDir).replace(/\\/g, '/') || '.' };
    },
    deletePhoto: async (photoId) => {
      const photo = indexer.getPhoto(photoId);
      if (!photo) throw new Error('Media not found.');
      const root = (config.paths.photoFolders || []).find((item) => ensurePathInside(item, photo.filePath));
      if (!root) throw new Error('That file is outside the configured photo folders.');
      const trashPath = moveToTrash(root, photo.filePath);
      await fs.promises.mkdir(path.dirname(trashPath), { recursive: true });
      await fs.promises.rename(photo.filePath, trashPath);
      await indexer.removeMediaFile(photoId);
      return { photoId, isoDate: photo.isoDate, trashedTo: trashPath };
    },
    resolveDeviceSyncRoot: async ({ deviceId, deviceName }) => {
      const rootId = String(config.paths.deviceSyncRootId || '');
      if (!rootId) return null;
      const syncRootPath = config.paths.deviceSyncRoot;
      const baseName = deviceName || `device-${deviceId.slice(0, 6)}`;
      const deviceRootPath = path.join(syncRootPath, baseName);
      await fs.promises.mkdir(deviceRootPath, { recursive: true });
      return {
        rootId,
        rootLabel: path.basename(syncRootPath) || syncRootPath,
        deviceFolderName: baseName,
        baseRelativePath: baseName
      };
    }
  });

  app.disable('x-powered-by');
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: false, limit: '8mb' }));

  await desktopSyncSettings.init();
  async function saveDesktopSettings(nextSettings = {}) {
    return desktopSyncSettings.saveSettings({
      ...(nextSettings || {}),
      ...appCloudSettings
    });
  }
  await saveDesktopSettings({});
  const startupDesktopSettings = await desktopSyncSettings.getSettings();
  config.paths.photoFolders = normalizeFolderListFromSettings(startupDesktopSettings, config);
  indexer.setPhotoRoots(config.paths.photoFolders);
  if (startupDesktopSettings.localJournalMirrorPath) {
    indexer.setJournalFolderPath(startupDesktopSettings.localJournalMirrorPath);
  }
  await indexer.loadCache();
  await cloudEntryStore.init();
  await syncService.init();
  const journalCloudSync = new JournalCloudSync({
    journalDir: currentJournalFolderPath(config),
    cloudEntryStore,
    getScope: async () => {
      const settings = await desktopSyncSettings.getSettings();
      return {
        userId: settings.userId || defaultCloudScope.userId,
        libraryId: settings.libraryId || defaultCloudScope.libraryId,
        deviceId: settings.deviceId || defaultCloudScope.deviceId
      };
    },
    onSynced: async (result) => {
      if (!result?.entry) return;
      await syncService.appendChange('entry.upsert', result.entry.isoDate, {
        entry: syncService.serializeEntryRecord(result.entry.isoDate),
        cloudVersion: result.entry.cloudVersion,
        source: 'desktop-file-watch'
      });
    }
  });
  journalCloudSync.start();
  async function applyDesktopRuntimeSettings(settings) {
    const roots = normalizeFolderListFromSettings(settings, config);
    config.paths.photoFolders = roots;
    config.paths.serverPhotoFolders = roots.filter((folder) => folder !== config.paths.deviceSyncRoot);
    config.paths.deviceSyncRootId = roots.includes(config.paths.deviceSyncRoot) ? String(roots.indexOf(config.paths.deviceSyncRoot)) : '';
    roots.forEach((folder) => ensureDirSync(folder));
    indexer.setPhotoRoots(roots);
    if (settings.localJournalMirrorPath) {
      indexer.setJournalFolderPath(settings.localJournalMirrorPath);
      journalCloudSync.setJournalDir(currentJournalFolderPath(config));
    }
  }

  function queueCloudOriginalUpload(reason = 'background') {
    setImmediate(async () => {
      try {
        const settings = await desktopSyncSettings.getSettings();
        if (settings.storageMode !== DESKTOP_STORAGE_MODES.CLOUD_ORIGINALS) return;
        const result = await desktopCloudSync.uploadOriginalsForPolicy();
        console.log(`Cloud original upload queue (${reason}) uploaded ${result.uploaded}, failed ${result.failed}, skipped ${result.skipped}.`);
      } catch (error) {
        console.warn(`Cloud original upload queue skipped (${reason}): ${error.message}`);
      }
    });
  }

  function startIndexRebuild(reason = 'manual') {
    if (indexer.isBuilding) return { ok: true, queued: true, status: indexer.getRebuildStatus() };
    indexer.rebuild(reason)
      .then(() => queueCloudOriginalUpload(reason))
      .catch((error) => console.error(`Index rebuild failed (${reason})`, error));
    return { ok: true, queued: false, status: indexer.getRebuildStatus() };
  }

  async function getActiveCloudScope(overrides = {}) {
    const settings = await desktopSyncSettings.getSettings();
    return {
      userId: overrides.userId || settings.userId || defaultCloudScope.userId,
      libraryId: overrides.libraryId || settings.libraryId || defaultCloudScope.libraryId,
      deviceId: overrides.deviceId || settings.deviceId || defaultCloudScope.deviceId
    };
  }
  let backgroundStartupRebuildQueued = false;

  app.use('/vendor/phosphor/regular', express.static(path.join(projectRoot, 'node_modules', '@phosphor-icons', 'web', 'src', 'regular'), {
    etag: true,
    maxAge: '1d'
  }));
  app.use('/vendor/phosphor/fill', express.static(path.join(projectRoot, 'node_modules', '@phosphor-icons', 'web', 'src', 'fill'), {
    etag: true,
    maxAge: '1d'
  }));
  app.use('/vendor/phosphor/duotone', express.static(path.join(projectRoot, 'node_modules', '@phosphor-icons', 'web', 'src', 'duotone'), {
    etag: true,
    maxAge: '1d'
  }));
  app.use('/vendor/phosphor/bold', express.static(path.join(projectRoot, 'node_modules', '@phosphor-icons', 'web', 'src', 'bold'), {
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

  app.get('/desktop/assets/icon.png', (_req, res) => {
    if (!desktopIconPath) {
      res.status(404).send('Desktop icon unavailable.');
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(desktopIconPath);
  });

  app.get('/login', (req, res) => {
    if (!auth.enabled) {
      res.redirect('/');
      return;
    }
    if (auth.isLocalhostViewerRequest(req)) {
      res.redirect('/');
      return;
    }
    if (auth.getSession(req)) {
      res.redirect('/');
      return;
    }
    sendNoStoreFile(res, path.join(distDir, 'login.html'));
  });

  app.get('/service-worker.js', (req, res) => sendNoStoreFile(res, path.join(publicDir, 'service-worker.js')));

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

    const username = typeof req.body?.username === 'string' ? req.body.username : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    try {
      const result = auth.login(username, password);
      auth.recordSuccessfulLogin(ip);
      console.log(`User ${result.username} logged in successfully from IP ${ip}.`);
      const token = auth.createSession(result.username);
      auth.setSessionCookie(res, token);
      res.json({ ok: true, redirectTo: '/', username: result.username });
    } catch (error) {
      auth.recordFailedLogin(ip);
      res.status(error.statusCode || 401).json({ ok: false, error: error.message || 'Login failed.' });
    }
  });

  app.post('/auth/signup', (req, res) => {
    if (!auth.enabled) {
      res.json({ ok: true, disabled: true, redirectTo: '/' });
      return;
    }

    const username = typeof req.body?.username === 'string' ? req.body.username : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    try {
      const result = auth.signup(username, password);
      const token = auth.createSession(result.username);
      auth.setSessionCookie(res, token);
      res.status(201).json({ ok: true, redirectTo: '/', username: result.username });
    } catch (error) {
      res.status(error.statusCode || 400).json({ ok: false, error: error.message || 'Signup failed.' });
    }
  });

  app.post('/auth/logout', (req, res) => {
    auth.destroySession(req, res);
    res.json({ ok: true, redirectTo: auth.enabled ? '/login' : '/' });
  });

  app.post('/api/sync/connect', async (req, res) => {
    try {
      const payload = await syncService.connect({
        username: typeof req.body?.username === 'string' ? req.body.username : '',
        password: typeof req.body?.password === 'string' ? req.body.password : '',
        deviceName: typeof req.body?.deviceName === 'string' ? req.body.deviceName : '',
        platform: typeof req.body?.platform === 'string' ? req.body.platform : ''
      });
      res.json(payload);
    } catch (error) {
      res.status(401).json({ error: error.message || 'Sync connection failed.' });
    }
  });

  async function requireSyncAuth(req, res, next) {
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const device = await syncService.authenticateToken(token);
    if (!device) {
      res.status(401).json({ error: 'Unauthorized sync client.' });
      return;
    }
    req.syncDevice = device;
    next();
  }

  app.use(auth.middleware());
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(express.static(distDir, {
    index: false,
    etag: true,
    maxAge: '10m'
  }));

  app.get('/api/auth/status', (req, res) => {
    res.json({
      ok: true,
      enabled: auth.enabled,
      authenticated: true,
      username: req.sessionInfo?.username || null
    });
  });

  app.get('/api/cloud/entries', (req, res) => {
    getActiveCloudScope({
      userId: String(req.query.userId || ''),
      libraryId: String(req.query.libraryId || '')
    }).then((scope) => {
      res.json({
        ok: true,
        entries: cloudEntryStore.listEntries(scope)
      });
    }).catch((error) => {
      res.status(500).json({ error: error.message || 'Failed to list cloud entries.' });
    });
  });

  app.get('/api/cloud/entries/:date', async (req, res) => {
    try {
      const isoDate = req.params.date;
      if (!isValidIsoDate(isoDate)) {
        res.status(400).json({ error: 'Invalid entry date.' });
        return;
      }
      const scope = await getActiveCloudScope({
        userId: String(req.query.userId || ''),
        libraryId: String(req.query.libraryId || '')
      });
      const entry = cloudEntryStore.getEntry(scope, isoDate);
      if (!entry) {
        res.status(404).json({ error: 'Cloud entry not found.' });
        return;
      }
      res.json({ ok: true, entry, revisions: cloudEntryStore.getRevisions(scope, isoDate) });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to load cloud entry.' });
    }
  });

  app.post('/api/cloud/entries/:date', async (req, res) => {
    try {
      const isoDate = req.params.date;
      if (!isValidIsoDate(isoDate)) {
        res.status(400).json({ error: 'Invalid entry date.' });
        return;
      }
      const scope = await getActiveCloudScope({
        userId: String(req.body?.userId || ''),
        libraryId: String(req.body?.libraryId || ''),
        deviceId: String(req.body?.deviceId || '')
      });
      const result = await cloudEntryStore.saveEntry(scope, {
        isoDate,
        raw: typeof req.body?.raw === 'string' ? req.body.raw : '',
        baseCloudVersion: Number(req.body?.baseCloudVersion || 0)
      });
      await indexer.saveEntry(isoDate, result.entry.raw);
      await syncService.appendChange('entry.upsert', isoDate, {
        entry: syncService.serializeEntryRecord(isoDate),
        cloudVersion: result.entry.cloudVersion,
        conflict: result.conflict
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to save cloud entry.' });
    }
  });

  app.get('/api/desktop/sync-settings', async (_req, res) => {
    res.json({ ok: true, settings: await desktopSyncSettings.getSettings() });
  });

  app.post('/api/desktop/sync-settings', async (req, res) => {
    try {
      const settings = await saveDesktopSettings(req.body?.settings || req.body || {});
      await applyDesktopRuntimeSettings(settings);
      await syncService.appendChange('sync-settings.upsert', settings.deviceId || defaultCloudScope.deviceId, {
        settings
      });
      res.json({ ok: true, settings });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to save desktop sync settings.' });
    }
  });

  app.get('/api/desktop/cloud/status', async (_req, res) => {
    try {
      res.json(await desktopCloudSync.status());
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || 'Failed to read desktop cloud status.' });
    }
  });

  app.post('/api/desktop/cloud/connect', async (req, res) => {
    try {
      const settings = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : {};
      if (Object.keys(settings).length) await saveDesktopSettings(settings);
      const email = String(req.body?.email || '').trim();
      const password = String(req.body?.password || '');
      if (!email || !password) {
        res.status(400).json({ ok: false, error: 'Email and password are required.' });
        return;
      }
      const nextSettings = await desktopCloudSync.signIn({ email, password });
      await syncService.appendChange('device.upsert', nextSettings.deviceId, {
        deviceId: nextSettings.deviceId,
        libraryId: nextSettings.libraryId,
        source: 'desktop-cloud-connect'
      });
      res.json({ ok: true, settings: nextSettings, status: await desktopCloudSync.status() });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || 'Failed to connect desktop to Book of Life Cloud.' });
    }
  });

  app.post('/api/desktop/cloud/sync', async (_req, res) => {
    try {
      const result = await desktopCloudSync.syncEntries();
      await syncService.appendChange('entry.cloud.pull', result.libraryId, result);
      res.json(result);
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || 'Desktop cloud sync failed.' });
    }
  });

  app.post('/api/desktop/cloud/signup', async (req, res) => {
    try {
      const settings = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : {};
      if (Object.keys(settings).length) await saveDesktopSettings(settings);
      const email = String(req.body?.email || '').trim();
      const password = String(req.body?.password || '');
      if (!email || !password) {
        res.status(400).json({ ok: false, error: 'Email and password are required.' });
        return;
      }
      const nextSettings = await desktopCloudSync.signUp({ email, password });
      await applyDesktopRuntimeSettings(nextSettings);
      await syncService.appendChange('device.upsert', nextSettings.deviceId, {
        deviceId: nextSettings.deviceId,
        libraryId: nextSettings.libraryId,
        source: 'desktop-cloud-signup'
      });
      res.status(201).json({ ok: true, settings: nextSettings, status: await desktopCloudSync.status() });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || 'Failed to create Supabase account.' });
    }
  });

  app.get('/api/desktop/index/status', (_req, res) => {
    res.json({ ok: true, status: indexer.getRebuildStatus() });
  });

  app.post('/api/desktop/index/rebuild', (_req, res) => {
    res.json(startIndexRebuild('desktop-manual'));
  });

  app.get('/api/desktop/tray/status', async (_req, res) => {
    try {
      const cloudStatus = await desktopCloudSync.status().catch((error) => ({ error: error.message }));
      const storageUsage = await desktopCloudSync.storageUsage().catch((error) => ({
        available: false,
        usedBytes: 0,
        error: error.message
      }));
      res.json(desktopTrayStatus({
        localService: {
          running: true,
          port: config.server.port,
          url: `http://127.0.0.1:${config.server.port}`
        },
        cloudStatus,
        indexStatus: indexer.getRebuildStatus(),
        storageUsage
      }));
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || 'Failed to read tray status.' });
    }
  });

  app.get('/api/desktop/onboarding/status', async (_req, res) => {
    try {
      const settings = await desktopSyncSettings.getSettings();
      res.json(desktopOnboardingStatus({
        settings,
        indexer,
        indexStatus: indexer.getRebuildStatus(),
        cloudStatus: await desktopCloudSync.status().catch((error) => ({ error: error.message }))
      }));
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || 'Failed to read onboarding status.' });
    }
  });

  app.post('/api/desktop/onboarding/complete', async (req, res) => {
    try {
      const body = req.body || {};
      const currentSettings = await desktopSyncSettings.getSettings();
      let storageMode = body.storageMode === DESKTOP_STORAGE_MODES.CLOUD_ORIGINALS
        ? DESKTOP_STORAGE_MODES.CLOUD_ORIGINALS
        : DESKTOP_STORAGE_MODES.DEVICE_ONLY;
      const cloudStatus = await desktopCloudSync.status().catch(() => ({ signedIn: false }));
      const requestedFolders = Array.isArray(body.mediaFolders) ? body.mediaFolders : [];
      const requestsCloudOriginals = requestedFolders.some((folder) => folder?.cloudPolicy === MEDIA_CLOUD_POLICIES.ALL_ORIGINALS) ||
        storageMode === DESKTOP_STORAGE_MODES.CLOUD_ORIGINALS;
      if (requestsCloudOriginals && !cloudStatus.signedIn) {
        res.status(400).json({ ok: false, error: 'Sign in before storing originals in the cloud.' });
        return;
      }
      if (requestsCloudOriginals) storageMode = DESKTOP_STORAGE_MODES.CLOUD_ORIGINALS;

      const entryImportMode = entryImportModeFromPayload(body);
      const nextMediaFolders = normalizeOnboardingMediaFolders(body.mediaFolders || [], storageMode);
      const nextSettings = {
        ...currentSettings,
        storageMode,
        entryImportMode,
        mediaFolders: nextMediaFolders,
        localJournalMirrorPath: entryImportMode === ENTRY_IMPORT_MODES.MIRROR
          ? String(body.journalMirrorPath || '').trim()
          : currentSettings.localJournalMirrorPath,
        onboardingCompletedAt: new Date().toISOString()
      };

      let importResult = { copied: 0, skipped: 0 };
      if (entryImportMode === ENTRY_IMPORT_MODES.COPY && String(body.entryImportPath || '').trim()) {
        importResult = await copyImportedEntries({
          sourceDir: body.entryImportPath,
          destinationJournalDir: currentJournalFolderPath(config)
        });
        nextSettings.importedEntriesAt = new Date().toISOString();
      }

      if (!hasOnboardingSource(nextSettings)) {
        res.status(400).json({ ok: false, error: 'Add a media folder, import entries, or select a journal mirror before continuing.' });
        return;
      }
      const savedSettings = await saveDesktopSettings(nextSettings);
      await applyDesktopRuntimeSettings(savedSettings);
      await syncService.appendChange('sync-settings.upsert', savedSettings.deviceId || defaultCloudScope.deviceId, {
        settings: savedSettings,
        source: 'desktop-onboarding'
      });
      const rebuild = startIndexRebuild('desktop-onboarding');
      res.json({
        ok: true,
        import: importResult,
        rebuild,
        status: desktopOnboardingStatus({
          settings: savedSettings,
          indexer,
          indexStatus: indexer.getRebuildStatus(),
          cloudStatus: await desktopCloudSync.status().catch((error) => ({ error: error.message }))
        })
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || 'Desktop onboarding failed.' });
    }
  });

  app.post('/auth/password', (req, res) => {
    if (!auth.enabled) {
      res.json({ ok: true, disabled: true });
      return;
    }
    const session = auth.getSession(req);
    if (!session?.username) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }

    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const nextPassword = typeof req.body?.nextPassword === 'string' ? req.body.nextPassword : '';
    try {
      auth.changePassword(session.username, currentPassword, nextPassword);
      res.json({ ok: true, username: session.username });
    } catch (error) {
      res.status(error.statusCode || 400).json({ ok: false, error: error.message || 'Password update failed.' });
    }
  });

  app.get('/api/bootstrap', (req, res) => {
    res.json(indexer.getBootstrap());
  });

  app.get('/api/sync/bootstrap', requireSyncAuth, (req, res) => {
    res.json(syncService.buildBootstrapPayload());
  });

  app.get('/api/sync/changes', requireSyncAuth, async (req, res) => {
    const since = req.query.since !== undefined ? Number(req.query.since) : 0;
    res.json(await syncService.listChangesSince(since));
  });

  app.post('/api/sync/mutations', requireSyncAuth, async (req, res) => {
    try {
      const mutations = Array.isArray(req.body?.mutations) ? req.body.mutations : [];
      res.json(await syncService.applyMutations(mutations));
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to apply mutations.' });
    }
  });

  app.post('/api/sync/media/upload', requireSyncAuth, async (req, res) => {
    let uploadedDestination = '';
    try {
      await runMulter(req, res, uploader.single('file'));
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'No media file was uploaded.' });
        return;
      }

      const deviceSyncRoot = req.syncDevice?.syncRoot;
      if (!deviceSyncRoot?.rootId || !deviceSyncRoot?.baseRelativePath) {
        res.status(400).json({ error: 'This device is not configured for media sync uploads.' });
        return;
      }

      const requestedRootId = String(req.body?.rootId || '');
      if (requestedRootId !== String(deviceSyncRoot.rootId)) {
        res.status(400).json({ error: 'Upload root does not match the connected device namespace.' });
        return;
      }

      const selectedRoot = config.paths.photoFolders[Number(deviceSyncRoot.rootId)];
      if (!selectedRoot) {
        res.status(400).json({ error: 'Invalid sync upload root.' });
        return;
      }

      const baseRelativePath = String(deviceSyncRoot.baseRelativePath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const requestedRelativePath = String(req.body?.relativePath || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
      if (!requestedRelativePath || (requestedRelativePath !== baseRelativePath && !requestedRelativePath.startsWith(`${baseRelativePath}/`))) {
        res.status(400).json({ error: 'Upload path must stay inside the device sync namespace.' });
        return;
      }

      const destinationDir = path.resolve(selectedRoot, requestedRelativePath || '.');
      if (!ensurePathInside(selectedRoot, destinationDir)) {
        res.status(400).json({ error: 'Invalid sync upload folder.' });
        return;
      }

      await fs.promises.mkdir(destinationDir, { recursive: true });
      const safeFileName = sanitizeFileName(req.body?.fileName || file.originalname || path.basename(file.path));
      uploadedDestination = uniqueDestinationPath(destinationDir, safeFileName);
      await copyUploadedFilePreservingOriginal(file, uploadedDestination);

      const addedPhotos = await indexer.addMediaFiles([uploadedDestination]);
      const photo = addedPhotos[0] || null;
      if (!photo) {
        throw new Error('Upload completed, but the server could not index the media file.');
      }

      await syncService.appendChange('media.upsert', photo.id, {
        media: syncService.serializeMediaRecord(photo)
      });

      res.json({
        ok: true,
        localAssetId: String(req.body?.localAssetId || ''),
        photo: syncService.serializeMediaRecord(photo),
        relativePath: requestedRelativePath || '.'
      });
    } catch (error) {
      if (uploadedDestination) {
        await fs.promises.rm(uploadedDestination, { force: true }).catch(() => {});
      }
      res.status(500).json({ error: error.message || 'Mobile media upload failed.' });
    } finally {
      if (req.file?.path) {
        await fs.promises.rm(req.file.path, { force: true }).catch(() => {});
      }

      console.log(`Sync upload attempt from device ${req.syncDevice?.deviceName || req.syncDevice?.id || 'unknown'} resulted in: ${error ? error.message : 'success'}`);
    }
  });

  app.get('/api/sync/media/:variant/:photoId', requireSyncAuth, async (req, res) => {
    try {
      const variant = String(req.params.variant || '');
      if (variant === 'thumb') {
        await imageService.sendThumb(res, req.params.photoId);
        return;
      }
      if (variant === 'preview') {
        await imageService.sendPreview(res, req.params.photoId);
        return;
      }
      if (variant === 'full') {
        await imageService.sendFull(res, req.params.photoId);
        return;
      }
      res.status(400).json({ error: 'Unsupported media variant.' });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to stream synced media.' });
    }
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

  app.get('/api/gallery', (req, res) => {
    const startIndex = req.query.start !== undefined ? Number(req.query.start) : 0;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : config.indexing.chunkSize;
    res.json(indexer.getGalleryChunk({ startIndex, limit }));
  });

  app.get('/api/gallery/index', (req, res) => {
    res.json(indexer.getGalleryIndex());
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
      const activeCloudScope = await getActiveCloudScope();
      const cloudEntry = cloudEntryStore.getEntry(activeCloudScope, isoDate);
      if (cloudEntry) {
        res.json({
          isoDate,
          raw: cloudEntry.raw || '',
          title: cloudEntry.title || '',
          cloudVersion: cloudEntry.cloudVersion,
          updatedAt: cloudEntry.updatedAt,
          updatedByDeviceId: cloudEntry.updatedByDeviceId,
          source: 'cloud'
        });
        return;
      }
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
      const activeCloudScope = await getActiveCloudScope();
      const cloudResult = await cloudEntryStore.saveEntry(activeCloudScope, {
        isoDate,
        raw,
        baseCloudVersion: Number(req.body?.baseCloudVersion || 0)
      });
      const day = await indexer.saveEntry(isoDate, raw);
      await syncService.appendChange(day ? 'entry.upsert' : 'entry.delete', isoDate, {
        entry: syncService.serializeEntryRecord(isoDate),
        day,
        cloudVersion: cloudResult.entry.cloudVersion,
        conflict: cloudResult.conflict
      });
      res.json({ ok: true, day, isoDate, removed: !day, cloudEntry: cloudResult.entry, conflict: cloudResult.conflict });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to save entry.' });
    }
  });

  app.get('/api/upload/folders', (req, res) => {
    const roots = buildFolderTree(config.paths.photoFolders || []);
    res.json({ roots: roots.map(({ rootId, rootLabel, tree }) => ({ rootId, rootLabel, tree })) });
  });

  app.get('/api/folders/browse', (req, res) => {
    const rootId = String(req.query.rootId || '0');
    const relativePath = String(req.query.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const payload = indexer.getFolderBrowse(rootId, relativePath);
    if (!payload) {
      res.status(404).json({ error: 'Folder not found.' });
      return;
    }
    res.json(payload);
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
      const createdRelativePath = path.relative(selectedRoot, targetDir).replace(/\\/g, '/') || '.';
      await syncService.appendChange('folder.upsert', `${rootId}:${createdRelativePath}`, {
        rootId,
        relativePath: createdRelativePath
      });
      res.json({ ok: true, relativePath: createdRelativePath });
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
      let fileDateTimes = [];
      try {
        const parsed = JSON.parse(typeof req.body?.fileDates === 'string' ? req.body.fileDates : '[]');
        fileDates = Array.isArray(parsed) ? parsed.map((value) => (isValidIsoDate(value) ? value : '')) : [];
      } catch (error) {
        fileDates = [];
      }
      try {
        const parsed = JSON.parse(typeof req.body?.fileDateTimes === 'string' ? req.body.fileDateTimes : '[]');
        fileDateTimes = Array.isArray(parsed)
          ? parsed.map((value) => {
              if (!value || typeof value !== 'object') return null;
              const isoDate = isValidIsoDate(value.isoDate) ? value.isoDate : '';
              const capturedAt = typeof value.capturedAt === 'string' && /T\d{2}:\d{2}:\d{2}/.test(value.capturedAt)
                ? value.capturedAt
                : (isoDate ? `${isoDate}T12:00:00.000Z` : '');
              return isoDate ? { isoDate, capturedAt } : null;
            })
          : [];
      } catch (error) {
        fileDateTimes = [];
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
      const dateOverrides = {};
      for (const [index, file] of files.entries()) {
        const original = sanitizeFileName(file.originalname || path.basename(file.path));
        const destination = uniqueDestinationPath(destinationDir, original);
        const perFileDateTime = fileDateTimes[index] || null;
        const perFileIsoDate = perFileDateTime?.isoDate || fileDates[index] || targetIsoDate || '';
        const perFileCapturedAt = perFileDateTime?.capturedAt || (isValidIsoDate(perFileIsoDate) ? `${perFileIsoDate}T12:00:00.000Z` : '');
        try {
          const createdDateApplied = await copyUploadedFileWithOptionalDate({
            file,
            destination,
            setExifDate: req.body?.setExifDate === '1' && isValidIsoDate(perFileIsoDate),
            targetIsoDate: perFileIsoDate,
            targetCapturedAt: perFileCapturedAt
          });
          uploadedPaths.push(destination);
          if (isValidIsoDate(perFileIsoDate)) {
            dateOverrides[destination] = {
              isoDate: perFileIsoDate,
              capturedAt: perFileCapturedAt,
              source: 'upload'
            };
          }
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

      if (Object.keys(dateOverrides).length) {
        await indexer.setMediaDateOverridesByPath(dateOverrides);
      }
      const addedPhotos = await indexer.addMediaFiles(uploadedPaths);
      for (const photo of addedPhotos) {
        await syncService.appendChange('media.upsert', photo.id, {
          media: syncService.serializeMediaRecord(photo)
        });
      }
      const distinctDates = new Set(copied.map((item) => item.isoDate).filter(Boolean));
      res.json({
        ok: true,
        copied,
        count: copied.length,
        folder: relativePath || '.',
        isoDate: distinctDates.size === 1 ? Array.from(distinctDates)[0] : (targetIsoDate || null),
        dateMode: distinctDates.size ? 'per-file' : 'existing'
      });

      console.log(`Sync upload from device ${req.syncDevice?.deviceName || req.syncDevice?.id || 'unknown'} completed.`);
    } catch (error) {
      console.error(`Sync upload from device ${req.syncDevice?.deviceName || req.syncDevice?.id || 'unknown'} failed:`, error);
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
      await syncService.appendChange('media.upsert', req.params.photoId, {
        media: syncService.serializeMediaRecord(photo)
      });
      res.json({ ok: true, photoId: req.params.photoId, tags: photo.tags || [] });
      console.log(`Updated tags for media ${req.params.photoId}:`, photo.tags);
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
      await syncService.appendChange('media.upsert', req.params.photoId, {
        media: syncService.serializeMediaRecord(photo)
      });
      res.json({ ok: true, photoId: req.params.photoId, description: photo.description || '' });
      console.log(`Description updated for media ${req.params.photoId}.`);
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to save description.' });
    }
  });

  app.post('/api/media/:photoId/rename', async (req, res) => {
    try {
      const baseName = sanitizeFileName(req.body?.baseName || '');
      if (!baseName) {
        res.status(400).json({ error: 'Filename cannot be empty.' });
        return;
      }
      const photo = await indexer.renamePhoto(req.params.photoId, baseName);
      if (!photo) {
        res.status(404).json({ error: 'Media not found.' });
        return;
      }
      await syncService.appendChange('media.upsert', req.params.photoId, {
        media: syncService.serializeMediaRecord(photo)
      });
      res.json({ ok: true, photo });
      console.log(`Renamed media ${req.params.photoId} to ${baseName}.`);
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to rename media.' });
    }
  });

  app.post('/api/media/:photoId/validate-name', async (req, res) => {
    try {
      const photo = indexer.getPhoto(req.params.photoId);
      if (!photo) {
        res.status(404).json({ error: 'Media not found.' });
        return;
      }
      const rawBaseName = String(req.body?.baseName || '').trim();
      const baseName = sanitizeFileName(rawBaseName);
      if (!rawBaseName || !baseName) {
        res.json({ ok: true, valid: false, reason: 'empty' });
        return;
      }
      if (baseName === photo.baseName) {
        res.json({ ok: true, valid: true, exists: false });
        return;
      }
      const candidatePath = path.join(path.dirname(photo.filePath), `${baseName}${photo.ext}`);
      try {
        await fs.promises.access(candidatePath);
        res.json({ ok: true, valid: false, exists: true, reason: 'exists' });
      } catch (error) {
        res.json({ ok: true, valid: true, exists: false });
      }
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to validate filename.' });
    }
  });

  app.post('/api/media/:photoId/move', async (req, res) => {
    try {
      const rootId = String(req.body?.rootId || '');
      const relativePath = String(req.body?.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
      const photo = await indexer.movePhoto(req.params.photoId, rootId, relativePath);
      if (!photo) {
        res.status(404).json({ error: 'Media not found.' });
        return;
      }
      await syncService.appendChange('media.upsert', req.params.photoId, {
        media: syncService.serializeMediaRecord(photo)
      });
      res.json({ ok: true, photo });
      console.log(`Moved media ${req.params.photoId} to root ${rootId} and path ${relativePath}.`);
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to move media.' });
    }
  });

  app.post('/api/media/:photoId/like', async (req, res) => {
    try {
      const photo = await indexer.setPhotoLiked(req.params.photoId, Boolean(req.body?.liked));
      if (!photo) {
        res.status(404).json({ error: 'Media not found.' });
        return;
      }
      await syncService.appendChange('media.upsert', req.params.photoId, {
        media: syncService.serializeMediaRecord(photo)
      });
      res.json({ ok: true, photoId: req.params.photoId, liked: Boolean(photo.liked) });
      console.log(`Set liked state for media ${req.params.photoId} to ${Boolean(photo.liked)}.`);
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
      const photo = await indexer.setPhotoDateTime(req.params.photoId, { isoDate: isoDate || null });
      if (!photo) {
        res.status(404).json({ error: 'Media not found.' });
        return;
      }
      await syncService.appendChange('media.upsert', req.params.photoId, {
        media: syncService.serializeMediaRecord(photo)
      });
      res.json({
        ok: true,
        photoId: req.params.photoId,
        isoDate: photo.isoDate,
        capturedAt: photo.capturedAt,
        dateSource: photo.dateSource || 'manual'
      });
      console.log(`Set date override for media ${req.params.photoId} to ${isoDate || 'null'}.`);
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to save date override.' });
    }
  });

  app.post('/api/media/:photoId/date-time', async (req, res) => {
    try {
      const isoDate = typeof req.body?.isoDate === 'string' ? req.body.isoDate.trim() : '';
      const time = typeof req.body?.time === 'string' ? req.body.time.trim() : '';
      if (isoDate && !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
        res.status(400).json({ error: 'Invalid date.' });
        return;
      }
      if (time && !/^\d{2}:\d{2}$/.test(time)) {
        res.status(400).json({ error: 'Invalid time.' });
        return;
      }
      const photo = await indexer.setPhotoDateTime(req.params.photoId, { isoDate: isoDate || null, time: time || null });
      if (!photo) {
        res.status(404).json({ error: 'Media not found.' });
        return;
      }
      await syncService.appendChange('media.upsert', req.params.photoId, {
        media: syncService.serializeMediaRecord(photo)
      });
      res.json({ ok: true, photo });
      console.log(`Set date/time override for media ${req.params.photoId} to ${isoDate || 'null'} ${time || ''}.`);
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to save media date/time.' });
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
      const deleted = await syncService.deletePhoto(req.params.photoId);
      await syncService.appendChange('media.delete', req.params.photoId, {
        photoId: req.params.photoId,
        deleted: true,
        isoDate: deleted.isoDate
      });
      res.json({ ok: true, photoId: req.params.photoId, isoDate: deleted.isoDate, trashedTo: deleted.trashedTo });
      console.log(`Deleted media ${req.params.photoId}.`);
    } catch (error) {
      res.status(500).json({ error: error.message || 'Delete failed.' });
    }
  });

  app.get('/today', async (req, res) => {
    const isoDate = dateToIsoLocal(new Date());
    res.redirect(`/edit/${isoDate}?create=1`);
  });

  app.get('/desktop/settings', async (_req, res) => {
    sendNoStoreFile(res, path.join(distDir, 'desktop-settings.html'));
  });

  app.get('/desktop/onboarding', async (_req, res) => {
    sendNoStoreFile(res, path.join(distDir, 'desktop-onboarding.html'));
  });

  app.get('/desktop/tray', async (_req, res) => {
    sendNoStoreFile(res, path.join(distDir, 'desktop-tray.html'));
  });

  app.get('/edit/:date', async (req, res) => {
    const isoDate = req.params.date;
    if (!isValidIsoDate(isoDate)) {
      res.status(400).send('Invalid entry date.');
      return;
    }
    sendNoStoreFile(res, path.join(distDir, 'editor.html'));
  });

  app.get('/entry/:date', async (req, res) => {
    const isoDate = req.params.date;
    if (!isValidIsoDate(isoDate)) {
      res.status(400).send('Invalid entry date.');
      return;
    }
    sendNoStoreFile(res, path.join(distDir, 'index.html'));
  });

  app.get('/media/thumb/:photoId', async (req, res) => {
    await imageService.sendThumb(res, req.params.photoId);
  });

  app.get('/media/preview/:photoId', async (req, res) => {
    await imageService.sendPreview(res, req.params.photoId);
  });

  app.get('/media/display/:photoId', async (req, res) => {
    await imageService.sendDisplay(res, req.params.photoId);
  });

  app.get('/media/full/:photoId', async (req, res) => {
    await imageService.sendFull(res, req.params.photoId);
  });

  app.get('/media/download/:photoId', async (req, res) => {
    await imageService.sendDownload(res, req.params.photoId);
  });

  app.get('/media/journal-inline/:imageName', async (req, res) => {
    await imageService.sendJournalInline(res, decodeURIComponent(req.params.imageName));
  });

  app.get('*', (req, res) => {
    sendNoStoreFile(res, path.join(distDir, 'index.html'));
  });

  await new Promise((resolve, reject) => {
    const server = app.listen(config.server.port, () => {
      const startupDurationMs = Date.now() - startupStartedAt;
      console.log(`Book of Life running on port ${config.server.port} after ${formatStartupDuration(startupDurationMs)} total startup.`);
      console.log(`Book of Life startup summary: cached index loaded, server ready ${formatStartupDuration(startupDurationMs)}.`);
      if (!backgroundStartupRebuildQueued) {
        backgroundStartupRebuildQueued = true;
        setImmediate(() => {
          indexer.scheduleRebuild('startup');
          setInterval(() => indexer.scheduleRefresh('interval'), config.indexing.rebuildIntervalMs).unref();
        });
      }
      resolve(server);
    });
    server.on('error', reject);
  });
}

function formatStartupDuration(durationMs) {
  const ms = Math.max(0, Number(durationMs) || 0);
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = Math.round(seconds % 60);
  return `${minutes}m ${String(remainderSeconds).padStart(2, '0')}s`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
