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

export async function DELETE(request, { params }) {
  const context = await requireUser(request);
  if (context.response) return context.response;
  const body = await request.json().catch(() => ({}));
  const libraryId = String(body.libraryId || '').trim();
  const mediaId = String(params?.mediaId || '').trim();
  if (!libraryId || !mediaId) {
    return Response.json({ ok: false, error: 'libraryId and mediaId are required.' }, { status: 400 });
  }
  if (!(await ownsLibrary(context.supabase, context.user.id, libraryId))) {
    return Response.json({ ok: false, error: 'Library not found.' }, { status: 404 });
  }

  const { data, error } = await context.supabase
    .from('media_items')
    .delete()
    .eq('library_id', libraryId)
    .or(`id.eq.${mediaId},local_media_id.eq.${mediaId}`)
    .select('id')
    .maybeSingle();
  if (error) return apiError(error);

  await context.supabase.from('sync_changes').insert({
    library_id: libraryId,
    change_type: 'media.delete',
    entity_id: data?.id || mediaId,
    payload: { photoId: data?.id || mediaId, deleted: true }
  });

  return Response.json({ ok: true, deleted: Boolean(data), mediaId: data?.id || mediaId });
}
