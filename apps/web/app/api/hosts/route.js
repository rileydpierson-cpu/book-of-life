import { apiError, requireUser } from '../../../lib/supabase-api.js';

export async function GET(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;
  const url = new URL(request.url);
  const libraryId = url.searchParams.get('libraryId') || '';
  if (!libraryId) return Response.json({ ok: false, error: 'libraryId is required.' }, { status: 400 });

  const library = await context.supabase
    .from('libraries')
    .select('id')
    .eq('id', libraryId)
    .eq('owner_user_id', context.user.id)
    .maybeSingle();
  if (library.error) return apiError(library.error);
  if (!library.data) return Response.json({ ok: false, error: 'Library not found.' }, { status: 404 });

  const { data, error } = await context.supabase
    .from('devices')
    .select('*')
    .eq('library_id', libraryId)
    .eq('device_type', 'desktop')
    .eq('can_use_desktop_host', true)
    .not('host_url', 'eq', '')
    .order('last_seen_at', { ascending: false });
  if (error) return apiError(error);
  const now = Date.now();
  const hosts = (data || []).filter((host) => {
    const expiresAt = Date.parse(host.host_relay_expires_at || '');
    return !expiresAt || expiresAt > now;
  });
  return Response.json({ ok: true, hosts });
}
