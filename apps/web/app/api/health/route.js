import { isSupabaseConfigured } from '../../../lib/supabase-admin.js';

export async function GET() {
  return Response.json({
    ok: true,
    service: 'book-of-life-web',
    supabaseConfigured: isSupabaseConfigured()
  });
}
