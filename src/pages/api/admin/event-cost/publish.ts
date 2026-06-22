import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { jsonError } from '../../../../lib/api-utils';
import { type AuthEnv, requireAdmin } from '../../../../lib/auth';
import { loadEventCostData, rollupFromLoaded } from '../../../../lib/event-cost';

export const POST: APIRoute = async ({ request }) => {
  const denied = await requireAdmin(request, env as AuthEnv);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const event_slug = String(b.event_slug ?? '').trim();
  if (!event_slug || event_slug.length > 80) return jsonError(400, 'Event slug is required.');
  const enabled = b.enabled === true;

  if (!enabled) {
    await env.DB.prepare(
      `INSERT INTO event_cost_settings (event_slug, public_total_enabled) VALUES (?, 0)
       ON CONFLICT(event_slug) DO UPDATE SET public_total_enabled = 0`,
    ).bind(event_slug).run();
    return Response.json({ ok: true });
  }

  // Resolved gate: never snapshot an undercounted total. The UI hides publish behind the same gate,
  // but a direct POST — or a stale tab opened before a new drink was logged — must not slip through.
  const data = await loadEventCostData(env.DB, event_slug);
  const resolved = new Set(
    [...data.resolutions].filter(([, r]) => r.recipeId != null || r.dismissed).map(([id]) => id),
  );
  const allResolved = data.drinks.length > 0 && data.drinks.every((d) => resolved.has(d.id));
  if (!allResolved) return jsonError(400, 'Resolve every logged drink before publishing the total.');

  // Compute the snapshot from the same path the admin view uses, so they can't drift.
  const rollup = rollupFromLoaded(data);
  await env.DB.prepare(
    `INSERT INTO event_cost_settings
       (event_slug, public_total_enabled, public_known_cents, public_is_partial, public_updated_at)
     VALUES (?, 1, ?, ?, ?)
     ON CONFLICT(event_slug) DO UPDATE SET
       public_total_enabled = 1,
       public_known_cents = excluded.public_known_cents,
       public_is_partial = excluded.public_is_partial,
       public_updated_at = excluded.public_updated_at`,
  )
    .bind(event_slug, rollup.grandKnownCents, rollup.partial ? 1 : 0, Math.floor(Date.now() / 1000))
    .run();

  return Response.json({ ok: true });
};
