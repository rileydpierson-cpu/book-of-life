import { requireUser } from '../../../lib/supabase-api.js';

export async function GET(request) {
  const context = await requireUser(request);
  if (context.response) return context.response;
  return Response.json({
    ok: true,
    user: {
      id: context.user.id,
      email: context.user.email || ''
    }
  });
}
