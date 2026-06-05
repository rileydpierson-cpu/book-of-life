import { apiError, requireUser, toMedia } from '../../../lib/supabase-api.js';

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
    .limit(2000);
  if (error) return apiError(error);
  return Response.json({ ok: true, media: (data || []).map(toMedia) });
}

export async function POST(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;
  const body = await request.json().catch(() => ({}));
  const libraryId = String(body.libraryId || '').trim();
  const localMediaId = String(body.localMediaId || '').trim();
  if (!libraryId) return Response.json({ ok: false, error: 'libraryId is required.' }, { status: 400 });
  if (!(await ownsLibrary(context.supabase, context.user.id, libraryId))) {
    return Response.json({ ok: false, error: 'Library not found.' }, { status: 404 });
  }

  let existing = null;
  if (localMediaId) {
    const lookup = await context.supabase
      .from('media_items')
      .select('*')
      .eq('library_id', libraryId)
      .eq('local_media_id', localMediaId)
      .maybeSingle();
    if (lookup.error) return apiError(lookup.error);
    existing = lookup.data || null;
  }

  const mediaRow = {
    library_id: libraryId,
    host_device_id: body.hostDeviceId || null,
    local_media_id: localMediaId || null,
    file_signature: String(body.fileSignature || '').trim() || null,
    iso_date: body.isoDate || null,
    file_name: String(body.fileName || '').trim(),
    metadata: body.metadata || existing?.metadata || {},
    has_thumb: body.hasThumb === undefined ? Boolean(existing?.has_thumb) : Boolean(body.hasThumb),
    has_preview: body.hasPreview === undefined ? Boolean(existing?.has_preview) : Boolean(body.hasPreview),
    thumb_storage_path: body.thumbStoragePath === undefined ? (existing?.thumb_storage_path || '') : String(body.thumbStoragePath || '').trim(),
    thumb_content_type: body.thumbContentType === undefined ? (existing?.thumb_content_type || '') : String(body.thumbContentType || '').trim(),
    preview_storage_path: body.previewStoragePath === undefined ? (existing?.preview_storage_path || '') : String(body.previewStoragePath || '').trim(),
    preview_content_type: body.previewContentType === undefined ? (existing?.preview_content_type || '') : String(body.previewContentType || '').trim(),
    original_in_cloud: body.originalInCloud === undefined ? Boolean(existing?.original_in_cloud) : Boolean(body.originalInCloud),
    original_on_host: body.originalOnHost !== false,
    original_storage_path: body.originalStoragePath === undefined ? (existing?.original_storage_path || '') : body.originalStoragePath || '',
    original_size: body.originalSize === undefined ? Number(existing?.original_size || 0) : Number(body.originalSize || 0) || 0,
    original_content_type: body.originalContentType === undefined ? (existing?.original_content_type || '') : body.originalContentType || '',
    updated_at: new Date().toISOString()
  };

  const query = existing
    ? context.supabase.from('media_items').update(mediaRow).eq('id', existing.id)
    : context.supabase.from('media_items').insert(mediaRow);
  const { data, error } = await query.select('*').single();
  if (error) return apiError(error);
  const media = toMedia(data);
  await context.supabase.from('sync_changes').insert({
    library_id: libraryId,
    change_type: 'media.upsert',
    entity_id: media.id,
    payload: { media }
  });
  return Response.json({ ok: true, media }, { status: existing ? 200 : 201 });
}
