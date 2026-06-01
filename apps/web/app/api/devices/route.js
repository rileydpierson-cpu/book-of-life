import { requireUser } from '../../../lib/supabase-admin.js';

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
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, devices: data || [] });
}

export async function POST(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;
  const body = await request.json().catch(() => ({}));
  const libraryId = String(body.libraryId || '').trim();
  if (!libraryId) return Response.json({ ok: false, error: 'libraryId is required.' }, { status: 400 });
  if (!(await ownsLibrary(context.supabase, context.user.id, libraryId))) {
    return Response.json({ ok: false, error: 'Library not found.' }, { status: 404 });
  }
  const { data, error } = await context.supabase
    .from('devices')
    .insert({
      library_id: libraryId,
      owner_user_id: context.user.id,
      device_name: String(body.deviceName || 'New device').trim(),
      device_type: String(body.deviceType || 'desktop').trim(),
      can_upload_media: Boolean(body.canUploadMedia),
      can_edit_entries: body.canEditEntries !== false,
      can_request_originals: Boolean(body.canRequestOriginals),
      can_use_desktop_host: Boolean(body.canUseDesktopHost),
      last_seen_at: new Date().toISOString()
    })
    .select('*')
    .single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, device: data }, { status: 201 });
}
