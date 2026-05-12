export type SyncConnection = {
  serverUrl: string;
  deviceId: string;
  authToken: string;
  syncRoot?: {
    rootId: string;
    rootLabel: string;
    deviceFolderName: string;
    baseRelativePath: string;
  } | null;
};

export type FolderTreeNode = {
  label: string;
  relativePath?: string;
  displayPath?: string;
  mediaCount?: number;
  latestModifiedMs?: number;
  icon?: string;
  children?: FolderTreeNode[];
};

export type SyncBootstrapPayload = {
  checkpoint: number;
  bootstrap: Record<string, unknown>;
  entries: Array<{
    isoDate: string;
    raw: string;
    updatedAt?: string;
    serverVersion?: number;
    deleted?: boolean;
  }>;
  media: Array<Record<string, unknown> & { id: string }>;
  folders: Array<{
    rootId: string;
    rootLabel: string;
    tree: FolderTreeNode;
  }>;
};

export type SyncChange = {
  sequence: number;
  type: string;
  entityId: string;
  payload: Record<string, unknown>;
  changedAt: string;
};

export type SyncChangesPayload = {
  checkpoint: number;
  changes: SyncChange[];
};

export type SyncMutationResult = {
  accepted: boolean;
  mutationId: string;
  duplicate?: boolean;
  sequence?: number;
  error?: string;
};

export type SyncMutationBatchResponse = {
  checkpoint: number;
  results: SyncMutationResult[];
};
