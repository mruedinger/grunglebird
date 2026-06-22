import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { jsonError } from '../../../../lib/api-utils';
import { type AuthEnv, requireAdmin } from '../../../../lib/auth';
import { validatePricing } from '../../../../lib/event-cost';

export const POST: APIRoute = async ({ request }) => {
  const denied = await requireAdmin(request, env as AuthEnv);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  const v = validatePricing(body);
  if ('error' in v) return jsonError(400, v.error);

  // Confirm every overridden ingredient exists (a friendly 400 rather than an FK-violation 500).
  if (v.overrides.length > 0) {
    const ids = v.overrides.map((o) => o.ingredient_id);
    const marks = ids.map(() => '?').join(',');
    const found = await env.DB.prepare(`SELECT id FROM ingredients WHERE id IN (${marks})`)
      .bind(...ids)
      .all<{ id: number }>();
    const foundIds = new Set(found.results.map((r) => r.id));
    for (const id of ids) if (!foundIds.has(id)) return jsonError(400, 'Unknown ingredient in an override.');
  }

  // One batch: keep the pseudo-juice setting (leaving the publish snapshot untouched), then replace
  // this event's overrides + incidentals wholesale — the recipes/service-log pattern.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO event_cost_settings (event_slug, use_pseudo_juice) VALUES (?, ?)
       ON CONFLICT(event_slug) DO UPDATE SET use_pseudo_juice = excluded.use_pseudo_juice`,
    ).bind(v.event_slug, v.use_pseudo_juice ? 1 : 0),
    env.DB.prepare(`DELETE FROM event_ingredient_prices WHERE event_slug = ?`).bind(v.event_slug),
    ...v.overrides.map((o) =>
      env.DB.prepare(
        `INSERT INTO event_ingredient_prices (event_slug, ingredient_id, purchase_amount, purchase_unit, purchase_price_cents)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(v.event_slug, o.ingredient_id, o.purchase_amount, o.purchase_unit, o.purchase_price_cents),
    ),
    env.DB.prepare(`DELETE FROM event_incidentals WHERE event_slug = ?`).bind(v.event_slug),
    ...v.incidentals.map((i) =>
      env.DB.prepare(`INSERT INTO event_incidentals (event_slug, label, amount_cents) VALUES (?, ?, ?)`)
        .bind(v.event_slug, i.label, i.amount_cents),
    ),
  ]);

  return Response.json({ ok: true });
};
