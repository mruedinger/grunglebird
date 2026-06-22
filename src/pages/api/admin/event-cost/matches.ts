import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { jsonError } from '../../../../lib/api-utils';
import { type AuthEnv, requireAdmin } from '../../../../lib/auth';
import { validateResolutions } from '../../../../lib/event-cost';
import { CHARACTER_REQUIRED_TYPES } from '../../../../lib/recipes';

export const POST: APIRoute = async ({ request }) => {
  const denied = await requireAdmin(request, env as AuthEnv);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  const v = validateResolutions(body);
  if ('error' in v) return jsonError(400, v.error);

  // Domain cross-checks (mirrors the service-log attribution check, not just shape): every drink
  // must be one actually logged for this event, every match must be an existing drink-like recipe.
  const drinkTypeMarks = CHARACTER_REQUIRED_TYPES.map(() => '?').join(',');
  const [eventDrinks, drinkRecipes] = await Promise.all([
    env.DB.prepare(
      `SELECT DISTINCT nd.drink_id AS id
       FROM service_night_drinks nd
       JOIN service_nights n ON n.id = nd.night_id
       WHERE n.event_slug = ?`,
    ).bind(v.event_slug).all<{ id: number }>(),
    env.DB.prepare(`SELECT id FROM recipes WHERE type IN (${drinkTypeMarks})`)
      .bind(...CHARACTER_REQUIRED_TYPES)
      .all<{ id: number }>(),
  ]);
  const drinkIds = new Set(eventDrinks.results.map((r) => r.id));
  const recipeIds = new Set(drinkRecipes.results.map((r) => r.id));

  for (const r of v.resolutions) {
    if (!drinkIds.has(r.service_drink_id)) return jsonError(400, 'Unknown drink for this event.');
    if (r.recipe_id != null && !recipeIds.has(r.recipe_id)) return jsonError(400, 'A match must be a drink recipe.');
  }

  // Wholesale replace this event's resolutions — per-event scope makes that safe. Only resolved
  // rows (matched or dismissed) are persisted; an unmatched drink simply has no row.
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM event_drink_resolutions WHERE event_slug = ?`).bind(v.event_slug),
    ...v.resolutions.map((r) =>
      env.DB.prepare(
        `INSERT INTO event_drink_resolutions (event_slug, service_drink_id, recipe_id, dismissed)
         VALUES (?, ?, ?, ?)`,
      ).bind(v.event_slug, r.service_drink_id, r.recipe_id, r.dismissed ? 1 : 0),
    ),
  ]);

  return Response.json({ ok: true });
};
