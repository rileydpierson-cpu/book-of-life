import { describe, expect, it } from 'vitest';
import { findFolderNode, getSelectedFolderLabel, insertOptimisticFolder } from './index.js';

const roots = [
  {
    rootId: '0',
    rootLabel: 'Photos',
    tree: {
      label: 'Photos',
      relativePath: '',
      children: [
        {
          label: 'Trips',
          relativePath: 'Trips',
          children: []
        }
      ]
    }
  }
];

describe('folder domain', () => {
  it('finds the selected node', () => {
    expect(findFolderNode(roots[0], 'Trips')?.label).toBe('Trips');
  });

  it('inserts optimistic folders', () => {
    const next = insertOptimisticFolder(roots, { rootId: '0', parentPath: 'Trips', folderName: 'Beach' });
    expect(findFolderNode(next[0], 'Trips/Beach')?.pending).toBe(true);
  });

  it('returns a selection label', () => {
    expect(getSelectedFolderLabel(roots, { rootId: '0', relativePath: 'Trips' })).toBe('Trips');
  });
});
