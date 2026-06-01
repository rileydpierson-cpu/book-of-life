import { apiError, requireUser, toLibrary } from '../../../lib/supabase-api.js';

export async function GET(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;

  const { data, error } = await context.supabase
    .from('libraries')
    .select('*')
    .eq('owner_user_id', context.user.id)
    .order('created_at', { ascending: true });

  if (error) {
    return apiError(error);
  }
  return Response.json({ ok: true, libraries: (data || []).map(toLibrary) });
}

export async function POST(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || 'Book of Life').trim() || 'Book of Life';

  const existing = await context.supabase
    .from('libraries')
    .select('*')
    .eq('owner_user_id', context.user.id)
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    return apiError(existing.error);
  }
  if (existing.data) {
    return Response.json({ ok: true, library: toLibrary(existing.data), existing: true });
  }

  const { data, error } = await context.supabase
    .from('libraries')
    .insert({ owner_user_id: context.user.id, name })
    .select('*')
    .single();

  if (error) {
    return apiError(error);
  }
  return Response.json({ ok: true, library: toLibrary(data), existing: false }, { status: 201 });
}
