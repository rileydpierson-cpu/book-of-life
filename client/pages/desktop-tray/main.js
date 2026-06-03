import '../../styles/desktop-tray.css';
import { fetchJson, postJson } from '../../core/api.js';

const accountLine = document.querySelector('#accountLine');
const loginStatus = document.querySelector('#loginStatus');
const indexStatus = document.querySelector('#indexStatus');
const indexProgress = document.querySelector('#indexProgress');
const syncStatus = document.querySelector('#syncStatus');
const storageStatus = document.querySelector('#storageStatus');
const storageProgress = document.querySelector('#storageProgress');
const trayError = document.querySelector('#trayError');
const openLibrary = document.querySelector('#openLibrary');
const openOnboarding = document.querySelector('#openOnboarding');
const syncNow = document.querySelector('#syncNow');
const quitApp = document.querySelector('#quitApp');

let pollTimer = null;

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes || 0));
  const mb = value / (1024 * 1024);
  if (mb < 10) return `${mb.toFixed(1)} MB`;
  return `${Math.round(mb)} MB`;
}

function formatTime(value) {
  if (!value) return 'Not synced yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not synced yet';
  return `Last sync ${date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

function setProgress(node, percent) {
  node.style.width = `${Math.max(0, Math.min(100, Number(percent || 0)))}%`;
}

function renderStatus(payload) {
  const cloud = payload.cloud || {};
  const index = payload.index || {};
  const storage = payload.storage || {};
  trayError.textContent = cloud.error || '';

  accountLine.textContent = cloud.signedIn ? cloud.email || 'Signed in' : 'Local only';
  loginStatus.textContent = cloud.signedIn ? `Signed in${cloud.email ? ` as ${cloud.email}` : ''}` : 'Not signed in';

  const indexPercent = Math.max(0, Math.min(100, Number(index.percent || 0)));
  indexStatus.textContent = index.error
    ? index.error
    : index.running
      ? `${index.stage || 'Indexing'} (${indexPercent}%)`
      : 'Idle';
  setProgress(indexProgress, index.running ? indexPercent : 100);

  syncStatus.textContent = cloud.signedIn ? formatTime(cloud.lastCloudSyncAt) : 'Sign in to sync';
  syncNow.disabled = !cloud.signedIn;

  if (!cloud.signedIn || storage.available === false) {
    storageStatus.textContent = cloud.signedIn ? 'Unavailable' : 'Sign in for cloud storage';
    setProgress(storageProgress, 0);
  } else {
    storageStatus.textContent = `${formatBytes(storage.usedBytes)} of 1 GB`;
    setProgress(storageProgress, storage.percent);
  }
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

syncNow.addEventListener('click', async () => {
  try {
    syncNow.disabled = true;
    syncStatus.textContent = 'Syncing...';
    await postJson('/api/desktop/cloud/sync', {});
    await refreshStatus();
  } catch (error) {
    trayError.textContent = error.message;
  } finally {
    refreshStatus().catch(() => {});
  }
});

refreshStatus();
