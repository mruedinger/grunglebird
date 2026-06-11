import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { jsonError } from '../../../../lib/api-utils';
import { type AuthEnv, requireAdmin } from '../../../../lib/auth';
import { validateRecipe } from '../../../../lib/recipes';

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

  const v = validateRecipe(body);
  if ('error' in v) return jsonError(400, v.error);

  const existing = await env.DB.prepare(`SELECT id FROM recipes WHERE id = ?`)
    .bind(id)
    .first<{ id: number }>();
  if (!existing) return jsonError(404, 'Recipe not found');

  // One transactional batch: update the recipe, then replace its lines wholesale —
  // positions are re-derived from the submitted order, so they stay 0..n-1 unique.
  const stmts = [
    env.DB.prepare(
      `UPDATE recipes SET name = ?, micro = ?, type = ?, character = ?, method = ?, notes = ?
       WHERE id = ?`,
    ).bind(v.name, v.micro, v.type, v.character, v.method, v.notes, id),
    env.DB.prepare(`DELETE FROM recipe_lines WHERE recipe_id = ?`).bind(id),
    ...v.lines.map((l, i) =>
      env.DB.prepare(
        `INSERT INTO recipe_lines (recipe_id, ingredient_id, amount, unit, is_garnish, position)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(id, l.ingredient_id, l.amount, l.unit, l.is_garnish ? 1 : 0, i),
    ),
  ];

  try {
    await env.DB.batch(stmts);
  } catch (e) {
    const msg = String((e as Error).message);
    if (msg.includes('UNIQUE')) return jsonError(409, 'A recipe with that name already exists.');
    if (msg.includes('FOREIGN KEY')) {
      return jsonError(400, 'One of the ingredients no longer exists. Reload and try again.');
    }
    throw e;
  }

  return Response.json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, params }) => {
  const denied = await requireAdmin(request, env as AuthEnv);
  if (denied) return denied;

  const id = Number(params.id);
  if (!Number.isInteger(id)) return jsonError(400, 'Invalid id');

  // recipe_lines cascade with the recipe.
  await env.DB.prepare(`DELETE FROM recipes WHERE id = ?`).bind(id).run();
  return Response.json({ ok: true });
};
