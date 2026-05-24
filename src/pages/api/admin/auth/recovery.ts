import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { enforceRateLimit, jsonError } from '../../../../lib/api-utils';
import { type AuthEnv, consumeRecovery, setSessionCookie } from '../../../../lib/auth';

const authEnv = env as AuthEnv;

export const POST: APIRoute = async ({ request }) => {
  const limited = await enforceRateLimit(request, authEnv, 'admin:recovery', 5, 60 * 15);
  if (limited) return limited;

  let body: { code?: unknown };
  try {
    body = (await request.json()) as { code?: unknown };
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code) return jsonError(400, 'code is required');

  if (!(await consumeRecovery(authEnv, code))) {
    return jsonError(401, 'Invalid recovery code');
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json', 'set-cookie': await setSessionCookie(authEnv) },
  });
};
