import '../../styles/desktop-settings.css';
import { fetchJson, postJson } from '../../core/api.js';

const form = document.querySelector('#settings-form');
const saveButton = document.querySelector('#save-settings');
const addFolderButton = document.querySelector('#add-folder');
const folderList = document.querySelector('#media-folders');
const statusLine = document.querySelector('#settings-status');

let settings = null;

function setStatus(message) {
  statusLine.textContent = message;
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
  const payload = await fetchJson('/api/desktop/sync-settings');
  hydrateForm(payload.settings);
  setStatus('Settings loaded.');
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

loadSettings().catch((error) => setStatus(error.message));
