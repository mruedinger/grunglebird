import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { jsonError } from '../../../lib/api-utils';
import { type AuthEnv, requireAdmin } from '../../../lib/auth';
import { validateRecipe } from '../../../lib/recipes';

export const POST: APIRoute = async ({ request }) => {
  const denied = await requireAdmin(request, env as AuthEnv);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  const v = validateRecipe(body);
  if ('error' in v) return jsonError(400, v.error);

  // One transactional batch: the recipe insert plus its lines. Lines resolve the new
  // recipe id via the UNIQUE name (a mid-batch RETURNING can't feed later statements),
  // so a failure anywhere rolls the whole recipe back.
  const stmts = [
    env.DB.prepare(
      `INSERT INTO recipes (name, micro, type, character, method, notes, yield_amount, yield_unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(v.name, v.micro, v.type, v.character, v.method, v.notes, v.yield_amount, v.yield_unit),
    ...v.lines.map((l, i) =>
      env.DB.prepare(
        `INSERT INTO recipe_lines (recipe_id, ingredient_id, amount, unit, is_garnish, position)
         VALUES ((SELECT id FROM recipes WHERE name = ?), ?, ?, ?, ?, ?)`,
      ).bind(v.name, l.ingredient_id, l.amount, l.unit, l.is_garnish ? 1 : 0, i),
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

  const row = await env.DB.prepare(`SELECT id FROM recipes WHERE name = ?`)
    .bind(v.name)
    .first<{ id: number }>();
  return Response.json({ id: row?.id ?? null }, { status: 201 });
};
