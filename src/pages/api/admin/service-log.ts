import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { jsonError } from '../../../lib/api-utils';
import { type AuthEnv, requireAdmin } from '../../../lib/auth';
import { childInserts, identityUpserts, validateNight } from '../../../lib/service-log';

export const POST: APIRoute = async ({ request }) => {
  const denied = await requireAdmin(request, env as AuthEnv);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  const v = validateNight(body);
  if ('error' in v) return jsonError(400, v.error);

  // One transactional batch. Children resolve the new night id via MAX(id):
  // the batch is a single write transaction (SQLite is single-writer, nothing
  // interleaves) and AUTOINCREMENT ids are monotonic, so MAX(id) is exactly the
  // night inserted above.
  const results = await env.DB.batch([
    ...identityUpserts(env.DB, v),
    env.DB.prepare(
      `INSERT INTO service_nights (event_slug, service_date, opened_at, closed_at, notes)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(v.event_slug, v.service_date, v.opened_at, v.closed_at, v.notes),
    ...childInserts(env.DB, v, '(SELECT MAX(id) FROM service_nights)', []),
  ]);

  const id = results[v.guests.length + v.drinks.length]?.meta.last_row_id ?? null;
  return Response.json({ id }, { status: 201 });
};
