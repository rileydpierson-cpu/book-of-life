const fs = require('fs');
const path = require('path');
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

  return splitPathList(trimmed);
}

function parseBoolean(value, fallbackValue = false) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallbackValue;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallbackValue;
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

  return {
    server: {
      port: Number(config.server?.port || 3000)
    },
    auth: {
      enabled: parseBoolean(getConfigValue(config.auth?.enabled, 'LIFESERVER_AUTH_ENABLED'), false),
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
