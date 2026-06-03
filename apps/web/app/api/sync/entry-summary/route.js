import { apiError, requireUser } from '../../../../lib/supabase-api.js';

const ENTRY_CHANGE_TYPES = ['entry.upsert', 'entry.delete'];

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

  const latest = await context.supabase
    .from('sync_changes')
    .select('id, changed_at')
    .eq('library_id', libraryId)
    .in('change_type', ENTRY_CHANGE_TYPES)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest.error) return apiError(latest.error);

  const count = await context.supabase
    .from('sync_changes')
    .select('id', { count: 'exact', head: true })
    .eq('library_id', libraryId)
    .in('change_type', ENTRY_CHANGE_TYPES);

  if (count.error) return apiError(count.error);

  return Response.json({
    ok: true,
    cursor: Number(latest.data?.id || 0),
    latestChangedAt: latest.data?.changed_at || '',
    changeCount: Number(count.count || 0)
  });
}
