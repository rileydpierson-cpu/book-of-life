import { apiError, requireUser } from '../../../../lib/supabase-api.js';

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
  const since = Math.max(0, Number(url.searchParams.get('since') || 0));
  if (!libraryId) return Response.json({ ok: false, error: 'libraryId is required.' }, { status: 400 });
  if (!(await ownsLibrary(context.supabase, context.user.id, libraryId))) {
    return Response.json({ ok: false, error: 'Library not found.' }, { status: 404 });
  }

  const { data, error } = await context.supabase
    .from('sync_changes')
    .select('*')
    .eq('library_id', libraryId)
    .gt('id', since)
    .order('id', { ascending: true })
    .limit(500);

  if (error) return apiError(error);
  const changes = data || [];
  const cursor = changes.reduce((max, change) => Math.max(max, Number(change.id || 0)), since);
  return Response.json({ ok: true, cursor, changes });
}
