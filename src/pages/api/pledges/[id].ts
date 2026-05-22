import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  clearEditCookie,
  enforceRateLimit,
  jsonError,
  parseEditCookie,
  validatePledge,
} from '../../../lib/api-utils';

export const PATCH: APIRoute = async ({ request, params }) => {
  const id = Number(params.id);
  const cookie = parseEditCookie(request);
  if (!cookie || cookie.id !== id) return jsonError(403, 'Not allowed');

  const rateLimited = await enforceRateLimit(request, env, 'pledge:edit', 20, 60 * 60);
  if (rateLimited) return rateLimited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  const v = validatePledge(body);
  if ('error' in v) return jsonError(400, v.error);

  const result = await env.DB.prepare(
    `UPDATE pledges
     SET name = ?, amount_cents = ?, venmo_handle = ?, is_private = ?
     WHERE id = ? AND edit_token = ?`,
  )
    .bind(v.name, v.amount_cents, v.venmo_handle, v.is_private ? 1 : 0, id, cookie.token)
    .run();

  if (result.meta.changes === 0) return jsonError(403, 'Not allowed');
  return Response.json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, params }) => {
  const id = Number(params.id);
  const cookie = parseEditCookie(request);
  if (!cookie || cookie.id !== id) return jsonError(403, 'Not allowed');

  const result = await env.DB.prepare(
    `DELETE FROM pledges WHERE id = ? AND edit_token = ?`,
  )
    .bind(id, cookie.token)
    .run();

  if (result.meta.changes === 0) return jsonError(403, 'Not allowed');

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json', 'set-cookie': clearEditCookie() },
  });
};
