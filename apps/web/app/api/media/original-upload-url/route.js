import { apiError, requireUser } from '../../../../lib/supabase-api.js';

function safeFileName(value) {
  return String(value || 'media')
    .replace(/[\\/]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 160) || 'media';
}

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

export async function POST(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;

  const body = await request.json().catch(() => ({}));
  const libraryId = String(body.libraryId || '').trim();
  const mediaId = String(body.mediaId || '').trim();
  const fileName = safeFileName(body.fileName);
  if (!libraryId || !mediaId) {
    return Response.json({ ok: false, error: 'libraryId and mediaId are required.' }, { status: 400 });
  }
  if (!(await ownsLibrary(context.supabase, context.user.id, libraryId))) {
    return Response.json({ ok: false, error: 'Library not found.' }, { status: 404 });
  }

  const objectPath = `libraries/${libraryId}/media/${mediaId}/${fileName}`;
  const { data, error } = await context.supabase
    .storage
    .from('media-originals')
    .createSignedUploadUrl(objectPath, { upsert: true });

  if (error) return apiError(error);
  return Response.json({
    ok: true,
    bucket: 'media-originals',
    objectPath,
    signedUrl: data?.signedUrl || '',
    token: data?.token || ''
  });
}
