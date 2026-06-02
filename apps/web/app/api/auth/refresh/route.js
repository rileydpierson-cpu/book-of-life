import { normalizeSession, supabaseAuthFetch } from '../_supabase-auth.js';

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const refreshToken = String(body.refreshToken || body.refresh_token || '').trim();
  if (!refreshToken) {
    return Response.json({ ok: false, error: 'refreshToken is required.' }, { status: 400 });
  }

  const result = await supabaseAuthFetch('/auth/v1/token?grant_type=refresh_token', { refresh_token: refreshToken });
  if (result.response) return result.response;
  return Response.json({ ok: true, ...normalizeSession(result.payload) });
}
