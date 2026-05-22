import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { jsonError, parseEditCookie } from '../../../lib/api-utils';

export const GET: APIRoute = async ({ request }) => {
  const cookie = parseEditCookie(request);
  if (!cookie) return jsonError(404, 'No pledge for this browser');

  const row = await env.DB.prepare(
    `SELECT id, name, amount_cents, venmo_handle, is_private
     FROM pledges
     WHERE id = ? AND edit_token = ?`,
  )
    .bind(cookie.id, cookie.token)
    .first();

  if (!row) return jsonError(404, 'No pledge for this browser');
  return Response.json(row);
};
