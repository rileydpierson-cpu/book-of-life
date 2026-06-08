import { apiError, requireUser } from '../../../../../../lib/supabase-api.js';

const VARIANTS = new Set(['thumb', 'preview', 'full']);

async function mediaForUser(supabase, userId, libraryId, mediaId) {
  const library = await supabase
    .from('libraries')
    .select('id')
    .eq('id', libraryId)
    .eq('owner_user_id', userId)
    .maybeSingle();
  if (library.error) throw new Error(library.error.message);
  if (!library.data) return null;

  const { data, error } = await supabase
    .from('media_items')
    .select('*, media_locations(*, devices(*))')
    .eq('library_id', libraryId)
    .eq('id', mediaId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function signedStorageRedirect(supabase, bucket, storagePath) {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 60 * 10);
  if (error) throw new Error(error.message);
  return data?.signedUrl || null;
}

function relayUrl(host, variant, localMediaId) {
  const base = String(host?.host_url || '').replace(/\/+$/, '');
  return `${base}/api/desktop/relay/media/${encodeURIComponent(variant)}/${encodeURIComponent(localMediaId)}`;
}

export async function GET(request, { params }) {
  const context = await requireUser(request);
  if (context.response) return context.response;

  const url = new URL(request.url);
  const libraryId = url.searchParams.get('libraryId') || '';
  const mediaId = String(params?.mediaId || '').trim();
  const variant = String(params?.variant || '').trim();
  if (!libraryId || !mediaId || !VARIANTS.has(variant)) {
    return Response.json({ ok: false, error: 'libraryId, mediaId, and valid variant are required.' }, { status: 400 });
  }

  let media = null;
  try {
    media = await mediaForUser(context.supabase, context.user.id, libraryId, mediaId);
  } catch (error) {
    return apiError(error);
  }
  if (!media) return Response.json({ ok: false, error: 'Media not found.' }, { status: 404 });

  const storagePath = variant === 'thumb'
    ? media.thumb_storage_path
    : variant === 'preview'
      ? media.preview_storage_path
      : media.original_storage_path;
  const bucket = variant === 'full' ? 'media-originals' : 'media-derivatives';

  if (storagePath && (variant !== 'full' || media.original_in_cloud)) {
    try {
      const signedUrl = await signedStorageRedirect(context.supabase, bucket, storagePath);
      if (signedUrl) return Response.redirect(signedUrl, 302);
    } catch (error) {
      return apiError(error);
    }
  }

  const now = Date.now();
  const hostLocation = (media.media_locations || []).find((location) => {
    const host = location.devices || {};
    const expiresAt = Date.parse(host.host_relay_expires_at || '');
    return location.availability === 'available'
      && host.can_use_desktop_host
      && host.host_url
      && host.host_relay_token
      && (!expiresAt || expiresAt > now);
  });
  const host = hostLocation?.devices;
  const relayToken = String(host?.host_relay_token || '');
  const hostUrl = String(host?.host_url || '');
  const expiresAt = Date.parse(host?.host_relay_expires_at || '');
  if (!hostUrl || !relayToken || (expiresAt && expiresAt <= Date.now())) {
    return Response.json({
      ok: false,
      error: 'Desktop host unavailable.',
      availability: 'desktop-offline'
    }, { status: 424 });
  }

  try {
    const upstream = await fetch(relayUrl(host, variant, hostLocation.local_media_id || media.local_media_id || media.id), {
      headers: {
        'x-book-of-life-relay-token': relayToken
      }
    });
    if (!upstream.ok) {
      return Response.json({
        ok: false,
        error: upstream.status === 410 ? 'Original media is unavailable on the desktop.' : 'Desktop host could not serve this media.',
        availability: upstream.status === 410 ? 'original-unavailable' : 'desktop-error'
      }, { status: upstream.status === 410 ? 410 : 502 });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
        'Cache-Control': variant === 'full' ? 'private, max-age=300' : 'private, max-age=86400'
      }
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: 'Desktop host unavailable.',
      availability: 'desktop-offline'
    }, { status: 424 });
  }
}
