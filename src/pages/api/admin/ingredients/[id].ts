import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { jsonError } from '../../../../lib/api-utils';
import { type AuthEnv, requireAdmin } from '../../../../lib/auth';
import { validateIngredient } from '../../../../lib/ingredients';

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

  const v = validateIngredient(body);
  if ('error' in v) return jsonError(400, v.error);

  const existing = await env.DB.prepare(
    `SELECT purchase_price_cents, price_updated_at FROM ingredients WHERE id = ?`,
  )
    .bind(id)
    .first<{ purchase_price_cents: number | null; price_updated_at: number | null }>();
  if (!existing) return jsonError(404, 'Ingredient not found');

  // Only bump the staleness timestamp when the price actually changes; otherwise an
  // unrelated edit (rename, recategorize) would make a stale price look fresh.
  const priceUpdatedAt =
    v.purchase_price_cents === existing.purchase_price_cents
      ? existing.price_updated_at
      : v.purchase_price_cents !== null
        ? Math.floor(Date.now() / 1000)
        : null;

  try {
    await env.DB.prepare(
      `UPDATE ingredients
         SET name = ?, category = ?, default_unit = ?, purchase_amount = ?,
             purchase_unit = ?, purchase_price_cents = ?, price_updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        v.name,
        v.category,
        v.default_unit,
        v.purchase_amount,
        v.purchase_unit,
        v.purchase_price_cents,
        priceUpdatedAt,
        id,
      )
      .run();
    return Response.json({ ok: true });
  } catch (e) {
    if (String((e as Error).message).includes('UNIQUE')) {
      return jsonError(409, 'An ingredient with that name already exists.');
    }
    throw e;
  }
};

export const DELETE: APIRoute = async ({ request, params }) => {
  const denied = await requireAdmin(request, env as AuthEnv);
  if (denied) return denied;

  const id = Number(params.id);
  if (!Number.isInteger(id)) return jsonError(400, 'Invalid id');

  await env.DB.prepare(`DELETE FROM ingredients WHERE id = ?`).bind(id).run();
  return Response.json({ ok: true });
};
