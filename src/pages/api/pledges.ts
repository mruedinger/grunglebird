import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  enforceRateLimit,
  jsonError,
  setEditCookie,
  validatePledge,
} from '../../lib/api-utils';

export const GET: APIRoute = async () => {
  const { results } = await env.DB.prepare(
    `SELECT id,
            CASE WHEN is_private = 1 THEN NULL ELSE name END AS name,
            amount_cents,
            is_private
     FROM pledges
     ORDER BY created_at DESC`,
  ).all<{ id: number; name: string | null; amount_cents: number; is_private: 0 | 1 }>();

  const total = results.reduce((sum, p) => sum + p.amount_cents, 0);
  return Response.json({ pledges: results, total_cents: total });
};

export const POST: APIRoute = async ({ request }) => {
  const rateLimited = await enforceRateLimit(request, env, 'pledge:create', 20, 60 * 60);
  if (rateLimited) return rateLimited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  const v = validatePledge(body);
  if ('error' in v) return jsonError(400, v.error);

  const editToken = crypto.randomUUID();
  const row = await env.DB.prepare(
    `INSERT INTO pledges (name, amount_cents, venmo_handle, is_private, edit_token)
     VALUES (?, ?, ?, ?, ?)
     RETURNING id`,
  )
    .bind(v.name, v.amount_cents, v.venmo_handle, v.is_private ? 1 : 0, editToken)
    .first<{ id: number }>();

  if (!row) return jsonError(500, 'Failed to save pledge');

  return new Response(JSON.stringify({ id: row.id }), {
    status: 201,
    headers: {
      'content-type': 'application/json',
      'set-cookie': setEditCookie(row.id, editToken),
    },
  });
};
