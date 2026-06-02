import '../../styles/desktop-settings.css';
import { fetchJson, postJson } from '../../core/api.js';

const form = document.querySelector('#settings-form');
const saveButton = document.querySelector('#save-settings');
const addFolderButton = document.querySelector('#add-folder');
const folderList = document.querySelector('#media-folders');
const statusLine = document.querySelector('#settings-status');
const cloudStatusLine = document.querySelector('#cloud-status');
const connectCloudButton = document.querySelector('#connect-cloud');
const syncCloudButton = document.querySelector('#sync-cloud');
const cloudEmailInput = document.querySelector('#cloud-email');
const cloudPasswordInput = document.querySelector('#cloud-password');

let settings = null;

function setStatus(message) {
  statusLine.textContent = message;
}

function setCloudStatus(message) {
  cloudStatusLine.textContent = message;
}

function folderTemplate(folder = {}) {
  return {
    id: folder.id || `folder-${Date.now()}`,
    label: folder.label || '',
    path: folder.path || '',
    enabled: folder.enabled !== false,
    cloudPolicy: folder.cloudPolicy || 'derivatives'
  };
}

function renderFolders() {
  folderList.innerHTML = '';
  for (const folder of settings.mediaFolders || []) {
    const row = document.createElement('div');
    row.className = 'folder-row';
    row.dataset.folderId = folder.id;
    row.innerHTML = `
      <label>
        Label
        <input data-field="label" value="${escapeAttribute(folder.label)}" />
      </label>
      <label>
        Folder Path
        <input data-field="path" value="${escapeAttribute(folder.path)}" />
      </label>
      <label>
        Cloud Policy
        <select data-field="cloudPolicy">
          <option value="metadata-only">Metadata only</option>
          <option value="derivatives">Thumbnails/previews</option>
          <option value="selected-originals">Selected originals</option>
          <option value="all-originals">All originals</option>
        </select>
      </label>
      <label class="inline-check">
        <input data-field="enabled" type="checkbox" ${folder.enabled !== false ? 'checked' : ''} />
        Enabled
      </label>
      <button data-action="remove" type="button">Remove</button>
    `;
    row.querySelector('[data-field="cloudPolicy"]').value = folder.cloudPolicy || 'derivatives';
    folderList.appendChild(row);
  }
}

function escapeAttribute(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function hydrateForm(nextSettings) {
  settings = nextSettings;
  for (const element of form.elements) {
    if (!element.name) continue;
    element.value = settings[element.name] || '';
  }
  renderFolders();
  if (settings.cloudSession?.email) cloudEmailInput.value = settings.cloudSession.email;
}

function collectSettings() {
  const next = { ...settings };
  for (const element of form.elements) {
    if (!element.name) continue;
    next[element.name] = element.value.trim();
  }
  next.mediaFolders = Array.from(folderList.querySelectorAll('.folder-row')).map((row) => {
    const existing = settings.mediaFolders.find((folder) => folder.id === row.dataset.folderId) || {};
    return folderTemplate({
      ...existing,
      label: row.querySelector('[data-field="label"]').value.trim(),
      path: row.querySelector('[data-field="path"]').value.trim(),
      cloudPolicy: row.querySelector('[data-field="cloudPolicy"]').value,
      enabled: row.querySelector('[data-field="enabled"]').checked
    });
  });
  return next;
}

async function loadSettings() {
  const [payload, cloudStatus] = await Promise.all([
    fetchJson('/api/desktop/sync-settings'),
    fetchJson('/api/desktop/cloud/status').catch((error) => ({ error: error.message }))
  ]);
  hydrateForm(payload.settings);
  setStatus('Settings loaded.');
  renderCloudStatus(cloudStatus);
}

function renderCloudStatus(status) {
  if (status?.error) {
    setCloudStatus(status.error);
    return;
  }
  if (!status?.configured) {
    setCloudStatus('Book of Life Cloud is not configured for this desktop build.');
    return;
  }
  if (!status?.signedIn) {
    setCloudStatus('Sign in to connect this desktop to your Book of Life Cloud library.');
    return;
  }
  const synced = status.lastCloudSyncAt ? ` Last sync ${new Date(status.lastCloudSyncAt).toLocaleString()}.` : '';
  setCloudStatus(`Connected as ${status.email || status.userId}. Library ${status.libraryId || 'pending'}. Device ${status.deviceId || 'pending'}.${synced}`);
}

saveButton.addEventListener('click', async () => {
  try {
    saveButton.disabled = true;
    const payload = await postJson('/api/desktop/sync-settings', { settings: collectSettings() });
    hydrateForm(payload.settings);
    setStatus(`Saved at ${new Date().toLocaleTimeString()}.`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    saveButton.disabled = false;
  }
});

addFolderButton.addEventListener('click', () => {
  settings.mediaFolders = [...(settings.mediaFolders || []), folderTemplate()];
  renderFolders();
});

folderList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="remove"]');
  if (!button) return;
  const row = button.closest('.folder-row');
  row.remove();
});

connectCloudButton.addEventListener('click', async () => {
  try {
    connectCloudButton.disabled = true;
    setCloudStatus('Connecting desktop to Book of Life Cloud...');
    const payload = await postJson('/api/desktop/cloud/connect', {
      settings: collectSettings(),
      email: cloudEmailInput.value.trim(),
      password: cloudPasswordInput.value
    });
    cloudPasswordInput.value = '';
    hydrateForm(payload.settings);
    renderCloudStatus(payload.status);
    setStatus('Cloud connection saved.');
  } catch (error) {
    setCloudStatus(error.message);
  } finally {
    connectCloudButton.disabled = false;
  }
});

syncCloudButton.addEventListener('click', async () => {
  try {
    syncCloudButton.disabled = true;
    setCloudStatus('Syncing entries with Book of Life Cloud...');
    const result = await postJson('/api/desktop/cloud/sync', {});
    const status = await fetchJson('/api/desktop/cloud/status');
    renderCloudStatus(status);
    setStatus(`Cloud sync complete. Pushed ${result.pushed}, pulled ${result.pulled}.`);
  } catch (error) {
    setCloudStatus(error.message);
  } finally {
    syncCloudButton.disabled = false;
  }
});

loadSettings().catch((error) => setStatus(error.message));
