import { apiError, requireUser } from '../../../../lib/supabase-api.js';
import { computeCloudStorageUsage } from '../../../../lib/storage-usage.js';

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

  const { data, error } = await context.supabase
    .from('media_items')
    .select('original_size')
    .eq('library_id', libraryId)
    .eq('original_in_cloud', true);
  if (error) return apiError(error);

  return Response.json({
    ok: true,
    storage: computeCloudStorageUsage(data || [])
  });
}
