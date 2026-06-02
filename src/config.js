const fs = require('fs');
const path = require('path');
const {
  BOOK_OF_LIFE_SUPABASE_URL,
  BOOK_OF_LIFE_SUPABASE_PUBLISHABLE_KEY
} = require('./cloud-config');
const { ensureDirSync } = require('./utils');

function loadDotEnv(projectRoot) {
  const dotEnvPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(dotEnvPath)) return;

  const raw = fs.readFileSync(dotEnvPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value.replace(/\\n/g, '\n');
  }
}

function expandEnvString(value) {
  return String(value || '').replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key) => process.env[key] || '');
}

function getConfigValue(configValue, envName, fallbackValue = '') {
  const envValue = process.env[envName];
  if (envValue !== undefined && envValue !== '') return envValue;
  if (configValue === undefined || configValue === null || configValue === '') return fallbackValue;
  return expandEnvString(configValue);
}

function splitPathList(value) {
  return String(value || '')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitFlexibleList(value) {
  return String(value || '')
    .split(/[,;\r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePhotoFolderList(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizePhotoFolderList(item));
  }

  const trimmed = String(value || '').trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => String(item || '').trim())
          .filter(Boolean);
      }
    } catch (error) {
      // Fall through and treat the value as a normal path string/list.
    }
  }

  return splitFlexibleList(trimmed);
}

function parseBoolean(value, fallbackValue = false) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallbackValue;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallbackValue;
}

function parsePositiveNumber(value, fallbackValue) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function normalizeUsernameList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean);
  }

  const trimmed = String(value || '').trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return normalizeUsernameList(parsed);
    } catch (error) {
      // Fall through to plain string parsing.
    }
  }

  return splitFlexibleList(trimmed)
    .map((item) => item.toLowerCase())
    .filter(Boolean);
}

function resolvePath(projectRoot, value, fallbackValue = '') {
  const finalValue = String(value || fallbackValue || '').trim();
  return path.resolve(projectRoot, finalValue);
}

function requireResolvedPath(projectRoot, value, errorMessage) {
  const finalValue = String(value || '').trim();
  if (!finalValue) throw new Error(errorMessage);
  return path.resolve(projectRoot, finalValue);
}

function loadConfig(projectRoot) {
  loadDotEnv(projectRoot);

  const configPath = path.join(projectRoot, 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Missing config.json. Copy config.example.json to config.json and update the folder paths.');
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw);

  const journalVaultValue = getConfigValue(config.paths?.journalVault, 'LIFESERVER_JOURNAL_VAULT');
  const journalVault = requireResolvedPath(
    projectRoot,
    journalVaultValue,
    'Missing journal vault path. Set paths.journalVault in config.json or LIFESERVER_JOURNAL_VAULT in the environment.'
  );
  const journalFolderName = getConfigValue(config.paths?.journalFolderName, 'LIFESERVER_JOURNAL_FOLDER_NAME', 'Journal');
  const journalImagesFolderName = getConfigValue(config.paths?.journalImagesFolderName, 'LIFESERVER_JOURNAL_IMAGES_FOLDER_NAME', 'Images');
  const photoFolderEnvValue = process.env.LIFESERVER_PHOTO_FOLDERS || process.env.LIFESERVER_PHOTO_ROOT || '';
  const configuredPhotoFolders = (config.paths?.photoFolders || []).flatMap((folder) => normalizePhotoFolderList(expandEnvString(folder)));
  const photoFolders = (
    photoFolderEnvValue
      ? normalizePhotoFolderList(photoFolderEnvValue)
      : configuredPhotoFolders
  )
    .map((folder) => String(folder || '').trim())
    .filter(Boolean)
    .map((folder) => resolvePath(projectRoot, folder));
  const deviceSyncRoot = resolvePath(
    projectRoot,
    getConfigValue(config.paths?.deviceSyncRoot, 'LIFESERVER_DEVICE_SYNC_ROOT', './storage/device-sync')
  );
  const includeDeviceSyncRoot = parseBoolean(
    getConfigValue(config.paths?.includeDeviceSyncRoot, 'LIFESERVER_INCLUDE_DEVICE_SYNC_ROOT', true),
    true
  );
  const allPhotoFolders = includeDeviceSyncRoot
    ? [...photoFolders, deviceSyncRoot].filter((folder, index, list) => list.indexOf(folder) === index)
    : photoFolders.slice();
  const deviceSyncRootId = includeDeviceSyncRoot ? String(allPhotoFolders.indexOf(deviceSyncRoot)) : '';
  const cacheDir = resolvePath(
    projectRoot,
    getConfigValue(config.paths?.cacheDir, 'LIFESERVER_CACHE_DIR', './.cache')
  );
  const authUserStorePath = resolvePath(
    projectRoot,
    getConfigValue(config.auth?.userStorePath, 'LIFESERVER_AUTH_USER_STORE', './storage/auth/users.json')
  );

  ensureDirSync(journalVault);
  ensureDirSync(path.join(journalVault, journalFolderName));
  ensureDirSync(path.join(journalVault, journalImagesFolderName));
  for (const folder of allPhotoFolders) ensureDirSync(folder);
  ensureDirSync(cacheDir);
  ensureDirSync(path.join(cacheDir, 'thumbs'));
  ensureDirSync(path.join(cacheDir, 'converted'));
  ensureDirSync(path.join(cacheDir, 'display'));

  return {
    server: {
      port: Number(getConfigValue(config.server?.port, 'PORT', 3000))
    },
    cloud: {
      enabled: parseBoolean(getConfigValue(config.cloud?.enabled, 'BOOK_OF_LIFE_CLOUD_ENABLED'), false),
      apiBaseUrl: String(getConfigValue(config.cloud?.apiBaseUrl, 'BOOK_OF_LIFE_CLOUD_API_BASE_URL', '') || '').trim(),
      supabaseUrl: String(getConfigValue(
        config.cloud?.supabaseUrl,
        'BOOK_OF_LIFE_SUPABASE_URL',
        process.env.NEXT_PUBLIC_SUPABASE_URL || BOOK_OF_LIFE_SUPABASE_URL
      ) || '').trim(),
      supabasePublishableKey: String(getConfigValue(
        config.cloud?.supabasePublishableKey,
        'BOOK_OF_LIFE_SUPABASE_PUBLISHABLE_KEY',
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || BOOK_OF_LIFE_SUPABASE_PUBLISHABLE_KEY
      ) || '').trim(),
      userId: String(getConfigValue(config.cloud?.userId, 'BOOK_OF_LIFE_USER_ID', 'local-user') || 'local-user').trim(),
      libraryId: String(getConfigValue(config.cloud?.libraryId, 'BOOK_OF_LIFE_LIBRARY_ID', 'default-library') || 'default-library').trim(),
      deviceId: String(getConfigValue(config.cloud?.deviceId, 'BOOK_OF_LIFE_DEVICE_ID', 'local-desktop') || 'local-desktop').trim()
    },
    mediaOptimization: {
      enabled: parseBoolean(getConfigValue(config.mediaOptimization?.enabled, 'LIFESERVER_MEDIA_OPTIMIZATION_ENABLED', true), true),
      imageMaxEdge: Math.round(parsePositiveNumber(getConfigValue(config.mediaOptimization?.imageMaxEdge, 'LIFESERVER_MEDIA_IMAGE_MAX_EDGE', 2560), 2560)),
      imageQuality: Math.max(1, Math.min(100, Math.round(parsePositiveNumber(getConfigValue(config.mediaOptimization?.imageQuality, 'LIFESERVER_MEDIA_IMAGE_QUALITY', 86), 86)))),
      videoMaxHeight: Math.round(parsePositiveNumber(getConfigValue(config.mediaOptimization?.videoMaxHeight, 'LIFESERVER_MEDIA_VIDEO_MAX_HEIGHT', 1080), 1080)),
      videoCrf: Math.max(0, Math.min(51, Math.round(parsePositiveNumber(getConfigValue(config.mediaOptimization?.videoCrf, 'LIFESERVER_MEDIA_VIDEO_CRF', 22), 22)))),
      videoPreset: String(getConfigValue(config.mediaOptimization?.videoPreset, 'LIFESERVER_MEDIA_VIDEO_PRESET', 'medium') || 'medium').trim() || 'medium'
    },
    auth: {
      enabled: parseBoolean(getConfigValue(config.auth?.enabled, 'LIFESERVER_AUTH_ENABLED'), false),
      allowLocalhostViewerBypass: parseBoolean(
        getConfigValue(config.auth?.allowLocalhostViewerBypass, 'LIFESERVER_ALLOW_LOCALHOST_VIEWER_BYPASS'),
        false
      ),
      allowedUsers: normalizeUsernameList(getConfigValue(config.auth?.allowedUsers, 'LIFESERVER_ALLOWED_USERS', '')),
      userStorePath: authUserStorePath,
      sessionDays: Math.max(1, Number(getConfigValue(config.auth?.sessionDays, 'LIFESERVER_SESSION_DAYS', 30))),
      secureCookie: parseBoolean(getConfigValue(config.auth?.secureCookie, 'LIFESERVER_SECURE_COOKIE'), false)
    },
    paths: {
      journalVault,
      journalFolderName,
      journalImagesFolderName,
      photoFolders: allPhotoFolders,
      serverPhotoFolders: photoFolders,
      deviceSyncRoot,
      deviceSyncRootId,
      cacheDir
    },
    indexing: {
      rebuildIntervalMs: Number(config.indexing?.rebuildIntervalMs || 300000),
      chunkSize: Number(config.indexing?.chunkSize || 24)
    }
  };
}

module.exports = { loadConfig };
