import { isServerSupabaseConfigured } from '../../../utils/supabase/server.js';

export async function GET() {
  return Response.json({
    ok: true,
    service: 'book-of-life-web',
    supabaseConfigured: isServerSupabaseConfigured()
  });
}
