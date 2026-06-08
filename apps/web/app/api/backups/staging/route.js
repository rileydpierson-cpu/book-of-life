import { apiError, requireUser } from '../../../../lib/supabase-api.js';

function safeFileName(value) {
  return String(value || 'media').replace(/[\\/]/g, '-').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 160) || 'media';
}

export async function POST(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;
  const body = await request.json().catch(() => ({}));
  const libraryId = String(body.libraryId || '');
  const mediaId = String(body.mediaId || '');
  const targetDeviceId = String(body.targetDeviceId || '');
  if (!libraryId || !mediaId || !targetDeviceId) return Response.json({ ok: false, error: 'libraryId, mediaId, and targetDeviceId are required.' }, { status: 400 });
  const objectPath = `libraries/${libraryId}/staging/${targetDeviceId}/${mediaId}/${safeFileName(body.fileName)}`;
  const result = await context.supabase.storage.from('media-staging').createSignedUploadUrl(objectPath, { upsert: true });
  if (result.error) return apiError(result.error);
  return Response.json({ ok: true, objectPath, signedUrl: result.data?.signedUrl || '', token: result.data?.token || '' });
}

export async function GET(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;
  const url = new URL(request.url);
  const transferId = url.searchParams.get('transferId') || '';
  const transfer = await context.supabase.from('media_backup_transfers').select('*').eq('id', transferId).single();
  if (transfer.error) return apiError(transfer.error);
  const signed = await context.supabase.storage.from('media-staging').createSignedUrl(transfer.data.staging_storage_path, 15 * 60);
  if (signed.error) return apiError(signed.error);
  return Response.json({ ok: true, transfer: transfer.data, signedUrl: signed.data?.signedUrl || '' });
}

export async function DELETE(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;
  const body = await request.json().catch(() => ({}));
  const transferId = String(body.transferId || '');
  const transfer = await context.supabase.from('media_backup_transfers').select('*').eq('id', transferId).single();
  if (transfer.error) return apiError(transfer.error);
  if (transfer.data.staging_storage_path) {
    const removed = await context.supabase.storage.from('media-staging').remove([transfer.data.staging_storage_path]);
    if (removed.error) return apiError(removed.error);
  }
  const updated = await context.supabase.from('media_backup_transfers').update({
    status: 'completed',
    staging_storage_path: '',
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }).eq('id', transferId).select('*').single();
  if (updated.error) return apiError(updated.error);
  return Response.json({ ok: true, transfer: updated.data });
}
