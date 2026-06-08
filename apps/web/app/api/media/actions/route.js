import { apiError, requireUser } from '../../../../lib/supabase-api.js';

const ACTION_TYPES = new Set([
  'media.tags.set',
  'media.description.set',
  'media.like.set',
  'media.date-time.set',
  'media.rename',
  'media.move',
  'media.delete'
]);

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
  const hostDeviceId = url.searchParams.get('hostDeviceId') || '';
  const status = url.searchParams.get('status') || 'pending';
  if (!libraryId) return Response.json({ ok: false, error: 'libraryId is required.' }, { status: 400 });
  if (!(await ownsLibrary(context.supabase, context.user.id, libraryId))) {
    return Response.json({ ok: false, error: 'Library not found.' }, { status: 404 });
  }
  let query = context.supabase
    .from('media_actions')
    .select('*')
    .eq('library_id', libraryId)
    .eq('status', status)
    .order('created_at', { ascending: true })
    .limit(100);
  if (hostDeviceId) query = query.eq('host_device_id', hostDeviceId);
  const { data, error } = await query;
  if (error) return apiError(error);
  return Response.json({ ok: true, actions: data || [] });
}

async function ownedMedia(supabase, userId, libraryId, mediaId) {
  const library = await supabase
    .from('libraries')
    .select('id')
    .eq('id', libraryId)
    .eq('owner_user_id', userId)
    .maybeSingle();
  if (library.error) throw new Error(library.error.message);
  if (!library.data) return null;
  const media = await supabase
    .from('media_items')
    .select('*, media_locations(*)')
    .eq('library_id', libraryId)
    .eq('id', mediaId)
    .maybeSingle();
  if (media.error) throw new Error(media.error.message);
  return media.data || null;
}

export async function POST(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;
  const body = await request.json().catch(() => ({}));
  const libraryId = String(body.libraryId || '').trim();
  const mediaId = String(body.mediaId || '').trim();
  const actionType = String(body.actionType || '').trim();
  if (!libraryId || !mediaId || !ACTION_TYPES.has(actionType)) {
    return Response.json({ ok: false, error: 'libraryId, mediaId, and valid actionType are required.' }, { status: 400 });
  }

  let media = null;
  try {
    media = await ownedMedia(context.supabase, context.user.id, libraryId, mediaId);
  } catch (error) {
    return apiError(error);
  }
  if (!media) return Response.json({ ok: false, error: 'Media not found.' }, { status: 404 });

  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
  const locationActions = new Set(['media.rename', 'media.move', 'media.delete']);
  const excludeDeviceId = String(body.excludeDeviceId || '');
  const targets = locationActions.has(actionType) && Array.isArray(media.media_locations) && media.media_locations.length
    ? media.media_locations
    : [{ id: null, device_id: media.host_device_id || null, local_media_id: media.local_media_id || '' }];
  const filteredTargets = targets.filter((target) => !excludeDeviceId || target.device_id !== excludeDeviceId);
  if (!filteredTargets.length) {
    return Response.json({ ok: true, actions: [], action: null }, { status: 200 });
  }
  const action = await context.supabase
    .from('media_actions')
    .insert(filteredTargets.map((target) => ({
      library_id: libraryId,
      media_id: mediaId,
      requested_by_device_id: body.deviceId || null,
      host_device_id: target.device_id || null,
      target_location_id: target.id || null,
      action_type: actionType,
      payload: { ...payload, photoId: target.local_media_id || payload.photoId || '' },
      status: 'pending',
      updated_at: new Date().toISOString()
    })))
    .select('*')
    ;
  if (action.error) return apiError(action.error);

  const nextMetadata = {
    ...(media.metadata || {})
  };
  if (actionType === 'media.tags.set') {
    nextMetadata.tags = Array.isArray(payload.tags) ? payload.tags : [];
  }
  if (actionType === 'media.description.set') {
    nextMetadata.description = String(payload.description || '');
  }
  if (actionType === 'media.like.set') {
    nextMetadata.liked = Boolean(payload.liked);
  }
  nextMetadata.pendingActions = [
    ...(Array.isArray(media.metadata?.pendingActions) ? media.metadata.pendingActions : []),
    ...(action.data || []).map((item) => ({ id: item.id, actionType, createdAt: item.created_at, targetLocationId: item.target_location_id }))
  ];
  await context.supabase
    .from('media_items')
    .update({ metadata: nextMetadata, updated_at: new Date().toISOString() })
    .eq('id', mediaId)
    .eq('library_id', libraryId);
  await context.supabase.from('sync_changes').insert({
    library_id: libraryId,
    change_type: 'media.upsert',
    entity_id: mediaId,
    payload: {
      media: {
        id: mediaId,
        metadata: nextMetadata,
        pendingActions: action.data
      }
    }
  });

  return Response.json({ ok: true, actions: action.data || [], action: action.data?.[0] || null }, { status: 201 });
}
