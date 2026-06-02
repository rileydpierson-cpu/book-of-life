import { normalizeSession, supabaseAuthFetch } from '../_supabase-auth.js';

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  if (!email || !password) {
    return Response.json({ ok: false, error: 'Email and password are required.' }, { status: 400 });
  }

  const signup = await supabaseAuthFetch('/auth/v1/signup', { email, password });
  if (signup.response) return signup.response;
  const signupSession = normalizeSession(signup.payload, email);
  if (signupSession.session.accessToken) {
    return Response.json({ ok: true, ...signupSession }, { status: 201 });
  }

  const signin = await supabaseAuthFetch('/auth/v1/token?grant_type=password', { email, password });
  if (signin.response) return signin.response;
  return Response.json({ ok: true, ...normalizeSession(signin.payload, email) }, { status: 201 });
}
