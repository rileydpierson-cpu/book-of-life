import { apiError, requireUser } from '../../../lib/supabase-api.js';

async function ownsLibrary(supabase, userId, libraryId) {
  const { data, error } = await supabase
    .from('libraries')
    .select('id')
    .eq('id', libraryId)
    .eq('owner_user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function GET(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;
  const url = new URL(request.url);
  const libraryId = url.searchParams.get('libraryId') || '';
  if (!libraryId) return Response.json({ ok: false, error: 'libraryId is required.' }, { status: 400 });
  if (!(await ownsLibrary(context.supabase, context.user.id, libraryId))) {
    return Response.json({ ok: false, error: 'Library not found.' }, { status: 404 });
  }
  const { data, error } = await context.supabase
    .from('devices')
    .select('*')
    .eq('library_id', libraryId)
    .order('created_at', { ascending: true });
  if (error) return apiError(error);
  return Response.json({ ok: true, devices: data || [] });
}

export async function POST(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;
  const body = await request.json().catch(() => ({}));
  const libraryId = String(body.libraryId || '').trim();
  const deviceId = String(body.deviceId || '').trim();
  if (!libraryId) return Response.json({ ok: false, error: 'libraryId is required.' }, { status: 400 });
  if (!(await ownsLibrary(context.supabase, context.user.id, libraryId))) {
    return Response.json({ ok: false, error: 'Library not found.' }, { status: 404 });
  }
  const payload = {
    library_id: libraryId,
    owner_user_id: context.user.id,
    device_name: String(body.deviceName || 'New device').trim(),
    device_type: String(body.deviceType || 'desktop').trim(),
    can_upload_media: Boolean(body.canUploadMedia),
    can_edit_entries: body.canEditEntries !== false,
    can_request_originals: Boolean(body.canRequestOriginals),
    can_use_desktop_host: Boolean(body.canUseDesktopHost),
    host_url: String(body.hostUrl || '').trim(),
    host_relay_token: String(body.hostRelayToken || '').trim(),
    host_relay_expires_at: body.hostRelayExpiresAt || null,
    last_seen_at: new Date().toISOString()
  };
  const query = deviceId
    ? context.supabase.from('devices').update(payload).eq('id', deviceId).eq('owner_user_id', context.user.id).select('*').maybeSingle()
    : context.supabase.from('devices').insert(payload).select('*').single();
  const { data, error } = await query;
  if (error) return apiError(error);
  if (deviceId && !data) {
    return Response.json({ ok: false, error: 'Device not found.' }, { status: 404 });
  }
  return Response.json({ ok: true, device: data }, { status: 201 });
}
