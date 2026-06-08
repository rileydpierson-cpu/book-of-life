import { apiError, requireUser } from '../../../../lib/supabase-api.js';

export async function GET(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;
  const url = new URL(request.url);
  const libraryId = url.searchParams.get('libraryId') || '';
  const mediaId = url.searchParams.get('mediaId') || '';
  const destinationDeviceId = url.searchParams.get('destinationDeviceId') || '';
  const status = url.searchParams.get('status') || '';
  let query = context.supabase.from('media_backup_transfers').select('*').eq('library_id', libraryId).order('updated_at', { ascending: false });
  if (mediaId) query = query.eq('media_id', mediaId);
  if (destinationDeviceId) query = query.eq('destination_device_id', destinationDeviceId);
  if (status) query = query.eq('status', status);
  const result = await query;
  if (result.error) return apiError(result.error);
  return Response.json({ ok: true, transfers: result.data || [] });
}

export async function POST(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;
  const body = await request.json().catch(() => ({}));
  const destinationDeviceId = String(body.destinationDeviceId || '') || null;
  const payload = {
    library_id: String(body.libraryId || ''),
    media_id: String(body.mediaId || ''),
    source_device_id: String(body.sourceDeviceId || '') || null,
    destination_type: String(body.destinationType || ''),
    destination_device_id: destinationDeviceId,
    destination_key: destinationDeviceId || 'cloud',
    request_id: String(body.requestId || '') || null,
    file_name: String(body.fileName || ''),
    staging_storage_path: String(body.stagingStoragePath || ''),
    status: String(body.status || 'queued'),
    current_bytes: Math.max(0, Number(body.currentBytes || 0)),
    total_bytes: Math.max(0, Number(body.totalBytes || 0)),
    error: String(body.error || ''),
    completed_at: body.status === 'completed' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString()
  };
  if (!payload.library_id || !payload.media_id || !['cloud', 'desktop'].includes(payload.destination_type)) {
    return Response.json({ ok: false, error: 'libraryId, mediaId, and destinationType are required.' }, { status: 400 });
  }
  const result = await context.supabase.from('media_backup_transfers').upsert(payload, { onConflict: 'media_id,destination_type,destination_key' }).select('*').single();
  if (result.error) return apiError(result.error);
  await context.supabase.from('sync_changes').insert({
    library_id: payload.library_id,
    change_type: 'media.upsert',
    entity_id: payload.media_id,
    payload: { backupTransfer: result.data }
  });
  return Response.json({ ok: true, transfer: result.data });
}
