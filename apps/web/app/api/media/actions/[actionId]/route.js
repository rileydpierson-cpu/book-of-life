import { apiError, requireUser } from '../../../../../lib/supabase-api.js';

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

export async function PATCH(request, { params }) {
  const context = await requireUser(request);
  if (context.response) return context.response;
  const body = await request.json().catch(() => ({}));
  const libraryId = String(body.libraryId || '').trim();
  const actionId = String(params?.actionId || '').trim();
  const status = ['applied', 'failed', 'pending'].includes(body.status) ? body.status : '';
  if (!libraryId || !actionId || !status) {
    return Response.json({ ok: false, error: 'libraryId, actionId, and status are required.' }, { status: 400 });
  }
  if (!(await ownsLibrary(context.supabase, context.user.id, libraryId))) {
    return Response.json({ ok: false, error: 'Library not found.' }, { status: 404 });
  }
  const { data, error } = await context.supabase
    .from('media_actions')
    .update({
      status,
      result: body.result && typeof body.result === 'object' ? body.result : {},
      updated_at: new Date().toISOString()
    })
    .eq('id', actionId)
    .eq('library_id', libraryId)
    .select('*')
    .maybeSingle();
  if (error) return apiError(error);
  if (!data) return Response.json({ ok: false, error: 'Action not found.' }, { status: 404 });

  if (data.media_id) {
    await context.supabase.from('sync_changes').insert({
      library_id: libraryId,
      change_type: 'media.upsert',
      entity_id: data.media_id,
      payload: {
        media: {
          id: data.media_id,
          actionStatus: status,
          actionId
        }
      }
    });
  }
  return Response.json({ ok: true, action: data });
}
