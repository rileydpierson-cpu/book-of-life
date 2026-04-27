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
  const photoFolders = (
    process.env.LIFESERVER_PHOTO_FOLDERS
      ? splitPathList(process.env.LIFESERVER_PHOTO_FOLDERS)
      : (config.paths?.photoFolders || []).map((folder) => expandEnvString(folder))
  )
    .map((folder) => String(folder || '').trim())
    .filter(Boolean)
    .map((folder) => resolvePath(projectRoot, folder));
  const cacheDir = resolvePath(
    projectRoot,
    getConfigValue(config.paths?.cacheDir, 'LIFESERVER_CACHE_DIR', './.cache')
  );

  ensureDirSync(journalVault);
  ensureDirSync(path.join(journalVault, journalFolderName));
  ensureDirSync(path.join(journalVault, journalImagesFolderName));
  for (const folder of photoFolders) ensureDirSync(folder);
  ensureDirSync(cacheDir);
  ensureDirSync(path.join(cacheDir, 'thumbs'));
  ensureDirSync(path.join(cacheDir, 'converted'));

  return {
    server: {
      port: Number(config.server?.port || 3000)
    },
    auth: {
      enabled: Boolean(config.auth?.enabled),
      accessSecret: String(config.auth?.accessSecret || ''),
      sessionDays: Math.max(1, Number(config.auth?.sessionDays || 30)),
      secureCookie: Boolean(config.auth?.secureCookie)
    },
    paths: {
      journalVault,
      journalFolderName,
      journalImagesFolderName,
      photoFolders,
      cacheDir
    },
    indexing: {
      rebuildIntervalMs: Number(config.indexing?.rebuildIntervalMs || 300000),
      chunkSize: Number(config.indexing?.chunkSize || 24)
    }
  };
}

module.exports = { loadConfig };
