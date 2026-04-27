const fs = require('fs');
const path = require('path');
const { ensureDirSync } = require('./utils');

function loadConfig(projectRoot) {
  const configPath = path.join(projectRoot, 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Missing config.json. Copy config.example.json to config.json and update the folder paths.');
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw);

  const cacheDir = path.resolve(projectRoot, config.paths?.cacheDir || './.cache');
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
      journalVault: path.resolve(config.paths?.journalVault || ''),
      journalFolderName: config.paths?.journalFolderName || 'Journal',
      journalImagesFolderName: config.paths?.journalImagesFolderName || 'Images',
      photoFolders: (config.paths?.photoFolders || []).map((folder) => path.resolve(folder)),
      cacheDir
    },
    indexing: {
      rebuildIntervalMs: Number(config.indexing?.rebuildIntervalMs || 300000),
      chunkSize: Number(config.indexing?.chunkSize || 24)
    }
  };
}

module.exports = { loadConfig };
