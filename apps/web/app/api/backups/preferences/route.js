import { apiError, requireUser } from '../../../../lib/supabase-api.js';

async function ownsLibrary(supabase, userId, libraryId) {
  const result = await supabase.from('libraries').select('id').eq('id', libraryId).eq('owner_user_id', userId).maybeSingle();
  if (result.error) throw result.error;
  return Boolean(result.data);
}

function toPreference(row = {}) {
  return {
    libraryId: row.library_id || '',
    deviceId: row.device_id || '',
    cloudOriginalsEnabled: Boolean(row.cloud_originals_enabled),
    desktopBackupEnabled: Boolean(row.desktop_backup_enabled),
    desktopTargetDeviceId: row.desktop_target_device_id || '',
    allowMobileData: Boolean(row.allow_mobile_data),
    initialBootstrapCompletedAt: row.initial_bootstrap_completed_at || '',
    updatedAt: row.updated_at || ''
  };
}

export async function GET(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;
  const url = new URL(request.url);
  const libraryId = url.searchParams.get('libraryId') || '';
  const deviceId = url.searchParams.get('deviceId') || '';
  if (!libraryId || !deviceId) return Response.json({ ok: false, error: 'libraryId and deviceId are required.' }, { status: 400 });
  const result = await context.supabase.from('device_backup_preferences').select('*').eq('library_id', libraryId).eq('device_id', deviceId).maybeSingle();
  if (result.error) return apiError(result.error);
  return Response.json({ ok: true, preferences: toPreference(result.data || { library_id: libraryId, device_id: deviceId }) });
}

export async function POST(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;
  const body = await request.json().catch(() => ({}));
  const libraryId = String(body.libraryId || '');
  const deviceId = String(body.deviceId || '');
  if (!libraryId || !deviceId || !(await ownsLibrary(context.supabase, context.user.id, libraryId))) {
    return Response.json({ ok: false, error: 'Library and device are required.' }, { status: 400 });
  }
  const payload = {
    library_id: libraryId,
    device_id: deviceId,
    cloud_originals_enabled: Boolean(body.cloudOriginalsEnabled),
    desktop_backup_enabled: Boolean(body.desktopBackupEnabled),
    desktop_target_device_id: body.desktopBackupEnabled && body.desktopTargetDeviceId ? body.desktopTargetDeviceId : null,
    allow_mobile_data: Boolean(body.allowMobileData),
    initial_bootstrap_completed_at: body.initialBootstrapCompleted ? new Date().toISOString() : (body.initialBootstrapCompletedAt || null),
    updated_at: new Date().toISOString()
  };
  const result = await context.supabase.from('device_backup_preferences').upsert(payload, { onConflict: 'library_id,device_id' }).select('*').single();
  if (result.error) return apiError(result.error);
  return Response.json({ ok: true, preferences: toPreference(result.data) });
}
