import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { jsonError, requireAccess } from '../../../../lib/api-utils';

export const PATCH: APIRoute = async ({ request, params }) => {
  const denied = requireAccess(request, env);
  if (denied) return denied;

  const id = Number(params.id);
  let body: { is_paid?: unknown };
  try {
    body = (await request.json()) as { is_paid?: unknown };
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  if (typeof body.is_paid !== 'boolean') {
    return jsonError(400, 'is_paid (boolean) is required');
  }

  await env.DB.prepare(`UPDATE pledges SET is_paid = ? WHERE id = ?`)
    .bind(body.is_paid ? 1 : 0, id)
    .run();

  return Response.json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, params }) => {
  const denied = requireAccess(request, env);
  if (denied) return denied;

  await env.DB.prepare(`DELETE FROM pledges WHERE id = ?`).bind(Number(params.id)).run();
  return Response.json({ ok: true });
};
