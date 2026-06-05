import { apiError, requireUser } from '../../../../lib/supabase-api.js';

const VARIANTS = new Set(['thumb', 'preview']);

function safeFileName(value, fallback) {
  return String(value || fallback)
    .replace(/[\\/]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 160) || fallback;
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
  const variant = String(body.variant || '').trim();
  if (!libraryId || !mediaId || !VARIANTS.has(variant)) {
    return Response.json({ ok: false, error: 'libraryId, mediaId, and valid variant are required.' }, { status: 400 });
  }
  if (!(await ownsLibrary(context.supabase, context.user.id, libraryId))) {
    return Response.json({ ok: false, error: 'Library not found.' }, { status: 404 });
  }

  const fallback = variant === 'thumb' ? 'thumb.webp' : 'preview.webm';
  const fileName = safeFileName(body.fileName, fallback);
  const objectPath = `libraries/${libraryId}/media/${mediaId}/derivatives/${variant}-${fileName}`;
  const { data, error } = await context.supabase
    .storage
    .from('media-derivatives')
    .createSignedUploadUrl(objectPath, { upsert: true });

  if (error) return apiError(error);
  return Response.json({
    ok: true,
    bucket: 'media-derivatives',
    objectPath,
    signedUrl: data?.signedUrl || '',
    token: data?.token || ''
  });
}
