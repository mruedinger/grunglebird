import type { APIRoute } from 'astro';
import { clearSessionCookie } from '../../../../lib/auth';

export const POST: APIRoute = async () => {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json', 'set-cookie': clearSessionCookie() },
  });
};
