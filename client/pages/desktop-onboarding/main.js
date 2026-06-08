import '../../styles/desktop-onboarding.css';
import { fetchJson, postJson } from '../../core/api.js';

const panelTrack = document.querySelector('#panelTrack');
const minimizeWindow = document.querySelector('#minimizeWindow');
const closeWindow = document.querySelector('#closeWindow');
const authForm = document.querySelector('#authForm');
const cloudName = document.querySelector('#cloudName');
const cloudEmail = document.querySelector('#cloudEmail');
const cloudPassword = document.querySelector('#cloudPassword');
const confirmPassword = document.querySelector('#confirmPassword');
const nameField = document.querySelector('#nameField');
const confirmField = document.querySelector('#confirmField');
const cloudAuthButton = document.querySelector('#cloudAuthButton');
const toggleAuthMode = document.querySelector('#toggleAuthMode');
const localOnlyButton = document.querySelector('#localOnlyButton');
const authStatus = document.querySelector('#authStatus');
const actionEyebrow = document.querySelector('#actionEyebrow');
const actionTitle = document.querySelector('#actionTitle');
const actionStatus = document.querySelector('#actionStatus');
const cloudConfigStatus = document.querySelector('#cloudConfigStatus');
const mediaFolders = document.querySelector('#mediaFolders');
const addMediaFolder = document.querySelector('#addMediaFolder');
const foldersNextButton = document.querySelector('#foldersNextButton');
const foldersStatus = document.querySelector('#foldersStatus');
const notesPath = document.querySelector('#notesPath');
const pickNotesFolder = document.querySelector('#pickNotesFolder');
const entryModeButtons = Array.from(document.querySelectorAll('[data-entry-mode]'));
const skipNotesButton = document.querySelector('#skipNotesButton');
const completeButton = document.querySelector('#completeButton');
const configStatus = document.querySelector('#configStatus');
const loaderMessage = document.querySelector('#loaderMessage');
const loaderStage = document.querySelector('#loaderStage');
const loaderStatus = document.querySelector('#loaderStatus');
const progressFill = document.querySelector('#progressFill');
const openLibraryButton = document.querySelector('#openLibraryButton');
const folderDialog = document.querySelector('#folderDialog');
const folderLabelInput = document.querySelector('#folderLabelInput');
const folderPathInput = document.querySelector('#folderPathInput');
const folderPolicyInput = document.querySelector('#folderPolicyInput');
const changeFolderPath = document.querySelector('#changeFolderPath');
const cancelFolderEdit = document.querySelector('#cancelFolderEdit');
const saveFolderEdit = document.querySelector('#saveFolderEdit');

const PANEL_INDEX = {
  auth: 0,
  action: 1,
  folders: 2,
  notes: 3,
  progress: 4
};

const ENCOURAGEMENT = [
  'Mapping your life',
  'Going back in time',
  'Finding the quiet details',
  'Lining up the days',
  'Gathering the good stuff'
];

const forceSplash = new URLSearchParams(window.location.search).has('force');

let authMode = 'login';
let cloudSignedIn = false;
let skippedLogin = false;
let settings = {};
let folders = [];
let entryMode = 'copy';
let editingFolderId = '';
let messageIndex = 0;
let messageTimer = null;
let progressTimer = null;
let mobileMode = false;

function showPanel(name) {
  panelTrack.dataset.panel = name;
  panelTrack.style.transform = `translateX(-${PANEL_INDEX[name] * 100}%)`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setAuthMessage(message, type = '') {
  authStatus.textContent = message || '';
  authStatus.classList.toggle('is-error', type === 'error');
  authStatus.classList.toggle('is-success', type === 'success');
}

function setCloudConfigStatus(message, state = '') {
  if (!cloudConfigStatus) return;
  cloudConfigStatus.textContent = message;
  cloudConfigStatus.classList.toggle('is-error', state === 'error');
  cloudConfigStatus.classList.toggle('is-success', state === 'success');
}

function renderAuthMode() {
  const signup = authMode === 'signup';
  nameField.classList.toggle('hidden', !signup);
  confirmField.classList.toggle('hidden', !signup);
  cloudPassword.setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
  cloudAuthButton.innerHTML = signup
    ? '<i class="ph-bold ph-user-plus"></i><span>Sign up</span>'
    : '<i class="ph-bold ph-sign-in"></i><span>Log in</span>';
  toggleAuthMode.textContent = signup ? 'Log in' : 'Sign up';
}

function baseCloudSettings() {
  return {
    ...settings,
    deviceName: cloudName.value.trim() || settings.deviceName || 'Book of Life Desktop',
    libraryName: settings.libraryName || 'Book of Life'
  };
}

function folderPolicyLabel(policy) {
  if (policy === 'all-originals') return 'Cloud originals';
  return 'This device';
}

function folderStatusIcon(folder) {
  if (skippedLogin || !cloudSignedIn) return '';
  if (folder.cloudPolicy === 'all-originals') return '<span class="folder-status-icon"><i class="ph-fill ph-cloud"></i></span>';
  return '<span class="folder-status-icon"><i class="ph-fill ph-hard-drives"></i></span>';
}

function createFolder(pathValue = '', overrides = {}) {
  const label = overrides.label || pathValue.split(/[\\/]/).filter(Boolean).pop() || pathValue || 'Media folder';
  return {
    id: overrides.id || `media-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label,
    path: pathValue,
    enabled: overrides.enabled !== false,
    cloudPolicy: overrides.cloudPolicy || (cloudSignedIn ? 'metadata-only' : 'metadata-only')
  };
}

function renderFolders() {
  mediaFolders.innerHTML = '';
  if (!folders.length) {
    mediaFolders.innerHTML = '<p class="empty-state">No media folders selected.</p>';
    return;
  }
  for (const folder of folders) {
    const row = document.createElement('button');
    row.className = 'folder-row';
    row.type = 'button';
    row.dataset.folderId = folder.id;
    row.innerHTML = `
      <span class="folder-icon-wrap"><i class="ph-duotone ph-folder-open"></i>${folderStatusIcon(folder)}</span>
      <span class="folder-copy">
        <strong>${escapeHtml(folder.label || 'Media folder')}</strong>
        <small>${escapeHtml(folder.path || 'Choose a folder')}</small>
      </span>
      <span class="folder-policy">${escapeHtml(folderPolicyLabel(folder.cloudPolicy))}</span>
      <span class="folder-delete" role="button" tabindex="0" data-action="remove-folder" title="Remove folder"><i class="ph-bold ph-trash"></i></span>
    `;
    mediaFolders.appendChild(row);
  }
}

function collectMediaFolders() {
  return folders
    .filter((folder) => folder.path)
    .map((folder) => ({
      id: folder.id,
      label: folder.label,
      path: folder.path,
      enabled: folder.enabled !== false,
      cloudPolicy: cloudSignedIn ? folder.cloudPolicy : 'metadata-only'
    }));
}

function renderPolicyOptions() {
  const cloudDisabled = !cloudSignedIn;
  folderPolicyInput.innerHTML = `
    <option value="metadata-only">Only on this device</option>
    <option value="all-originals" ${cloudDisabled ? 'disabled' : ''}>Synced to cloud</option>
  `;
}

function openFolderEditor(folderId) {
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) return;
  editingFolderId = folder.id;
  renderPolicyOptions();
  folderLabelInput.value = folder.label || '';
  folderPathInput.value = folder.path || '';
  folderPolicyInput.value = cloudSignedIn && folder.cloudPolicy === 'all-originals' ? 'all-originals' : 'metadata-only';
  folderDialog.showModal();
}

function saveFolderEditor() {
  const folder = folders.find((item) => item.id === editingFolderId);
  if (!folder) return;
  folder.label = folderLabelInput.value.trim() || folderPathInput.value.split(/[\\/]/).filter(Boolean).pop() || folderPathInput.value || 'Media folder';
  folder.path = folderPathInput.value.trim();
  folder.cloudPolicy = cloudSignedIn ? folderPolicyInput.value : 'metadata-only';
  renderFolders();
  folderDialog.close();
}

function renderEntryMode() {
  entryModeButtons.forEach((button) => {
    const active = button.dataset.entryMode === entryMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-checked', active ? 'true' : 'false');
  });
  completeButton.textContent = entryMode === 'mirror' ? 'Link' : 'Import';
}

async function pickDirectory() {
  if (window.bookOfLifeDesktop?.pickDirectory) {
    const result = await window.bookOfLifeDesktop.pickDirectory();
    return result?.canceled ? '' : result?.path || '';
  }
  return window.prompt('Enter the folder path') || '';
}

async function openLibrary() {
  if (window.bookOfLifeDesktop?.openLibrary) {
    await window.bookOfLifeDesktop.openLibrary();
    return;
  }
  window.location.href = '/';
}

function startMessageCycle() {
  messageIndex = 0;
  loaderMessage.textContent = ENCOURAGEMENT[messageIndex];
  clearInterval(messageTimer);
  messageTimer = setInterval(() => {
    messageIndex = (messageIndex + 1) % ENCOURAGEMENT.length;
    loaderMessage.textContent = ENCOURAGEMENT[messageIndex];
  }, 1800);
}

function stopMessageCycle() {
  clearInterval(messageTimer);
  messageTimer = null;
}

async function pollIndexStatus({ allowOpen = false, simple = false } = {}) {
  clearTimeout(progressTimer);
  try {
    const payload = await fetchJson('/api/desktop/index/status', { cache: 'no-store' });
    const status = payload.status || {};
    const percent = Math.max(0, Math.min(100, Number(status.percent || 0)));
    progressFill.style.width = `${percent}%`;
    if (simple) {
      loaderStage.textContent = 'Getting things ready for you';
      loaderStatus.textContent = status.error
        ? status.error
        : status.running
          ? 'Refreshing your library in the background.'
          : 'Your library is ready.';
    } else {
      loaderStage.textContent = status.stage || 'Indexing library';
      loaderStatus.textContent = status.error
        ? status.error
        : status.running
          ? `${percent}% complete. You can open the app while this continues.`
          : 'Your library is ready.';
    }
    openLibraryButton.classList.toggle('hidden', !allowOpen);
    if (status.error) return;
    if (status.running) {
      progressTimer = setTimeout(() => pollIndexStatus({ allowOpen, simple }), 900);
      return;
    }
    stopMessageCycle();
  } catch (error) {
    loaderStatus.textContent = error.message;
  }
}

async function loadStatus() {
  const payload = await fetchJson('/api/desktop/onboarding/status');
  mobileMode = payload.mode === 'android-local';
  settings = payload.settings || {};
  cloudSignedIn = Boolean(payload.cloud?.signedIn);
  skippedLogin = !cloudSignedIn;
  cloudEmail.value = settings.cloudSession?.email || '';
  folders = Array.isArray(settings.mediaFolders)
    ? settings.mediaFolders.map((folder) => createFolder(folder.path, folder))
    : [];
  renderFolders();
  if (payload.cloud?.configured) {
    setCloudConfigStatus('Book of Life Cloud is ready.', 'success');
    cloudAuthButton.disabled = false;
  } else {
    setCloudConfigStatus('Cloud sign in is unavailable in this build. Local setup still works.', 'error');
    cloudAuthButton.disabled = true;
  }
  if (payload.complete && !forceSplash) {
    if (payload.index?.running) {
      showPanel('progress');
      stopMessageCycle();
      loaderMessage.textContent = 'Getting things ready for you';
      await pollIndexStatus({ allowOpen: true, simple: true });
    } else {
      await openLibrary();
    }
    return;
  }
  showPanel('auth');
}

async function connectCloud() {
  const email = cloudEmail.value.trim();
  const password = cloudPassword.value;
  if (!email || !password) {
    setAuthMessage('Enter your email and password, or continue without login.', 'error');
    (email ? cloudPassword : cloudEmail).focus();
    return;
  }
  if (authMode === 'signup' && password !== confirmPassword.value) {
    setAuthMessage('Passwords do not match.', 'error');
    confirmPassword.focus();
    return;
  }
  setAuthMessage('');
  cloudAuthButton.disabled = true;
  actionEyebrow.textContent = authMode === 'signup' ? 'Creating account' : 'Connecting';
  actionTitle.textContent = authMode === 'signup' ? 'Creating your account' : 'Signing in';
  actionStatus.textContent = 'Securing your library connection.';
  showPanel('action');
  try {
    const endpoint = authMode === 'signup' ? '/api/desktop/cloud/signup' : '/api/desktop/cloud/connect';
    const payload = await postJson(endpoint, {
      settings: baseCloudSettings(),
      email,
      password
    });
    settings = payload.settings || settings;
    cloudSignedIn = true;
    skippedLogin = false;
    cloudPassword.value = '';
    confirmPassword.value = '';
    folders = folders.map((folder) => ({
      ...folder,
      cloudPolicy: folder.cloudPolicy || 'metadata-only'
    }));
    renderFolders();
    if (mobileMode) {
      actionStatus.textContent = 'Connected. Opening your mobile library.';
      setTimeout(() => openLibrary(), 420);
      return;
    }
    actionStatus.textContent = 'Connected. Choose the folders to watch next.';
    setTimeout(() => showPanel('folders'), 420);
  } catch (error) {
    setAuthMessage(formatCloudAuthError(error), 'error');
    showPanel('auth');
  } finally {
    cloudAuthButton.disabled = false;
  }
}

async function startLocalSetup() {
  cloudSignedIn = false;
  skippedLogin = true;
  if (mobileMode) {
    localOnlyButton.disabled = true;
    try {
      await postJson('/api/mobile/use-local', {});
      await openLibrary();
    } catch (error) {
      setAuthMessage(error.message || 'Could not start local mode.', 'error');
      localOnlyButton.disabled = false;
    }
    return;
  }
  folders = folders.map((folder) => ({ ...folder, cloudPolicy: 'metadata-only' }));
  renderFolders();
  setAuthMessage('Continuing locally. Nothing will upload unless you connect later.', 'success');
  showPanel('folders');
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

function proceedToNotes() {
  foldersStatus.textContent = folders.length
    ? 'Folders saved for setup.'
    : 'You can add folders later from settings.';
  showPanel('notes');
}

async function completeOnboarding(selectedEntryMode = entryMode) {
  const pathValue = notesPath.value.trim();
  const entryImportMode = selectedEntryMode === 'none' || !pathValue ? 'none' : selectedEntryMode;
  if (selectedEntryMode !== 'none' && !pathValue) {
    configStatus.textContent = 'Choose a notes folder or skip this step.';
    notesPath.focus();
    return;
  }

  completeButton.disabled = true;
  skipNotesButton.disabled = true;
  showPanel('progress');
  startMessageCycle();
  progressFill.style.width = '8%';
  loaderStage.textContent = entryImportMode === 'mirror'
    ? 'Linking notes'
    : entryImportMode === 'copy'
      ? 'Importing notes'
      : 'Saving setup';
  loaderStatus.textContent = 'Saving your desktop setup.';

  try {
    await postJson('/api/desktop/onboarding/complete', {
      storageMode: collectMediaFolders().some((folder) => folder.cloudPolicy === 'all-originals') ? 'cloud-originals' : 'device-only',
      entryImportMode,
      mediaFolders: collectMediaFolders(),
      entryImportPath: entryImportMode === 'copy' ? pathValue : '',
      journalMirrorPath: entryImportMode === 'mirror' ? pathValue : ''
    });
    loaderStatus.textContent = 'Opening Book of Life. Indexing will continue in the background.';
    progressFill.style.width = '100%';
    stopMessageCycle();
    setTimeout(() => openLibrary(), 550);
  } catch (error) {
    stopMessageCycle();
    configStatus.textContent = error.message;
    showPanel('notes');
  } finally {
    completeButton.disabled = false;
    skipNotesButton.disabled = false;
  }
}

minimizeWindow.addEventListener('click', () => window.bookOfLifeDesktop?.minimizeWindow?.());
closeWindow.addEventListener('click', () => window.bookOfLifeDesktop?.closeWindow?.());
openLibraryButton.addEventListener('click', openLibrary);

toggleAuthMode.addEventListener('click', () => {
  authMode = authMode === 'login' ? 'signup' : 'login';
  setAuthMessage('');
  renderAuthMode();
});

authForm.addEventListener('submit', (event) => {
  event.preventDefault();
  connectCloud();
});

localOnlyButton.addEventListener('click', startLocalSetup);

addMediaFolder.addEventListener('click', async () => {
  const folderPath = await pickDirectory();
  if (!folderPath) return;
  const folder = createFolder(folderPath);
  folders = [...folders, folder];
  renderFolders();
  openFolderEditor(folder.id);
});

foldersNextButton.addEventListener('click', proceedToNotes);

mediaFolders.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-action="remove-folder"]');
  if (removeButton) {
    event.stopPropagation();
    const row = removeButton.closest('.folder-row');
    folders = folders.filter((folder) => folder.id !== row?.dataset.folderId);
    renderFolders();
    return;
  }
  const row = event.target.closest('.folder-row');
  if (row) openFolderEditor(row.dataset.folderId);
});

pickNotesFolder.addEventListener('click', async () => {
  const folder = await pickDirectory();
  if (folder) notesPath.value = folder;
});

entryModeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    entryMode = button.dataset.entryMode === 'mirror' ? 'mirror' : 'copy';
    renderEntryMode();
  });
});

skipNotesButton.addEventListener('click', () => completeOnboarding('none'));
completeButton.addEventListener('click', () => completeOnboarding(entryMode));

changeFolderPath.addEventListener('click', async () => {
  const folder = await pickDirectory();
  if (folder) folderPathInput.value = folder;
});

cancelFolderEdit.addEventListener('click', () => folderDialog.close());
saveFolderEdit.addEventListener('click', saveFolderEditor);

renderAuthMode();
renderEntryMode();
loadStatus().catch((error) => {
  setCloudConfigStatus('Could not read desktop status.', 'error');
  setAuthMessage(error.message, 'error');
  showPanel('auth');
});
