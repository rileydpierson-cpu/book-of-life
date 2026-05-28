export function findFolderNode(root, relativePath = '') {
  if (!root?.tree) return null;
  const target = String(relativePath || '');
  if (!target || target === '.') return root.tree;
  const parts = target.split('/').filter(Boolean);
  let current = root.tree;
  for (const part of parts) {
    current = (current.children || []).find((child) => child.label === part || child.relativePath === parts.slice(0, parts.indexOf(part) + 1).join('/'));
    if (!current) return null;
  }
  return current;
}

export function insertOptimisticFolder(roots, { rootId, parentPath = '', folderName }) {
  const nextRoots = Array.isArray(roots) ? structuredClone(roots) : [];
  const root = nextRoots.find((item) => item.rootId === rootId) || nextRoots[0];
  if (!root || !folderName) return nextRoots;
  const parent = findFolderNode(root, parentPath) || root.tree;
  parent.children = parent.children || [];
  const target = parentPath && parentPath !== '.' ? parentPath : '';
  const relativePath = [target, folderName].filter(Boolean).join('/');
  parent.children.push({
    label: folderName,
    relativePath,
    displayPath: relativePath || '.',
    mediaCount: 0,
    latestModifiedMs: Date.now(),
    icon: 'folder',
    children: [],
    pending: true
  });
  return nextRoots;
}

export function getSelectedFolderLabel(roots, selection) {
  const root = (roots || []).find((item) => item.rootId === selection?.rootId) || roots?.[0];
  const node = findFolderNode(root, selection?.relativePath);
  return node?.label || root?.rootLabel || 'No photo folders configured';
}
