import '../../styles/desktop-tray.css';
import { fetchJson, postJson } from '../../core/api.js';

const accountLine = document.querySelector('#accountLine');
const loginStatus = document.querySelector('#loginStatus');
const indexCard = document.querySelector('#indexCard');
const indexStatus = document.querySelector('#indexStatus');
const indexProgress = document.querySelector('#indexProgress');
const thumbnailCard = document.querySelector('#thumbnailCard');
const thumbnailStatus = document.querySelector('#thumbnailStatus');
const thumbnailProgress = document.querySelector('#thumbnailProgress');
const syncStatus = document.querySelector('#syncStatus');
const syncProgress = document.querySelector('#syncProgress');
const syncProgressFill = syncProgress?.querySelector('span');
const storageStatus = document.querySelector('#storageStatus');
const storageProgress = document.querySelector('#storageProgress');
const backupRequestCard = document.querySelector('#backupRequestCard');
const backupRequestStatus = document.querySelector('#backupRequestStatus');
const mediaAvailabilityCard = document.querySelector('#mediaAvailabilityCard');
const mediaAvailabilityStatus = document.querySelector('#mediaAvailabilityStatus');
const journalMirrorCard = document.querySelector('#journalMirrorCard');
const journalMirrorStatus = document.querySelector('#journalMirrorStatus');
const trayError = document.querySelector('#trayError');
const openLibrary = document.querySelector('#openLibrary');
const openOnboarding = document.querySelector('#openOnboarding');
const syncNow = document.querySelector('#syncNow');
const quitApp = document.querySelector('#quitApp');
const closeTray = document.querySelector('#closeTray');

let pollTimer = null;
let lastPayload = null;

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes || 0));
  const mb = value / (1024 * 1024);
  if (mb < 10) return `${mb.toFixed(1)} MB`;
  return `${Math.round(mb)} MB`;
}

function formatTime(value) {
  if (!value) return 'Preparing sync';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Preparing sync';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 45) return 'Synced just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Synced ${days} day${days === 1 ? '' : 's'} ago`;
  return `Synced ${date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

function setProgress(node, percent) {
  node.style.width = `${Math.max(0, Math.min(100, Number(percent || 0)))}%`;
}

function journalMirrorLabel(journalMirror = {}) {
  if (!journalMirror.configured) return 'Not configured';
  if (journalMirror.syncing || journalMirror.status === 'syncing') return 'Syncing journal mirror';
  if (journalMirror.status === 'conflict' || Number(journalMirror.conflictCount || 0) > 0) return 'Journal mirror has conflicts';
  if (journalMirror.available === false || journalMirror.status === 'unavailable') return 'Journal mirror unavailable. Using local backup';
  return 'Journal mirror synced';
}

function renderStatus(payload) {
  lastPayload = payload;
  const cloud = payload.cloud || {};
  const index = payload.index || {};
  const thumbnails = payload.thumbnails || {};
  const sync = payload.sync || {};
  const storage = payload.storage || {};
  const backups = payload.backups || {};
  const mediaAvailability = payload.mediaAvailability || {};
  const journalMirror = payload.journalMirror || {};
  trayError.textContent = cloud.error || '';

  accountLine.textContent = cloud.signedIn ? cloud.email || 'Signed in' : 'Local only';
  loginStatus.textContent = cloud.signedIn ? `Signed in${cloud.email ? ` as ${cloud.email}` : ''}` : 'Not signed in';

  const indexPercent = Math.max(0, Math.min(100, Number(index.percent || 0)));
  indexCard.classList.toggle('hidden', !index.running && !index.error);
  indexStatus.textContent = index.error
    ? index.error
    : index.running
      ? `${index.stage || 'Indexing'} (${indexPercent}%)`
      : 'Idle';
  setProgress(indexProgress, index.running ? indexPercent : 100);

  const thumbnailPercent = Math.max(0, Math.min(100, Number(thumbnails.percent || 0)));
  thumbnailCard?.classList.toggle('hidden', !thumbnails.running && !thumbnails.queued && !thumbnails.error);
  if (thumbnailStatus) {
    thumbnailStatus.textContent = thumbnails.error && !thumbnails.running
      ? thumbnails.error
      : thumbnails.running || thumbnails.queued
        ? `Generating thumbnails (${thumbnailPercent}%)`
        : 'Idle';
  }
  if (thumbnailProgress) setProgress(thumbnailProgress, thumbnails.running ? thumbnailPercent : 100);

  if (!cloud.signedIn) {
    syncStatus.textContent = 'Sign in to sync';
    syncProgress.classList.add('hidden');
  } else if (sync.running) {
    const total = Math.max(0, Number(sync.total || 0));
    const percent = Math.max(0, Math.min(100, Number(sync.percent || 0)));
    syncStatus.textContent = sync.message || (sync.phase && String(sync.phase).startsWith('delta') ? 'Checking for changes...' : 'Syncing...');
    if (sync.queued && !sync.message) syncStatus.textContent = 'Syncing... another sync queued';
    syncProgress.classList.remove('hidden');
    syncProgress.classList.toggle('is-indeterminate', !total);
    if (syncProgressFill) syncProgressFill.style.width = total ? `${percent}%` : '';
  } else if (sync.error) {
    syncStatus.textContent = sync.error;
    syncProgress.classList.add('hidden');
  } else {
    syncStatus.textContent = formatTime(sync.lastSyncedAt || cloud.lastCloudSyncAt);
    syncProgress.classList.add('hidden');
  }
  syncNow.disabled = !cloud.signedIn || Boolean(sync.running);

  if (!cloud.signedIn || storage.available === false) {
    storageStatus.textContent = cloud.signedIn ? 'Unavailable' : 'Sign in for cloud storage';
    setProgress(storageProgress, 0);
  } else {
    storageStatus.textContent = `${formatBytes(storage.usedBytes)} of 1 GB`;
    setProgress(storageProgress, storage.percent);
  }

  const pendingBackupRequests = Math.max(0, Number(backups.pendingRequests || 0));
  backupRequestCard?.classList.toggle('hidden', !pendingBackupRequests);
  if (backupRequestStatus) {
    backupRequestStatus.textContent = `${pendingBackupRequests} phone backup request${pendingBackupRequests === 1 ? '' : 's'} awaiting confirmation`;
  }

  const warningCount = Math.max(0, Number(mediaAvailability.warningCount || 0));
  mediaAvailabilityCard?.classList.toggle('hidden', !warningCount);
  if (mediaAvailabilityStatus) {
    mediaAvailabilityStatus.textContent = warningCount
      ? `${warningCount} media original${warningCount === 1 ? '' : 's'} need attention`
      : 'All originals available';
  }

  journalMirrorCard?.classList.toggle('hidden', !journalMirror.configured);
  if (journalMirrorStatus) journalMirrorStatus.textContent = journalMirrorLabel(journalMirror);
}

async function refreshStatus() {
  clearTimeout(pollTimer);
  try {
    const payload = await fetchJson('/api/desktop/tray/status', { cache: 'no-store' });
    renderStatus(payload);
  } catch (error) {
    trayError.textContent = error.message;
  }
  pollTimer = setTimeout(refreshStatus, 2000);
}

openLibrary.addEventListener('click', () => window.bookOfLifeDesktop?.openLibrary?.());
openOnboarding.addEventListener('click', () => window.bookOfLifeDesktop?.openOnboarding?.());
quitApp.addEventListener('click', () => window.bookOfLifeDesktop?.quitApp?.());
closeTray.addEventListener('click', () => window.bookOfLifeDesktop?.closeWindow?.());

syncNow.addEventListener('click', async () => {
  try {
    syncNow.disabled = true;
    syncStatus.textContent = 'Syncing...';
    syncProgress.classList.remove('hidden');
    const result = await postJson('/api/desktop/cloud/sync', {});
    renderStatus({
      ...(lastPayload || {}),
      cloud: {
        ...((lastPayload || {}).cloud || {}),
        ...(result.status || {})
      },
      sync: result.sync || {
        running: false,
        queued: Boolean(result.queued),
        lastSyncedAt: result.syncedAt || result.status?.lastCloudSyncAt || ''
      }
    });
  } catch (error) {
    trayError.textContent = error.message;
  } finally {
    refreshStatus().catch(() => {});
  }
});

window.bookOfLifeDesktop?.onTrayStatusSnapshot?.((payload) => {
  if (payload?.ok) {
    renderStatus(payload);
  } else if (payload?.error) {
    trayError.textContent = payload.error;
  }
});

window.bookOfLifeDesktop?.getTrayStatusSnapshot?.()
  .then((payload) => {
    if (payload?.ok) {
      renderStatus(payload);
    } else if (payload?.error) {
      trayError.textContent = payload.error;
    }
  })
  .catch(() => {});

refreshStatus();
