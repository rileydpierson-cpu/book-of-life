import { getDatabase, upsertEntryRecords } from './database';

export async function saveLocalJournalEntry(entry: {
  isoDate: string;
  raw: string;
  updatedAt?: string;
  serverVersion?: number;
}) {
  const isoDate = String(entry.isoDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error('Journal date must use YYYY-MM-DD.');
  }
  await upsertEntryRecords([
    {
      isoDate,
      raw: String(entry.raw || ''),
      updatedAt: entry.updatedAt || new Date().toISOString(),
      serverVersion: Number(entry.serverVersion || 0),
      deleted: false
    }
  ]);
  return {
    isoDate,
    raw: String(entry.raw || '')
  };
}

export async function getLocalJournalEntry(isoDate: string) {
  const db = await getDatabase();
  return db.getFirstAsync<{
    iso_date: string;
    raw: string;
    updated_at: string;
    server_version: number;
    deleted: number;
  }>(
    `SELECT iso_date, raw, updated_at, server_version, deleted FROM entries WHERE iso_date = ?`,
    [String(isoDate || '').trim()]
  );
}

export function buildTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}
