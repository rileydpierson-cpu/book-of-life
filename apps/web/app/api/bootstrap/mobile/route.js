import { apiError, requireUser, toEntry, toMedia } from '../../../../lib/supabase-api.js';

export async function GET(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;
  const url = new URL(request.url);
  const libraryId = url.searchParams.get('libraryId') || '';
  const [entries, media, devices] = await Promise.all([
    context.supabase.from('entries').select('*').eq('library_id', libraryId).order('iso_date', { ascending: false }),
    context.supabase.from('media_items').select('*, media_locations(*, devices(device_name,device_type,last_seen_at)), media_actions(id,target_location_id,action_type,status,result), media_backup_transfers(*)').eq('library_id', libraryId),
    context.supabase.from('devices').select('*').eq('library_id', libraryId).order('created_at', { ascending: true })
  ]);
  const error = entries.error || media.error || devices.error;
  if (error) return apiError(error);
  const roots = (devices.data || []).map((device) => ({
    id: device.id,
    label: device.device_name || 'Unnamed device',
    deviceType: device.device_type,
    online: Date.now() - Date.parse(device.last_seen_at || 0) < 20 * 60 * 1000
  }));
  return Response.json({
    ok: true,
    entries: (entries.data || []).map(toEntry),
    media: (media.data || []).map(toMedia),
    devices: devices.data || [],
    folderRoots: roots
  });
}
