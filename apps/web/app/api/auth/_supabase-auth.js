import { isServerSupabaseConfigured } from '../../../utils/supabase/server.js';
import { setupResponse } from '../../../lib/supabase-api.js';

function authConfig() {
  if (!isServerSupabaseConfigured()) return null;
  return {
    url: String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, ''),
    key: String(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '')
  };
}

export function normalizeSession(payload, fallbackEmail = '') {
  const session = payload?.session || payload;
  const user = payload?.user || session?.user || null;
  const expiresIn = Number(session?.expires_in || 3600);
  return {
    user,
    session: {
      accessToken: session?.access_token || '',
      refreshToken: session?.refresh_token || '',
      expiresAt: session?.expires_at || Math.floor(Date.now() / 1000) + expiresIn,
      email: user?.email || fallbackEmail
    }
  };
}

export async function supabaseAuthFetch(pathname, body) {
  const config = authConfig();
  if (!config) return { response: setupResponse() };
  const response = await fetch(`${config.url}${pathname}`, {
    method: 'POST',
    headers: {
      apikey: config.key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body || {})
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.msg || payload?.message || payload?.error_description || payload?.error || `Authentication failed (${response.status}).`;
    return { response: Response.json({ ok: false, error: message }, { status: response.status }) };
  }
  return { payload };
}
