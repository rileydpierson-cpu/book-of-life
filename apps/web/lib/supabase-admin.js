import { createClient } from '@supabase/supabase-js';

export function getSupabaseConfig() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  };
}

export function isSupabaseConfigured() {
  const config = getSupabaseConfig();
  return Boolean(config.url && config.anonKey && config.serviceRoleKey);
}

export function createSupabaseAdmin() {
  const config = getSupabaseConfig();
  if (!isSupabaseConfigured()) return null;
  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export function setupResponse() {
  return Response.json({
    ok: false,
    setupRequired: true,
    error: 'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.'
  }, { status: 503 });
}

export async function requireUser(request) {
  const supabase = createSupabaseAdmin();
  if (!supabase) return { response: setupResponse() };

  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return {
      response: Response.json({ ok: false, error: 'Missing bearer token.' }, { status: 401 })
    };
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return {
      response: Response.json({ ok: false, error: 'Invalid or expired session.' }, { status: 401 })
    };
  }
  return { supabase, user: data.user };
}

export function toEntry(row) {
  return {
    libraryId: row.library_id,
    isoDate: row.iso_date,
    raw: row.raw || '',
    cloudVersion: Number(row.cloud_version || 0),
    updatedAt: row.updated_at,
    updatedByDeviceId: row.updated_by_device_id || ''
  };
}

export function toLibrary(row) {
  return {
    id: row.id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
