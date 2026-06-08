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
    .select('*, media_locations(*, devices(device_name, device_type, last_seen_at)), media_actions(id, target_location_id, action_type, status, result), media_backup_transfers(*)')
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
  const previousLocalMediaId = String(body.previousLocalMediaId || '').trim();
  const deviceId = String(body.deviceId || body.hostDeviceId || '').trim();
  const contentHash = String(body.contentHash || '').trim().toLowerCase();
  if (!libraryId) return Response.json({ ok: false, error: 'libraryId is required.' }, { status: 400 });
  if (!(await ownsLibrary(context.supabase, context.user.id, libraryId))) {
    return Response.json({ ok: false, error: 'Library not found.' }, { status: 404 });
  }

  let existing = null;
  let previousLocationMediaId = '';
  if (localMediaId && deviceId) {
    const locationLookup = await context.supabase
      .from('media_locations')
      .select('media_id')
      .eq('library_id', libraryId)
      .eq('device_id', deviceId)
      .eq('local_media_id', localMediaId)
      .maybeSingle();
    if (locationLookup.error) return apiError(locationLookup.error);
    previousLocationMediaId = locationLookup.data?.media_id || '';
  }
  if (contentHash) {
    const lookup = await context.supabase
      .from('media_items')
      .select('*')
      .eq('library_id', libraryId)
      .eq('content_hash', contentHash)
      .maybeSingle();
    if (lookup.error) return apiError(lookup.error);
    existing = lookup.data || null;
  }
  if (!existing && previousLocationMediaId) {
    const lookup = await context.supabase.from('media_items').select('*').eq('id', previousLocationMediaId).maybeSingle();
    if (lookup.error) return apiError(lookup.error);
    existing = lookup.data || null;
  }
  if (!existing && localMediaId) {
    const lookup = await context.supabase
      .from('media_items')
      .select('*')
      .eq('library_id', libraryId)
      .eq('local_media_id', localMediaId)
      .maybeSingle();
    if (lookup.error) return apiError(lookup.error);
    existing = lookup.data || null;
  }

  const incomingMetadata = body.metadata && typeof body.metadata === 'object' ? { ...body.metadata } : {};
  delete incomingMetadata.file_path;
  const fallbackName = String(body.fileName || incomingMetadata.file_name || existing?.file_name || '').trim()
    || `Untitled ${incomingMetadata.type === 'video' ? 'video.mp4' : 'photo.jpg'}`;
  const mediaRow = {
    library_id: libraryId,
    host_device_id: body.hostDeviceId || null,
    local_media_id: localMediaId || null,
    file_signature: String(body.fileSignature || '').trim() || null,
    content_hash: contentHash || existing?.content_hash || null,
    iso_date: body.isoDate || null,
    file_name: fallbackName,
    metadata: { ...(existing?.metadata || {}), ...incomingMetadata },
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
  let { data, error } = await query.select('*').single();
  if (error && contentHash && error.code === '23505') {
    const retry = await context.supabase
      .from('media_items')
      .select('*')
      .eq('library_id', libraryId)
      .eq('content_hash', contentHash)
      .single();
    data = retry.data;
    error = retry.error;
  }
  if (error) return apiError(error);
  if (deviceId && localMediaId) {
    const location = body.location && typeof body.location === 'object' ? body.location : {};
    const relativePath = String(location.relativePath || incomingMetadata.relative_path || incomingMetadata.folder || '').replace(/^\/+/, '');
    const locationRow = {
      library_id: libraryId,
      media_id: data.id,
      device_id: deviceId,
      local_media_id: localMediaId,
      file_name: fallbackName,
      storage_root_id: String(location.storageRootId || incomingMetadata.folder_root_id || ''),
      storage_root_label: String(location.storageRootLabel || ''),
      relative_path: relativePath,
      file_signature: String(body.fileSignature || ''),
      size: Number(location.size || body.originalSize || incomingMetadata.size || 0),
      availability: String(location.availability || (body.originalOnHost === false ? 'missing' : 'available')),
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (previousLocalMediaId && previousLocalMediaId !== localMediaId) {
      await context.supabase
        .from('media_locations')
        .update({ local_media_id: localMediaId, updated_at: new Date().toISOString() })
        .eq('library_id', libraryId)
        .eq('device_id', deviceId)
        .eq('local_media_id', previousLocalMediaId);
    }
    const locationUpsert = await context.supabase
      .from('media_locations')
      .upsert(locationRow, { onConflict: 'library_id,device_id,local_media_id' });
    if (locationUpsert.error) return apiError(locationUpsert.error);
    if (previousLocationMediaId && previousLocationMediaId !== data.id) {
      await context.supabase.from('media_locations').update({ media_id: data.id, updated_at: new Date().toISOString() }).eq('media_id', previousLocationMediaId);
      await context.supabase.from('media_items').delete().eq('id', previousLocationMediaId).eq('library_id', libraryId);
    }
  }
  const hydrated = await context.supabase
    .from('media_items')
    .select('*, media_locations(*, devices(device_name, device_type, last_seen_at)), media_actions(id, target_location_id, action_type, status, result), media_backup_transfers(*)')
    .eq('id', data.id)
    .single();
  if (hydrated.error) return apiError(hydrated.error);
  const media = toMedia(hydrated.data);
  await context.supabase.from('sync_changes').insert({
    library_id: libraryId,
    change_type: 'media.upsert',
    entity_id: media.id,
    payload: { media }
  });
  return Response.json({ ok: true, media }, { status: existing ? 200 : 201 });
}
