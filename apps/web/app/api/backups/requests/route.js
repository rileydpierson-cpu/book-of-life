import crypto from 'node:crypto';
import { apiError, requireUser } from '../../../../lib/supabase-api.js';

export async function GET(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;
  const url = new URL(request.url);
  const libraryId = url.searchParams.get('libraryId') || '';
  const targetDeviceId = url.searchParams.get('targetDeviceId') || '';
  let query = context.supabase.from('device_backup_requests').select('*, source:devices!device_backup_requests_source_device_id_fkey(device_name,device_type), target:devices!device_backup_requests_target_device_id_fkey(device_name,device_type,host_url,host_relay_expires_at)').eq('library_id', libraryId).order('created_at', { ascending: false });
  if (targetDeviceId) query = query.eq('target_device_id', targetDeviceId);
  const result = await query;
  if (result.error) return apiError(result.error);
  return Response.json({ ok: true, requests: result.data || [] });
}

export async function POST(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;
  const body = await request.json().catch(() => ({}));
  const now = new Date();
  const payload = {
    library_id: String(body.libraryId || ''),
    source_device_id: String(body.sourceDeviceId || ''),
    target_device_id: String(body.targetDeviceId || ''),
    status: 'pending',
    destination_label: String(body.destinationLabel || ''),
    transfer_token: crypto.randomBytes(32).toString('hex'),
    transfer_token_expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    updated_at: now.toISOString()
  };
  if (!payload.library_id || !payload.source_device_id || !payload.target_device_id) {
    return Response.json({ ok: false, error: 'libraryId, sourceDeviceId, and targetDeviceId are required.' }, { status: 400 });
  }
  await context.supabase.from('device_backup_requests').update({ status: 'declined', updated_at: now.toISOString() }).eq('library_id', payload.library_id).eq('source_device_id', payload.source_device_id).eq('status', 'pending');
  const result = await context.supabase.from('device_backup_requests').insert(payload).select('*').single();
  if (result.error) return apiError(result.error);
  await context.supabase.from('sync_changes').insert({ library_id: payload.library_id, change_type: 'backup.request', entity_id: result.data.id, payload: { targetDeviceId: payload.target_device_id } });
  return Response.json({ ok: true, request: result.data }, { status: 201 });
}

export async function PATCH(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '');
  const status = ['accepted', 'declined'].includes(body.status) ? body.status : '';
  if (!id || !status) return Response.json({ ok: false, error: 'id and accepted/declined status are required.' }, { status: 400 });
  const payload = {
    status,
    destination_label: String(body.destinationLabel || ''),
    free_bytes: Math.max(0, Number(body.freeBytes || 0)),
    updated_at: new Date().toISOString()
  };
  const result = await context.supabase.from('device_backup_requests').update(payload).eq('id', id).select('*').single();
  if (result.error) return apiError(result.error);
  await context.supabase.from('sync_changes').insert({ library_id: result.data.library_id, change_type: 'backup.request', entity_id: id, payload: { status } });
  return Response.json({ ok: true, request: result.data });
}
