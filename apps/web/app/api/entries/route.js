import { requireUser, toEntry } from '../../../lib/supabase-admin.js';

function isValidIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

async function assertLibraryOwner(supabase, userId, libraryId) {
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
  if (!libraryId) {
    return Response.json({ ok: false, error: 'libraryId is required.' }, { status: 400 });
  }
  if (!(await assertLibraryOwner(context.supabase, context.user.id, libraryId))) {
    return Response.json({ ok: false, error: 'Library not found.' }, { status: 404 });
  }

  const { data, error } = await context.supabase
    .from('entries')
    .select('*')
    .eq('library_id', libraryId)
    .order('iso_date', { ascending: false });

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, entries: (data || []).map(toEntry) });
}

export async function POST(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;

  const body = await request.json().catch(() => ({}));
  const libraryId = String(body.libraryId || '').trim();
  const isoDate = String(body.isoDate || '').trim();
  const raw = typeof body.raw === 'string' ? body.raw : '';
  const deviceId = String(body.deviceId || '').trim() || null;

  if (!libraryId || !isValidIsoDate(isoDate)) {
    return Response.json({ ok: false, error: 'libraryId and valid isoDate are required.' }, { status: 400 });
  }
  if (!(await assertLibraryOwner(context.supabase, context.user.id, libraryId))) {
    return Response.json({ ok: false, error: 'Library not found.' }, { status: 404 });
  }

  const previous = await context.supabase
    .from('entries')
    .select('*')
    .eq('library_id', libraryId)
    .eq('iso_date', isoDate)
    .maybeSingle();

  if (previous.error) {
    return Response.json({ ok: false, error: previous.error.message }, { status: 500 });
  }

  const nextVersion = Number(previous.data?.cloud_version || 0) + 1;
  if (previous.data) {
    const revision = {
      library_id: libraryId,
      iso_date: isoDate,
      raw: previous.data.raw || '',
      cloud_version: previous.data.cloud_version,
      updated_by_device_id: previous.data.updated_by_device_id,
      updated_at: previous.data.updated_at,
      conflict: Boolean(body.baseCloudVersion && Number(body.baseCloudVersion) !== Number(previous.data.cloud_version))
    };
    const revisionResult = await context.supabase.from('entry_revisions').insert(revision);
    if (revisionResult.error) {
      return Response.json({ ok: false, error: revisionResult.error.message }, { status: 500 });
    }
  }

  const upsert = await context.supabase
    .from('entries')
    .upsert({
      library_id: libraryId,
      iso_date: isoDate,
      raw,
      cloud_version: nextVersion,
      updated_by_device_id: deviceId,
      updated_at: new Date().toISOString()
    }, { onConflict: 'library_id,iso_date' })
    .select('*')
    .single();

  if (upsert.error) {
    return Response.json({ ok: false, error: upsert.error.message }, { status: 500 });
  }

  await context.supabase.from('sync_changes').insert({
    library_id: libraryId,
    change_type: raw.trim() ? 'entry.upsert' : 'entry.delete',
    entity_id: isoDate,
    payload: { entry: toEntry(upsert.data) }
  });

  return Response.json({
    ok: true,
    entry: toEntry(upsert.data),
    conflict: Boolean(previous.data && body.baseCloudVersion && Number(body.baseCloudVersion) !== Number(previous.data.cloud_version))
  });
}
