import { setSyncStateValue, upsertEntryRecords, upsertFolderRecords, upsertMediaRecords } from '../storage/database';
import type { FolderTreeNode, SyncBootstrapPayload, SyncChange, SyncChangesPayload, SyncServerSummary } from './types';

function folderId(rootId: string, relativePath: string) {
  return `${rootId}:${relativePath || '.'}`;
}

function flattenFolderTree(
  rootId: string,
  node: FolderTreeNode,
  acc: Array<{ id: string; rootId: string; relativePath: string; label: string; [key: string]: unknown }> = []
) {
  const relativePath = String(node.relativePath || '');
  const { label: nodeLabel, ...restNode } = node;
  acc.push({
    id: folderId(rootId, relativePath),
    rootId,
    relativePath,
    ...restNode,
    label: String(nodeLabel || node.displayPath || '(root)')
  });
  for (const child of node.children || []) {
    flattenFolderTree(rootId, child, acc);
  }
  return acc;
}

export async function applyBootstrapPayload(payload: SyncBootstrapPayload) {
  await persistServerSummary(payload.serverSummary);
  await upsertEntryRecords(
    (payload.entries || []).map((entry) => ({
      isoDate: entry.isoDate,
      raw: entry.raw || '',
      updatedAt: entry.updatedAt || '',
      serverVersion: payload.checkpoint,
      deleted: Boolean(entry.deleted)
    }))
  );

  await upsertMediaRecords(
    (payload.media || []).map((item) => ({
      ...item,
      id: String(item.id),
      serverVersion: payload.checkpoint,
      deleted: Boolean(item.deleted)
    }))
  );

  const folders = (payload.folders || []).flatMap((root) => flattenFolderTree(root.rootId, root.tree));
  await upsertFolderRecords(
    folders.map((folder) => ({
      ...folder,
      serverVersion: payload.checkpoint,
      deleted: false
    }))
  );
}

export async function applyIncrementalChanges(payload: SyncChangesPayload) {
  await persistServerSummary(payload.serverSummary);
  const entryUpdates: Array<{ isoDate: string; raw: string; updatedAt?: string; serverVersion?: number; deleted?: boolean }> = [];
  const mediaUpdates: Array<Record<string, unknown> & { id: string }> = [];
  const folderUpdates: Array<Record<string, unknown> & { id: string; rootId: string; relativePath: string; label: string }> = [];

  for (const change of payload.changes || []) {
    collectChange(change, entryUpdates, mediaUpdates, folderUpdates);
  }

  await upsertEntryRecords(entryUpdates);
  await upsertMediaRecords(mediaUpdates);
  await upsertFolderRecords(folderUpdates);
}

async function persistServerSummary(summary?: SyncServerSummary) {
  if (!summary) return;
  await setSyncStateValue('serverSummary', JSON.stringify(summary));
}

function collectChange(
  change: SyncChange,
  entryUpdates: Array<{ isoDate: string; raw: string; updatedAt?: string; serverVersion?: number; deleted?: boolean }>,
  mediaUpdates: Array<Record<string, unknown> & { id: string }>,
  folderUpdates: Array<Record<string, unknown> & { id: string; rootId: string; relativePath: string; label: string }>
) {
  const sequence = Number(change.sequence || 0);
  if (change.type === 'entry.upsert') {
    const entry = (change.payload.entry || {}) as Record<string, unknown>;
    entryUpdates.push({
      isoDate: String(entry.isoDate || change.entityId),
      raw: String(entry.raw || ''),
      updatedAt: String(entry.updatedAt || change.changedAt || ''),
      serverVersion: sequence,
      deleted: Boolean(entry.deleted)
    });
    return;
  }
  if (change.type === 'entry.delete') {
    entryUpdates.push({
      isoDate: String(change.payload.isoDate || change.entityId),
      raw: '',
      updatedAt: change.changedAt,
      serverVersion: sequence,
      deleted: true
    });
    return;
  }
  if (change.type === 'media.upsert') {
    const media = (change.payload.media || {}) as Record<string, unknown>;
    mediaUpdates.push({
      ...media,
      id: String(media.id || change.entityId),
      serverVersion: sequence,
      deleted: false
    });
    return;
  }
  if (change.type === 'media.delete') {
    mediaUpdates.push({
      id: String(change.payload.photoId || change.entityId),
      isoDate: String(change.payload.isoDate || ''),
      fileName: '',
      serverVersion: sequence,
      deleted: true
    });
    return;
  }
  if (change.type === 'folder.upsert') {
    const rootId = String(change.payload.rootId || '');
    const relativePath = String(change.payload.relativePath || '');
    folderUpdates.push({
      id: folderId(rootId, relativePath),
      rootId,
      relativePath,
      label: relativePath || '(root)',
      serverVersion: sequence,
      deleted: false
    });
  }
}
