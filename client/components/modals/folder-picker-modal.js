import { findFolderNode, getSelectedFolderLabel, insertOptimisticFolder } from '../../domain/folders/index.js';
import { renderPhIcon } from '../viewer/create-media-viewer.js';

function renderFolderNode(node, { rootId, selectedPath = '', depth = 0 }) {
  const meta = node.pending ? '<span class="upload-folder-pending">Pending</span>' : `<span class="upload-folder-item-meta">${node.mediaCount || 0}</span>`;
  const icon = node.pending
    ? renderPhIcon('spinner-gap', { spin: true })
    : renderPhIcon(node.icon || 'folder', { variant: 'duotone' });
  const indent = depth * 14;
  return `
    <div class="upload-folder-node depth-${depth}">
      <button class="upload-folder-item ${selectedPath === (node.relativePath || '') ? 'is-selected' : ''} ${node.pending ? 'is-pending' : ''}" type="button" style="padding-left:${12 + indent}px" data-upload-root="${rootId}" data-upload-path="${node.relativePath || ''}">
        <span class="upload-folder-item-main">${icon}<span>${node.displayPath === '.' ? '(root)' : node.label}</span></span>
        ${meta}
      </button>
      ${(node.children || []).map((child) => renderFolderNode(child, { rootId, selectedPath, depth: depth + 1 })).join('')}
    </div>
  `;
}

export function createFolderPicker({ mountNode, services = {} }) {
  const state = {
    roots: [],
    selection: { rootId: '0', relativePath: '' }
  };

  const dom = {
    tree: mountNode,
    label: services.labelNode || null
  };

  function render() {
    const roots = (state.selection.rootId && state.roots.length)
      ? state.roots.filter((root) => root.rootId === state.selection.rootId)
      : state.roots;
    dom.tree.innerHTML = roots.map((root) => `
      <div class="upload-folder-root ${root.rootId === state.selection.rootId ? 'is-active-root' : ''}">
        <div class="upload-folder-root-label">${renderPhIcon('hard-drives', { variant: 'duotone' })} ${root.rootLabel} <span class="upload-folder-root-count">${root.tree.mediaCount || 0}</span></div>
        ${renderFolderNode(root.tree, { rootId: root.rootId, selectedPath: state.selection.relativePath })}
      </div>
    `).join('');
    if (dom.label) dom.label.textContent = getSelectedFolderLabel(state.roots, state.selection);
  }

  dom.tree.addEventListener('click', (event) => {
    const button = event.target.closest('[data-upload-root]');
    if (!button) return;
    state.selection = {
      rootId: button.dataset.uploadRoot || state.selection.rootId,
      relativePath: button.dataset.uploadPath || ''
    };
    render();
    services.onSelect?.(state.selection);
  });

  return {
    setRoots(roots) {
      state.roots = Array.isArray(roots) ? roots : [];
      render();
    },
    setSelection(selection) {
      state.selection = { ...state.selection, ...(selection || {}) };
      render();
    },
    getSelection() {
      return { ...state.selection };
    },
    insertOptimisticFolder(folder) {
      state.roots = insertOptimisticFolder(state.roots, folder);
      render();
      return findFolderNode(state.roots.find((root) => root.rootId === folder.rootId), [folder.parentPath, folder.folderName].filter(Boolean).join('/'));
    },
    render,
    destroy() {
      dom.tree.innerHTML = '';
    }
  };
}
