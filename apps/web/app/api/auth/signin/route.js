import { normalizeSession, supabaseAuthFetch } from '../_supabase-auth.js';

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  if (!email || !password) {
    return Response.json({ ok: false, error: 'Email and password are required.' }, { status: 400 });
  }

  const result = await supabaseAuthFetch('/auth/v1/token?grant_type=password', { email, password });
  if (result.response) return result.response;
  const normalized = normalizeSession(result.payload, email);
  return Response.json({ ok: true, ...normalized });
}
