import '../../styles/desktop-onboarding.css';
import { fetchJson, postJson } from '../../core/api.js';

const steps = {
  splash: document.querySelector('#splashStep'),
  config: document.querySelector('#configStep'),
  loader: document.querySelector('#loaderStep')
};
const authModeButtons = Array.from(document.querySelectorAll('[data-auth-mode]'));
const cloudAuthButton = document.querySelector('#cloudAuthButton');
const localOnlyButton = document.querySelector('#localOnlyButton');
const backToSplash = document.querySelector('#backToSplash');
const authStatus = document.querySelector('#authStatus');
const configStatus = document.querySelector('#configStatus');
const cloudConfigStatus = document.querySelector('#cloudConfigStatus');
const cloudEmail = document.querySelector('#cloudEmail');
const cloudPassword = document.querySelector('#cloudPassword');
const mediaFolders = document.querySelector('#mediaFolders');
const addMediaFolder = document.querySelector('#addMediaFolder');
const continueButton = document.querySelector('#continueButton');
const entryImportPath = document.querySelector('#entryImportPath');
const journalMirrorPath = document.querySelector('#journalMirrorPath');
const loaderMessage = document.querySelector('#loaderMessage');
const loaderStage = document.querySelector('#loaderStage');
const loaderStatus = document.querySelector('#loaderStatus');
const progressFill = document.querySelector('#progressFill');

const ENCOURAGEMENT = [
  'Mapping your life',
  'Going back in time',
  'Finding the quiet details',
  'Lining up the days',
  'Gathering the good stuff'
];

let authMode = 'login';
let cloudSignedIn = false;
let settings = {};
let messageIndex = 0;
let messageTimer = null;
const forceSplash = new URLSearchParams(window.location.search).has('force');

function showStep(name) {
  Object.entries(steps).forEach(([key, node]) => node.classList.toggle('hidden', key !== name));
}

function setAuthStatus(message) {
  authStatus.textContent = message;
  authStatus.classList.remove('is-error', 'is-success');
}

function setAuthError(message) {
  authStatus.textContent = message;
  authStatus.classList.add('is-error');
  authStatus.classList.remove('is-success');
}

function setAuthSuccess(message) {
  authStatus.textContent = message;
  authStatus.classList.add('is-success');
  authStatus.classList.remove('is-error');
}

function setCloudConfigStatus(message, state = '') {
  cloudConfigStatus.textContent = message;
  cloudConfigStatus.classList.toggle('is-error', state === 'error');
  cloudConfigStatus.classList.toggle('is-success', state === 'success');
}

function setConfigStatus(message) {
  configStatus.textContent = message;
}

function renderAuthMode() {
  authModeButtons.forEach((button) => {
    const active = button.dataset.authMode === authMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  cloudAuthButton.innerHTML = authMode === 'signup'
    ? '<i class="ph-bold ph-user-plus"></i><span>Sign up</span>'
    : '<i class="ph-bold ph-sign-in"></i><span>Log in</span>';
}

function baseCloudSettings() {
  return {
    ...settings,
    deviceName: settings.deviceName || 'Book of Life Desktop',
    libraryName: settings.libraryName || 'Book of Life'
  };
}

function folderRow(folder = {}) {
  const id = folder.id || `media-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const row = document.createElement('div');
  row.className = 'folder-row';
  row.dataset.folderId = id;
  row.innerHTML = `
    <input data-field="label" placeholder="Folder label" value="${escapeAttribute(folder.label || '')}" />
    <input data-field="path" placeholder="Choose a photo folder" readonly value="${escapeAttribute(folder.path || '')}" />
    <button class="icon-button" type="button" data-action="pick-folder" title="Choose folder"><i class="ph-bold ph-folder-open"></i></button>
    <button class="icon-button danger" type="button" data-action="remove-folder" title="Remove folder"><i class="ph-bold ph-trash"></i></button>
  `;
  return row;
}

function renderFolders() {
  mediaFolders.innerHTML = '';
  const folders = Array.isArray(settings.mediaFolders) ? settings.mediaFolders : [];
  folders.forEach((folder) => mediaFolders.appendChild(folderRow(folder)));
  if (!folders.length) mediaFolders.appendChild(folderRow());
}

function escapeAttribute(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function collectMediaFolders() {
  return Array.from(mediaFolders.querySelectorAll('.folder-row')).map((row) => ({
    id: row.dataset.folderId,
    label: row.querySelector('[data-field="label"]').value.trim(),
    path: row.querySelector('[data-field="path"]').value.trim(),
    enabled: true
  })).filter((folder) => folder.path);
}

function selectedRadio(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || '';
}

async function pickDirectory() {
  if (window.bookOfLifeDesktop?.pickDirectory) {
    const result = await window.bookOfLifeDesktop.pickDirectory();
    return result?.canceled ? '' : result?.path || '';
  }
  return window.prompt('Enter the folder path') || '';
}

async function loadStatus() {
  const payload = await fetchJson('/api/desktop/onboarding/status');
  settings = payload.settings || {};
  cloudSignedIn = Boolean(payload.cloud?.signedIn);
  if (payload.cloud?.configured) {
    setCloudConfigStatus('Book of Life Cloud is ready.', 'success');
    cloudAuthButton.disabled = false;
  } else {
    setCloudConfigStatus('This desktop build is missing its Book of Life Cloud configuration.', 'error');
    cloudAuthButton.disabled = true;
  }
  cloudEmail.value = settings.cloudSession?.email || '';
  journalMirrorPath.value = settings.localJournalMirrorPath || '';
  renderFolders();
  if (payload.complete && !forceSplash) {
    window.location.href = '/';
    return;
  }
  showStep('splash');
}

async function connectCloud() {
  const email = cloudEmail.value.trim();
  const password = cloudPassword.value;
  if (!email || !password) {
    setAuthError('Enter your email and password, or continue without logging in.');
    if (!email) cloudEmail.focus();
    else cloudPassword.focus();
    return;
  }
  cloudAuthButton.disabled = true;
  setAuthStatus(authMode === 'signup' ? 'Creating your cloud account...' : 'Signing in...');
  try {
    const endpoint = authMode === 'signup' ? '/api/desktop/cloud/signup' : '/api/desktop/cloud/connect';
    const payload = await postJson(endpoint, {
      settings: baseCloudSettings(),
      email,
      password
    });
    cloudPassword.value = '';
    settings = payload.settings || settings;
    cloudSignedIn = true;
    setAuthSuccess(`Connected as ${settings.cloudSession?.email || email}.`);
    showStep('config');
  } catch (error) {
    setAuthError(formatCloudAuthError(error));
  } finally {
    cloudAuthButton.disabled = false;
  }
}

function startLocalSetup() {
  cloudSignedIn = false;
  setAuthSuccess('Device-only setup selected. Nothing will be uploaded unless you connect later.');
  showStep('config');
}

function formatCloudAuthError(error) {
  const message = String(error?.message || '').trim();
  if (!message) return 'Could not connect to Book of Life Cloud.';
  if (/invalid login credentials/i.test(message)) return 'That email or password was not accepted.';
  if (/email not confirmed/i.test(message)) return 'Confirm that email address before signing in.';
  if (/fetch failed|network|enotfound|econnrefused|timeout/i.test(message)) {
    return 'Could not reach Book of Life Cloud. Check your internet connection and try again.';
  }
  if (/supabase/i.test(message)) return message.replace(/Supabase/g, 'Book of Life Cloud');
  return message;
}

async function completeOnboarding() {
  continueButton.disabled = true;
  const storageMode = selectedRadio('storageMode') || 'device-only';
  if (storageMode === 'cloud-originals' && !cloudSignedIn) {
    setConfigStatus('Sign in before storing originals in the cloud.');
    continueButton.disabled = false;
    return;
  }
  setConfigStatus('Saving setup...');
  try {
    await postJson('/api/desktop/onboarding/complete', {
      storageMode,
      entryImportMode: selectedRadio('entryMode') || 'none',
      mediaFolders: collectMediaFolders(),
      entryImportPath: entryImportPath.value.trim(),
      journalMirrorPath: journalMirrorPath.value.trim()
    });
    showLoader();
  } catch (error) {
    setConfigStatus(error.message);
    continueButton.disabled = false;
  }
}

function showLoader() {
  showStep('loader');
  messageIndex = 0;
  loaderMessage.textContent = ENCOURAGEMENT[messageIndex];
  clearInterval(messageTimer);
  messageTimer = setInterval(() => {
    messageIndex = (messageIndex + 1) % ENCOURAGEMENT.length;
    loaderMessage.textContent = ENCOURAGEMENT[messageIndex];
  }, 1800);
  pollIndexStatus();
}

async function pollIndexStatus() {
  try {
    const payload = await fetchJson('/api/desktop/index/status', { cache: 'no-store' });
    const status = payload.status || {};
    const percent = Math.max(0, Math.min(100, Number(status.percent || 0)));
    progressFill.style.width = `${percent}%`;
    loaderStage.textContent = status.stage || 'Indexing library';
    loaderStatus.textContent = status.error
      ? status.error
      : `${percent}% complete`;
    if (status.error) return;
    if (!status.running && (status.completedAt || percent >= 100)) {
      clearInterval(messageTimer);
      window.location.href = '/';
      return;
    }
  } catch (error) {
    loaderStatus.textContent = error.message;
  }
  setTimeout(pollIndexStatus, 700);
}

authModeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    authMode = button.dataset.authMode === 'signup' ? 'signup' : 'login';
    renderAuthMode();
  });
});

cloudAuthButton.addEventListener('click', connectCloud);
localOnlyButton.addEventListener('click', startLocalSetup);
backToSplash.addEventListener('click', () => showStep('splash'));
addMediaFolder.addEventListener('click', () => mediaFolders.appendChild(folderRow()));
continueButton.addEventListener('click', completeOnboarding);

document.addEventListener('click', async (event) => {
  const pickTarget = event.target.closest('[data-pick-target]');
  if (pickTarget) {
    const target = document.querySelector(`#${pickTarget.dataset.pickTarget}`);
    const folder = await pickDirectory();
    if (target && folder) target.value = folder;
    return;
  }

  const folderPick = event.target.closest('[data-action="pick-folder"]');
  if (folderPick) {
    const row = folderPick.closest('.folder-row');
    const folder = await pickDirectory();
    if (folder) {
      row.querySelector('[data-field="path"]').value = folder;
      const label = row.querySelector('[data-field="label"]');
      if (!label.value.trim()) label.value = folder.split(/[\\/]/).filter(Boolean).pop() || folder;
    }
    return;
  }

  const removeFolder = event.target.closest('[data-action="remove-folder"]');
  if (removeFolder) {
    removeFolder.closest('.folder-row')?.remove();
    if (!mediaFolders.querySelector('.folder-row')) mediaFolders.appendChild(folderRow());
  }
});

renderAuthMode();
loadStatus().catch((error) => {
  setCloudConfigStatus('Could not read desktop status.', 'error');
  setAuthError(error.message);
  showStep('splash');
});
