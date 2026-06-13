import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { jsonError } from '../../../../lib/api-utils';
import { type AuthEnv, requireAdmin } from '../../../../lib/auth';
import { childInserts, identityUpserts, validateNight } from '../../../../lib/service-log';

export const PATCH: APIRoute = async ({ request, params }) => {
  const denied = await requireAdmin(request, env as AuthEnv);
  if (denied) return denied;

  const id = Number(params.id);
  if (!Number.isInteger(id)) return jsonError(400, 'Invalid id');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  const v = validateNight(body);
  if ('error' in v) return jsonError(400, v.error);

  const existing = await env.DB.prepare(`SELECT id FROM service_nights WHERE id = ?`)
    .bind(id)
    .first<{ id: number }>();
  if (!existing) return jsonError(404, 'Night not found');

  // One transactional batch: update the night, then replace its children
  // wholesale (recipes pattern). Guest/drink identity rows are only ever added
  // to, never removed — they're shared across nights.
  await env.DB.batch([
    ...identityUpserts(env.DB, v),
    env.DB.prepare(
      `UPDATE service_nights SET service_date = ?, opened_at = ?, closed_at = ?, notes = ?
       WHERE id = ?`,
    ).bind(v.service_date, v.opened_at, v.closed_at, v.notes, id),
    env.DB.prepare(`DELETE FROM service_night_guests WHERE night_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM service_night_drinks WHERE night_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM service_night_guest_drinks WHERE night_id = ?`).bind(id),
    ...childInserts(env.DB, v, '?', [id]),
  ]);

  return Response.json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, params }) => {
  const denied = await requireAdmin(request, env as AuthEnv);
  if (denied) return denied;

  const id = Number(params.id);
  if (!Number.isInteger(id)) return jsonError(400, 'Invalid id');

  // Child rows cascade with the night; guest/drink identities stay.
  await env.DB.prepare(`DELETE FROM service_nights WHERE id = ?`).bind(id).run();
  return Response.json({ ok: true });
};
