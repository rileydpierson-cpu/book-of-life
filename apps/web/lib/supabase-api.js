import { createClient, isServerSupabaseConfigured } from '../utils/supabase/server.js';

export function setupResponse() {
  return Response.json({
    ok: false,
    setupRequired: true,
    error: 'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.'
  }, { status: 503 });
}

export async function requireUser() {
  if (!isServerSupabaseConfigured()) return { response: setupResponse() };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return {
      response: Response.json({ ok: false, error: 'Sign in required.' }, { status: 401 })
    };
  }
  return { supabase, user: data.user };
}

export function apiError(error, fallback = 'Request failed.') {
  const message = typeof error === 'string' ? error : (error?.message || fallback);
  if (
    message.includes("Could not find the table 'public.") ||
    message.includes('schema cache') ||
    error?.code === 'PGRST205'
  ) {
    return Response.json({
      ok: false,
      setupRequired: true,
      error: 'The Supabase database schema has not been installed or the API schema cache has not refreshed yet. Run services/cloud-api/schema.sql in the Supabase SQL Editor, then run `notify pgrst, \'reload schema\';`.'
    }, { status: 503 });
  }
  return Response.json({ ok: false, error: message }, { status: 500 });
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
