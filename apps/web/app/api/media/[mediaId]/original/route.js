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

export async function DELETE(request, { params }) {
  const context = await requireUser(request);
  if (context.response) return context.response;
  const body = await request.json().catch(() => ({}));
  const libraryId = String(body.libraryId || '').trim();
  const mediaId = String(params?.mediaId || '').trim();
  const storagePath = String(body.storagePath || '').trim();
  if (!libraryId) return Response.json({ ok: false, error: 'libraryId is required.' }, { status: 400 });
  if (!(await ownsLibrary(context.supabase, context.user.id, libraryId))) {
    return Response.json({ ok: false, error: 'Library not found.' }, { status: 404 });
  }

  let query = context.supabase
    .from('media_items')
    .update({
      original_in_cloud: false,
      original_storage_path: '',
      original_size: 0,
      updated_at: new Date().toISOString()
    })
    .eq('library_id', libraryId);

  query = storagePath
    ? query.eq('original_storage_path', storagePath)
    : query.eq('id', mediaId);

  const { error } = await query;
  if (error) return apiError(error);

  if (storagePath) {
    const storage = await context.supabase.storage.from('media-originals').remove([storagePath]);
    if (storage.error) return apiError(storage.error);
  }

  return Response.json({ ok: true, deleted: Boolean(storagePath) });
}
