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
    .from('media_items')
    .select('*')
    .eq('library_id', libraryId)
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) return apiError(error);
  return Response.json({ ok: true, media: data || [] });
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
    .from('media_items')
    .insert({
      library_id: libraryId,
      host_device_id: body.hostDeviceId || null,
      iso_date: body.isoDate || null,
      file_name: String(body.fileName || '').trim(),
      metadata: body.metadata || {},
      has_thumb: Boolean(body.hasThumb),
      has_preview: Boolean(body.hasPreview),
      original_in_cloud: Boolean(body.originalInCloud),
      original_on_host: body.originalOnHost !== false
    })
    .select('*')
    .single();
  if (error) return apiError(error);
  return Response.json({ ok: true, media: data }, { status: 201 });
}
