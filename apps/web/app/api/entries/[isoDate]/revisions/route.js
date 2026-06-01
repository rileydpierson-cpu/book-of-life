import { requireUser } from '../../../../../lib/supabase-admin.js';

export async function GET(request, { params }) {
  const context = await requireUser(request);
  if (context.response) return context.response;

  const url = new URL(request.url);
  const libraryId = url.searchParams.get('libraryId') || '';
  const { isoDate } = await params;
  if (!libraryId) {
    return Response.json({ ok: false, error: 'libraryId is required.' }, { status: 400 });
  }

  const library = await context.supabase
    .from('libraries')
    .select('id')
    .eq('id', libraryId)
    .eq('owner_user_id', context.user.id)
    .maybeSingle();
  if (library.error) return Response.json({ ok: false, error: library.error.message }, { status: 500 });
  if (!library.data) return Response.json({ ok: false, error: 'Library not found.' }, { status: 404 });

  const { data, error } = await context.supabase
    .from('entry_revisions')
    .select('*')
    .eq('library_id', libraryId)
    .eq('iso_date', isoDate)
    .order('superseded_at', { ascending: false });

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, revisions: data || [] });
}
