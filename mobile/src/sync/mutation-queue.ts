import { getDatabase } from '../storage/database';

export async function enqueueMutation(mutation: {
  id: string;
  type: string;
  entityId?: string;
  payload: unknown;
  baseSequence?: number;
  createdAt: string;
}) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO sync_mutations (id, type, entity_id, payload_json, base_sequence, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [
      mutation.id,
      mutation.type,
      mutation.entityId || '',
      JSON.stringify(mutation.payload ?? {}),
      mutation.baseSequence || 0,
      mutation.createdAt
    ]
  );
}

export async function listPendingMutations() {
  const db = await getDatabase();
  return db.getAllAsync<{
    id: string;
    type: string;
    entity_id: string;
    payload_json: string;
    base_sequence: number;
    created_at: string;
  }>(`SELECT id, type, entity_id, payload_json, base_sequence, created_at FROM sync_mutations WHERE status = 'pending' ORDER BY created_at ASC`);
}

export async function markMutationApplied(id: string) {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM sync_mutations WHERE id = ?`, [id]);
}

export async function markMutationFailed(id: string) {
  const db = await getDatabase();
  await db.runAsync(`UPDATE sync_mutations SET status = 'failed' WHERE id = ?`, [id]);
}

export async function resetFailedMutations() {
  const db = await getDatabase();
  await db.runAsync(`UPDATE sync_mutations SET status = 'pending' WHERE status = 'failed'`);
}
