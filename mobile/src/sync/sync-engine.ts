import { loadConnection, saveConnection } from '../auth/connection-store';
import { mobileFetchJson } from '../api/client';
import { getSyncStateValue, listLocalEntries, listSyncedMediaItems, setSyncStateValue } from '../storage/database';
import { listLocalMediaAssets, listUploadableLocalMediaAssets } from '../storage/local-media-index';
import { applyBootstrapPayload, applyIncrementalChanges } from './bootstrap-store';
import { enqueueMutation, listPendingMutations, markMutationApplied, markMutationFailed, resetFailedMutations } from './mutation-queue';
import { uploadPendingLocalMedia } from './media-upload';
import type { SyncBootstrapPayload, SyncChangesPayload, SyncConnection, SyncMutationBatchResponse } from './types';

export function createSyncEngine() {
  return {
    async connect(serverUrl: string, username: string, password: string, deviceName = 'Book of Life Mobile', platform = 'expo') {
      const payload = await mobileFetchJson<{ deviceId: string; authToken: string; username?: string; syncRoot?: SyncConnection['syncRoot'] }>(
        { serverUrl },
        '/api/sync/connect',
        {
          method: 'POST',
          body: JSON.stringify({ username, password, deviceName, platform })
        }
      );
      const connection: SyncConnection = {
        serverUrl,
        deviceId: payload.deviceId,
        authToken: payload.authToken,
        username: typeof payload.username === 'string' ? payload.username : username,
        syncRoot: payload.syncRoot || null
      };
      await saveConnection(connection);
      return connection;
    },

    async bootstrap(connection?: SyncConnection) {
      const activeConnection = connection || await loadConnection();
      if (!activeConnection) throw new Error('No saved sync connection.');
      const payload = await mobileFetchJson<SyncBootstrapPayload>(activeConnection, '/api/sync/bootstrap');
      await applyBootstrapPayload(payload);
      await setSyncStateValue('lastCheckpoint', String(payload.checkpoint || 0));
      return payload;
    },

    async pullChanges(connection?: SyncConnection) {
      const activeConnection = connection || await loadConnection();
      if (!activeConnection) throw new Error('No saved sync connection.');
      const lastCheckpoint = Number((await getSyncStateValue('lastCheckpoint')) || 0);
      const payload = await mobileFetchJson<SyncChangesPayload>(activeConnection, `/api/sync/changes?since=${lastCheckpoint}`);
      await applyIncrementalChanges(payload);
      await setSyncStateValue('lastCheckpoint', String(payload.checkpoint || lastCheckpoint));
      return payload;
    },

    async replayPendingMutations(connection?: SyncConnection) {
      const activeConnection = connection || await loadConnection();
      if (!activeConnection) throw new Error('No saved sync connection.');
      await resetFailedMutations();
      const pending = await listPendingMutations();
      if (!pending.length) {
        return { sent: 0, accepted: 0, failed: 0 };
      }
      const response = await mobileFetchJson<SyncMutationBatchResponse>(activeConnection, '/api/sync/mutations', {
        method: 'POST',
        body: JSON.stringify({
          mutations: pending.map((mutation) => ({
            id: mutation.id,
            type: mutation.type,
            entityId: mutation.entity_id,
            baseSequence: mutation.base_sequence,
            clientTimestamp: mutation.created_at,
            payload: JSON.parse(mutation.payload_json || '{}')
          }))
        })
      });
      let accepted = 0;
      let failed = 0;
      for (const result of response.results || []) {
        if (result.accepted) {
          accepted += 1;
          await markMutationApplied(result.mutationId);
        } else {
          failed += 1;
          await markMutationFailed(result.mutationId);
        }
      }
      await setSyncStateValue('lastCheckpoint', String(response.checkpoint || 0));
      await this.pullChanges(activeConnection);
      return {
        sent: pending.length,
        accepted,
        failed
      };
    },

    async uploadPendingMedia(connection?: SyncConnection) {
      const activeConnection = connection || await loadConnection();
      if (!activeConnection) throw new Error('No saved sync connection.');
      const result = await uploadPendingLocalMedia(activeConnection);
      await this.pullChanges(activeConnection);
      return result;
    },

    async queueMutation(mutation: {
      id: string;
      type: string;
      entityId?: string;
      payload: unknown;
      baseSequence?: number;
      createdAt?: string;
    }) {
      const baseSequence = Number((await getSyncStateValue('lastCheckpoint')) || 0);
      await enqueueMutation({
        ...mutation,
        baseSequence: mutation.baseSequence ?? baseSequence,
        createdAt: mutation.createdAt || new Date().toISOString()
      });
    },

    async getStatus() {
      const checkpoint = await getSyncStateValue('lastCheckpoint');
      const pending = await listPendingMutations();
      const entries = await listLocalEntries();
      const mediaAssets = await listLocalMediaAssets();
      const uploadableAssets = await listUploadableLocalMediaAssets();
      const syncedMedia = await listSyncedMediaItems(200);
      return {
        lastCheckpoint: Number(checkpoint || 0),
        pendingMutations: pending.length,
        localEntries: entries.length,
        localMediaAssets: mediaAssets.length,
        pendingMediaUploads: uploadableAssets.length,
        syncedMediaItems: syncedMedia.length
      };
    }
  };
}
