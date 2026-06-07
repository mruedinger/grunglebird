import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { jsonError } from '../../../lib/api-utils';
import { type AuthEnv, requireAdmin } from '../../../lib/auth';
import { validateIngredient } from '../../../lib/ingredients';

export const POST: APIRoute = async ({ request }) => {
  const denied = await requireAdmin(request, env as AuthEnv);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  const v = validateIngredient(body);
  if ('error' in v) return jsonError(400, v.error);

  // price_updated_at tracks when the price was last set, for the staleness signal.
  const priceUpdatedAt = v.purchase_price_cents !== null ? Math.floor(Date.now() / 1000) : null;

  try {
    const row = await env.DB.prepare(
      `INSERT INTO ingredients
         (name, category, default_unit, purchase_amount, purchase_unit, purchase_price_cents, price_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
      .bind(
        v.name,
        v.category,
        v.default_unit,
        v.purchase_amount,
        v.purchase_unit,
        v.purchase_price_cents,
        priceUpdatedAt,
      )
      .first<{ id: number }>();

    if (!row) return jsonError(500, 'Failed to save ingredient');
    return Response.json({ id: row.id }, { status: 201 });
  } catch (e) {
    if (String((e as Error).message).includes('UNIQUE')) {
      return jsonError(409, 'An ingredient with that name already exists.');
    }
    throw e;
  }
};
