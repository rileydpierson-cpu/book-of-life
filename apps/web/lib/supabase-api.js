import { createBearerClient, createClient, isServerSupabaseConfigured } from '../utils/supabase/server.js';

export function setupResponse() {
  return Response.json({
    ok: false,
    setupRequired: true,
    error: 'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.'
  }, { status: 503 });
}

function bearerTokenFromRequest(request) {
  const header = String(request?.headers?.get?.('authorization') || '');
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

export async function requireUser(request) {
  if (!isServerSupabaseConfigured()) return { response: setupResponse() };
  const bearerToken = bearerTokenFromRequest(request);
  if (bearerToken) {
    const supabase = createBearerClient(bearerToken);
    const { data, error } = await supabase.auth.getUser(bearerToken);
    if (error || !data.user) {
      return {
        response: Response.json({ ok: false, error: 'Sign in required.' }, { status: 401 })
      };
    }
    return { supabase, user: data.user, authMode: 'bearer' };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return {
      response: Response.json({ ok: false, error: 'Sign in required.' }, { status: 401 })
    };
  }
  return { supabase, user: data.user };
}

export function apiError(error, fallback = 'Request failed.') {
  const message = typeof error === 'string' ? error : (error?.message || fallback);
  if (
    message.includes("Could not find the table 'public.") ||
    message.includes('schema cache') ||
    error?.code === 'PGRST205'
  ) {
    return Response.json({
      ok: false,
      setupRequired: true,
      error: 'The Supabase database schema has not been installed or the API schema cache has not refreshed yet. Run services/cloud-api/schema.sql in the Supabase SQL Editor, then run `notify pgrst, \'reload schema\';`.'
    }, { status: 503 });
  }
  return Response.json({ ok: false, error: message }, { status: 500 });
}

export function toEntry(row) {
  return {
    libraryId: row.library_id,
    isoDate: row.iso_date,
    raw: row.raw || '',
    cloudVersion: Number(row.cloud_version || 0),
    updatedAt: row.updated_at,
    updatedByDeviceId: row.updated_by_device_id || ''
  };
}

export function toLibrary(row) {
  return {
    id: row.id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function toMedia(row) {
  const actions = (Array.isArray(row.media_actions) ? row.media_actions : []).map((action) => ({
    id: action.id,
    targetLocationId: action.target_location_id || '',
    actionType: action.action_type || '',
    status: action.status || 'pending',
    result: action.result || {}
  }));
  const locations = (Array.isArray(row.media_locations) ? row.media_locations : [])
    .map((location) => ({
      id: location.id,
      deviceId: location.device_id || '',
      deviceName: location.devices?.device_name || '',
      deviceType: location.devices?.device_type || '',
      localMediaId: location.local_media_id || '',
      fileName: location.file_name || '',
      storageRootId: location.storage_root_id || '',
      storageRootLabel: location.storage_root_label || '',
      relativePath: location.relative_path || '',
      fileSignature: location.file_signature || '',
      size: Number(location.size || 0),
      availability: location.availability || 'available',
      pendingActions: actions.filter((action) => action.targetLocationId === location.id && action.status === 'pending'),
      failedActions: actions.filter((action) => action.targetLocationId === location.id && action.status === 'failed'),
      lastSeenAt: location.last_seen_at || '',
      updatedAt: location.updated_at || ''
    }));
  return {
    id: row.id,
    libraryId: row.library_id,
    hostDeviceId: row.host_device_id || '',
    localMediaId: row.local_media_id || '',
    fileSignature: row.file_signature || '',
    contentHash: row.content_hash || '',
    isoDate: row.iso_date || '',
    fileName: row.file_name || '',
    metadata: row.metadata || {},
    hasThumb: Boolean(row.has_thumb),
    hasPreview: Boolean(row.has_preview),
    thumbStoragePath: row.thumb_storage_path || '',
    thumbContentType: row.thumb_content_type || '',
    previewStoragePath: row.preview_storage_path || '',
    previewContentType: row.preview_content_type || '',
    originalInCloud: Boolean(row.original_in_cloud),
    originalOnHost: row.original_on_host !== false,
    originalStoragePath: row.original_storage_path || '',
    originalSize: Number(row.original_size || 0),
    originalContentType: row.original_content_type || '',
    locations,
    actions,
    availability: {
      localCopies: locations.filter((location) => location.availability === 'available').length,
      originalInCloud: Boolean(row.original_in_cloud),
      hasThumb: Boolean(row.has_thumb),
      hasPreview: Boolean(row.has_preview)
    },
    updatedAt: row.updated_at || ''
  };
}
