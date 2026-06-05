export function getSelectedFolderLabel(roots: Array<{
  rootId: string;
  rootLabel: string;
  tree: { label?: string; relativePath?: string; displayPath?: string; children?: Array<unknown> };
}>, selection: { rootId: string; relativePath: string }) {
  const root = roots.find((item) => item.rootId === selection.rootId);
  if (!root) return 'Choose a folder';
  const path = String(selection.relativePath || '').trim();
  if (!path) return `${root.rootLabel} / (root)`;
  return `${root.rootLabel} / ${path}`;
}
