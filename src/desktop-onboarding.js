const fs = require('fs');
const path = require('path');
const { ENTRY_IMPORT_MODES, MEDIA_CLOUD_POLICIES, DESKTOP_STORAGE_MODES } = require('../shared/sync-contracts');
const {
  ensureDirSync,
  formatJournalFilename,
  parseJournalFilenameDate,
  walkFiles
} = require('./utils');

function enabledMediaFolders(settings = {}) {
  return Array.isArray(settings.mediaFolders)
    ? settings.mediaFolders.filter((folder) => folder && folder.enabled !== false && String(folder.path || '').trim())
    : [];
}

function hasOnboardingSource(settings = {}) {
  return Boolean(
    enabledMediaFolders(settings).length ||
    String(settings.localJournalMirrorPath || '').trim() ||
    String(settings.importedEntriesAt || '').trim()
  );
}

function isOnboardingComplete(settings = {}) {
  return Boolean(String(settings.onboardingCompletedAt || '').trim() && hasOnboardingSource(settings));
}

function desktopOnboardingStatus({ settings = {}, indexer = null, indexStatus = null, cloudStatus = null } = {}) {
  const mediaFolders = enabledMediaFolders(settings);
  const sourceCounts = {
    mediaFolders: mediaFolders.length,
    hasJournalMirror: Boolean(String(settings.localJournalMirrorPath || '').trim()),
    importedEntries: Boolean(String(settings.importedEntriesAt || '').trim()),
    indexedEntries: Number(indexer?.state?.dayKeys?.length || 0),
    indexedMedia: Number(indexer?.state?.photosById?.size || 0)
  };
  return {
    ok: true,
    desktop: true,
    complete: isOnboardingComplete(settings),
    sourceCounts,
    settings,
    cloud: cloudStatus || null,
    index: indexStatus || null
  };
}

function normalizeOnboardingMediaFolders(folders = [], storageMode = DESKTOP_STORAGE_MODES.DEVICE_ONLY) {
  if (!Array.isArray(folders)) return [];
  const cloudPolicy = storageMode === DESKTOP_STORAGE_MODES.CLOUD_ORIGINALS
    ? MEDIA_CLOUD_POLICIES.ALL_ORIGINALS
    : MEDIA_CLOUD_POLICIES.METADATA_ONLY;
  return folders
    .map((folder, index) => {
      const folderPath = String(folder?.path || '').trim();
      if (!folderPath) return null;
      return {
        id: String(folder?.id || `media-${Date.now()}-${index}`),
        label: String(folder?.label || '').trim() || path.basename(folderPath) || folderPath,
        path: folderPath,
        enabled: folder?.enabled !== false,
        cloudPolicy: folder?.cloudPolicy || cloudPolicy
      };
    })
    .filter(Boolean);
}

function entryImportModeFromPayload(payload = {}) {
  const mode = String(payload.entryImportMode || ENTRY_IMPORT_MODES.NONE);
  return Object.values(ENTRY_IMPORT_MODES).includes(mode) ? mode : ENTRY_IMPORT_MODES.NONE;
}

function resolveJournalImportDate(filePath) {
  const parsedFromName = parseJournalFilenameDate(path.basename(filePath));
  if (parsedFromName) return parsedFromName;
  const isoMatch = path.basename(filePath).match(/^(\d{4}-\d{2}-\d{2})\.md$/i);
  return isoMatch ? isoMatch[1] : '';
}

async function copyImportedEntries({ sourceDir, destinationJournalDir }) {
  const source = String(sourceDir || '').trim();
  const destination = String(destinationJournalDir || '').trim();
  if (!source) return { copied: 0, skipped: 0 };
  if (!destination) throw new Error('Journal import destination is not configured.');
  const sourceStat = await fs.promises.stat(source).catch(() => null);
  if (!sourceStat?.isDirectory()) throw new Error('Choose a folder that contains Markdown journal entries.');

  ensureDirSync(destination);
  const files = (await walkFiles(source)).filter((filePath) => path.extname(filePath).toLowerCase() === '.md');
  let copied = 0;
  let skipped = 0;

  for (const filePath of files) {
    const isoDate = resolveJournalImportDate(filePath);
    const targetName = isoDate ? formatJournalFilename(isoDate) : path.basename(filePath);
    if (!targetName) {
      skipped += 1;
      continue;
    }
    const targetPath = path.join(destination, targetName);
    if (path.resolve(filePath) === path.resolve(targetPath)) {
      skipped += 1;
      continue;
    }
    await fs.promises.copyFile(filePath, targetPath);
    copied += 1;
  }

  return { copied, skipped };
}

module.exports = {
  copyImportedEntries,
  desktopOnboardingStatus,
  enabledMediaFolders,
  entryImportModeFromPayload,
  hasOnboardingSource,
  isOnboardingComplete,
  normalizeOnboardingMediaFolders,
  resolveJournalImportDate
};
