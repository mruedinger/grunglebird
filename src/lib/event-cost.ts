// Event-level cost reconciliation (issue #80). Three concerns, one module:
//  1. the MATCHER that maps a free-text logged drink name ("marg", "queens park swizle") to a
//     recipe in three tiers — auto (silent), confirm (suggested, admin adjudicates), missing;
//  2. the OVERLAY that applies the per-event pseudo-juice toggle + price overrides to the catalog
//     before costing (never mutating the shared `ingredients`);
//  3. the ROLLUP that turns resolved drinks into a per-cocktail table + aggregate ingredient list
//     + grand total, degrading gracefully (partials) exactly like the cost engine.
//
// Pure + server-side: the event page SSRs it, and the publish route reuses the same path to
// compute the public-total snapshot, so the two can never drift.
import { buildCostEngine, type CostIngredient, type CostLine, type CostRecipe } from './cost';
import { CHARACTER_REQUIRED_TYPES } from './recipes';
import { nameKey } from './service-log';
import { convert, UNIT_CONV } from './units';

// ─────────────────────────── matcher ───────────────────────────

/** Folding key for matching: the service log's `nameKey` (case/accent/whitespace) then punctuation
 *  and symbols stripped — so "Queen's Park Swizzle" and "queens park swizzle" share a key. */
export function matchKey(name: string): string {
  return nameKey(name)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type DrinkLikeRecipe = { id: number; name: string };
export type MatchTier = 'auto' | 'confirm' | 'missing';
/** A suggestion for an unresolved drink. `recipeId` is the candidate (null only for `missing`). */
export type MatchSuggestion = { tier: MatchTier; recipeId: number | null };

/** Levenshtein edit distance (small DP — names are short). */
function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** Confirm-tier similarity score (higher = better); 0 means "not a plausible suggestion". Captures
 *  abbreviations/prefixes ("marg" → margarita, "humu" → humuhumu…), token subsets, substrings, and
 *  a moderate fuzzy band. Deliberately separate from the auto test so a fuzzy hit is only ever a
 *  *suggestion* the admin must accept. */
function confirmScore(dk: string, rk: string): number {
  if (!dk || !rk) return 0;
  if (dk === rk) return 100;
  if (dk.length >= 3 && rk.startsWith(dk)) return 80; // abbreviation / leading prefix
  const dkTokens = dk.split(' ');
  const rkTokens = new Set(rk.split(' '));
  if (dkTokens.length > 0 && dkTokens.every((t) => rkTokens.has(t))) return 60; // all logged tokens present
  if (dk.length >= 3 && rk.includes(dk)) return 45; // substring
  const d = lev(dk, rk);
  const maxLen = Math.max(dk.length, rk.length);
  if (d <= Math.floor(maxLen / 3)) return 40 - d; // moderate fuzzy band
  return 0;
}

/**
 * Classify one logged drink against the drink-like recipes. AUTO is intentionally narrow — a wrong
 * *silent* match quietly corrupts the cost, so it fires only on an exact folded key, or a unique
 * near-exact key (long name, ≤1–2 edits, same token count, clearly ahead of the runner-up).
 * Everything fuzzier is a single CONFIRM suggestion the admin accepts or rejects; nothing plausible
 * is MISSING (→ add it on /cocktails).
 */
export function suggestMatch(drinkName: string, recipes: DrinkLikeRecipe[]): MatchSuggestion {
  const dk = matchKey(drinkName);
  if (!dk || recipes.length === 0) return { tier: 'missing', recipeId: null };
  const cands = recipes.map((r) => ({ r, rk: matchKey(r.name) }));

  // exact folded key — auto when unique, confirm when two recipes collide on one folded name
  const exact = cands.filter((c) => c.rk === dk);
  if (exact.length === 1) return { tier: 'auto', recipeId: exact[0].r.id };
  if (exact.length > 1) return { tier: 'confirm', recipeId: exact[0].r.id };

  // near-exact spelling — auto only if long, unique, same token count, and clearly ahead
  const byDist = cands
    .map((c) => ({ ...c, d: lev(dk, c.rk) }))
    .sort((a, b) => a.d - b.d);
  const best = byDist[0];
  const second = byDist[1];
  const maxAuto = dk.length >= 12 ? 2 : 1;
  if (
    dk.length >= 6 &&
    best.d <= maxAuto &&
    best.rk.split(' ').length === dk.split(' ').length &&
    (!second || second.d >= best.d + 2)
  ) {
    return { tier: 'auto', recipeId: best.r.id };
  }

  // confirm — best plausible candidate (the admin adjudicates close calls)
  const byScore = cands
    .map((c) => ({ ...c, score: confirmScore(dk, c.rk) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
  if (byScore.length > 0) return { tier: 'confirm', recipeId: byScore[0].r.id };

  return { tier: 'missing', recipeId: null };
}

// ─────────────────────────── overlay ───────────────────────────

export type PriceOverride = { amount: number; unit: string; cents: number };

/**
 * Produce the ingredient list the cost engine should cost for THIS event:
 *  - pseudo-juice toggle OFF → an ingredient whose cost-source is a `pseudo juice` recipe reverts
 *    to its own purchase price (cost the real juice); ON keeps the substitute link;
 *  - an explicit price override wins outright — set the purchase price/amount/unit and clear the
 *    cost-source link, because an override is the admin saying "price this bottle directly".
 * Never mutates the input rows.
 */
export function overlayIngredients(
  ingredients: CostIngredient[],
  recipeTypeById: Map<number, string>,
  opts: { usePseudoJuice: boolean; overrides: Map<number, PriceOverride> },
): CostIngredient[] {
  return ingredients.map((ing) => {
    const next: CostIngredient = { ...ing };
    if (
      !opts.usePseudoJuice &&
      next.cost_recipe_id != null &&
      recipeTypeById.get(next.cost_recipe_id) === 'pseudo juice'
    ) {
      next.cost_recipe_id = null;
    }
    const ov = opts.overrides.get(next.id);
    if (ov) {
      next.purchase_amount = ov.amount;
      next.purchase_unit = ov.unit;
      next.purchase_price_cents = ov.cents;
      next.cost_recipe_id = null;
    }
    return next;
  });
}

/** True if any ingredient is costed via a `pseudo juice` recipe — drives whether the toggle is
 *  meaningful (when none exist the UI says so rather than offering a dead control). */
export function hasPseudoJuiceLinks(
  ingredients: CostIngredient[],
  recipeTypeById: Map<number, string>,
): boolean {
  return ingredients.some(
    (i) => i.cost_recipe_id != null && recipeTypeById.get(i.cost_recipe_id) === 'pseudo juice',
  );
}

// ─────────────────────────── rollup ───────────────────────────

export type PerCocktail = {
  recipeId: number;
  name: string;
  qty: number;
  eachCents: number;
  eachPartial: boolean;
  totalCents: number;
};
export type AggIngredient = {
  ingredientId: number;
  name: string;
  /** total consumed across the event, summed per dimension (e.g. "12.5 oz + 3 each"); '' when none */
  quantity: string;
  cents: number;
  partial: boolean;
};
export type EventCostRollup = {
  perCocktail: PerCocktail[];
  aggregate: AggIngredient[];
  cocktailKnownCents: number;
  incidentalsCents: number;
  grandKnownCents: number;
  partial: boolean;
  flags: { unpricedIngredients: string[]; partialCocktails: string[]; dismissed: string[] };
};

// One readable display unit per dimension for the aggregate quantity totals.
const DIM_DISPLAY: Record<string, string> = { vol: 'oz', count: 'each', herb: 'leaf' };

function trimNum(n: number): string {
  return String(Number(n.toFixed(2)));
}

/** Sum a per-unit quantity map into one display string: convertible units fold into their
 *  dimension's display unit; anything off the conversion table (g, bag, …) stays on its own. */
function formatQuantity(byUnit: Map<string, number>): string {
  if (byUnit.size === 0) return '';
  const byDim = new Map<string, number>();
  const loose: string[] = [];
  for (const [unit, amt] of byUnit) {
    const conv = UNIT_CONV[unit];
    if (!conv) {
      loose.push(`${trimNum(amt)} ${unit}`);
      continue;
    }
    const disp = DIM_DISPLAY[conv.dim];
    const inDisp = convert(amt, unit, disp) ?? amt;
    byDim.set(disp, (byDim.get(disp) ?? 0) + inDisp);
  }
  const parts = [...byDim.entries()].map(([unit, amt]) => `${trimNum(amt)} ${unit}`);
  return [...parts, ...loose].join(' + ');
}

export type RollupInput = {
  drinks: { id: number; name: string; count: number }[];
  resolutions: Map<number, { recipeId: number | null; dismissed: boolean }>;
  recipes: CostRecipe[];
  recipeNames: Map<number, string>;
  lines: CostLine[];
  overlaidIngredients: CostIngredient[];
  incidentals: { id: number; label: string; cents: number }[];
};

/** Roll the event up. Matched drinks group by recipe; the aggregate ingredient list and grand
 *  total come from the same overlaid cost engine. Unresolved drinks are ignored here — the gate
 *  keeps the cost view hidden until every drink is matched or dismissed. */
export function rollupEventCost(input: RollupInput): EventCostRollup {
  const engine = buildCostEngine(input.overlaidIngredients, input.recipes, input.lines);

  const byRecipe = new Map<number, number>(); // recipeId -> total qty
  const dismissed: string[] = [];
  for (const d of input.drinks) {
    const r = input.resolutions.get(d.id);
    if (r?.dismissed) {
      dismissed.push(d.name);
      continue;
    }
    if (r?.recipeId != null) byRecipe.set(r.recipeId, (byRecipe.get(r.recipeId) ?? 0) + d.count);
  }

  type Agg = { name: string; cents: number; partial: boolean; byUnit: Map<string, number> };
  const agg = new Map<number, Agg>();
  const perCocktail: PerCocktail[] = [];
  let cocktailKnownCents = 0;
  let anyPartial = false;

  for (const [recipeId, qty] of byRecipe) {
    const rc = engine.recipeCost(recipeId);
    const eachPartial = rc.partialLines > 0;
    perCocktail.push({
      recipeId,
      name: input.recipeNames.get(recipeId) ?? 'unknown',
      qty,
      eachCents: rc.knownCents,
      eachPartial,
      totalCents: rc.knownCents * qty,
    });
    cocktailKnownCents += rc.knownCents * qty;
    if (eachPartial) anyPartial = true;

    for (const l of rc.lines) {
      const a = agg.get(l.ingredientId) ?? { name: l.ingredient, cents: 0, partial: false, byUnit: new Map() };
      if (l.cents != null) a.cents += l.cents * qty;
      if (l.partial) a.partial = true;
      if (l.amount != null) a.byUnit.set(l.unit, (a.byUnit.get(l.unit) ?? 0) + l.amount * qty);
      agg.set(l.ingredientId, a);
    }
  }

  const byNameThenTotal = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  perCocktail.sort((a, b) => b.totalCents - a.totalCents || byNameThenTotal(a, b));

  const aggregate: AggIngredient[] = [...agg.entries()]
    .map(([id, a]) => ({
      ingredientId: id,
      name: a.name,
      quantity: formatQuantity(a.byUnit),
      cents: a.cents,
      partial: a.partial,
    }))
    .sort((a, b) => b.cents - a.cents || byNameThenTotal(a, b));

  const unpricedIngredients = aggregate.filter((a) => a.partial).map((a) => a.name);
  const partialCocktails = perCocktail.filter((c) => c.eachPartial).map((c) => c.name);
  if (unpricedIngredients.length > 0) anyPartial = true;

  const incidentalsCents = input.incidentals.reduce((s, i) => s + i.cents, 0);

  return {
    perCocktail,
    aggregate,
    cocktailKnownCents,
    incidentalsCents,
    grandKnownCents: cocktailKnownCents + incidentalsCents,
    partial: anyPartial,
    flags: { unpricedIngredients, partialCocktails, dismissed },
  };
}

// ─────────────────────── data loader + rollup-from-loaded ───────────────────────

export type LoadedEventCost = {
  drinks: { id: number; name: string; count: number }[];
  resolutions: Map<number, { recipeId: number | null; dismissed: boolean }>;
  recipes: CostRecipe[];
  recipeMeta: { id: number; name: string; type: string }[];
  lines: CostLine[];
  ingredients: CostIngredient[];
  overrides: Map<number, PriceOverride>;
  incidentals: { id: number; label: string; cents: number }[];
  settings: {
    usePseudoJuice: boolean;
    publicEnabled: boolean;
    publicCents: number | null;
    publicPartial: boolean;
    publicUpdatedAt: number | null;
  };
};

const DEFAULT_SETTINGS: LoadedEventCost['settings'] = {
  usePseudoJuice: false,
  publicEnabled: false,
  publicCents: null,
  publicPartial: false,
  publicUpdatedAt: null,
};

/** Fetch everything the rollup needs for an event in one fan-out. Used by the admin page SSR and
 *  the publish route, so the snapshot is computed from the same inputs the admin sees. */
export async function loadEventCostData(db: D1Database, slug: string): Promise<LoadedEventCost> {
  const [drinkRows, resRows, recipeRows, lineRows, ingRows, ovRows, incRows, settingsRow] =
    await Promise.all([
      db.prepare(
        `SELECT d.id, d.name, SUM(nd.count) AS count
         FROM service_night_drinks nd
         JOIN service_nights n ON n.id = nd.night_id
         JOIN service_drinks d ON d.id = nd.drink_id
         WHERE n.event_slug = ?
         GROUP BY d.id, d.name
         ORDER BY count DESC, d.name COLLATE NOCASE`,
      ).bind(slug).all<{ id: number; name: string; count: number }>(),
      db.prepare(
        `SELECT service_drink_id, recipe_id, dismissed FROM event_drink_resolutions WHERE event_slug = ?`,
      ).bind(slug).all<{ service_drink_id: number; recipe_id: number | null; dismissed: number }>(),
      db.prepare(
        `SELECT id, name, type, yield_amount, yield_unit FROM recipes ORDER BY name COLLATE NOCASE`,
      ).all<{ id: number; name: string; type: string; yield_amount: number | null; yield_unit: string | null }>(),
      db.prepare(
        `SELECT recipe_id, ingredient_id, amount, unit FROM recipe_lines ORDER BY recipe_id, position`,
      ).all<CostLine>(),
      db.prepare(
        `SELECT id, name, purchase_amount, purchase_unit, purchase_price_cents, cost_recipe_id FROM ingredients`,
      ).all<CostIngredient>(),
      db.prepare(
        `SELECT ingredient_id, purchase_amount, purchase_unit, purchase_price_cents
         FROM event_ingredient_prices WHERE event_slug = ?`,
      ).bind(slug).all<{ ingredient_id: number; purchase_amount: number; purchase_unit: string; purchase_price_cents: number }>(),
      db.prepare(
        `SELECT id, label, amount_cents FROM event_incidentals WHERE event_slug = ? ORDER BY id`,
      ).bind(slug).all<{ id: number; label: string; amount_cents: number }>(),
      db.prepare(
        `SELECT use_pseudo_juice, public_total_enabled, public_known_cents, public_is_partial, public_updated_at
         FROM event_cost_settings WHERE event_slug = ?`,
      ).bind(slug).first<{
        use_pseudo_juice: number;
        public_total_enabled: number;
        public_known_cents: number | null;
        public_is_partial: number;
        public_updated_at: number | null;
      }>(),
    ]);

  // A persisted match only counts if its recipe is STILL drink-like: a recipe can be deleted
  // (recipe_id → NULL via the FK) or retyped to a non-drink type (syrup/infusion/…) after the
  // match was saved. Either way the match is stale — drop it to null here so every consumer (the
  // reconcile view, the resolved gate, the rollup, the publish snapshot) re-surfaces that drink as
  // unresolved rather than silently costing a non-drink recipe.
  const drinkTypes = new Set<string>(CHARACTER_REQUIRED_TYPES);
  const drinkLikeIds = new Set(recipeRows.results.filter((r) => drinkTypes.has(r.type)).map((r) => r.id));

  return {
    drinks: drinkRows.results.map((r) => ({ id: r.id, name: r.name, count: Number(r.count) })),
    resolutions: new Map(
      resRows.results.map((r) => {
        const matched = r.recipe_id != null && drinkLikeIds.has(r.recipe_id);
        return [r.service_drink_id, { recipeId: matched ? r.recipe_id : null, dismissed: r.dismissed === 1 }];
      }),
    ),
    recipes: recipeRows.results.map((r) => ({ id: r.id, yield_amount: r.yield_amount, yield_unit: r.yield_unit })),
    recipeMeta: recipeRows.results.map((r) => ({ id: r.id, name: r.name, type: r.type })),
    lines: lineRows.results,
    ingredients: ingRows.results,
    overrides: new Map(
      ovRows.results.map((r) => [
        r.ingredient_id,
        { amount: r.purchase_amount, unit: r.purchase_unit, cents: r.purchase_price_cents },
      ]),
    ),
    incidentals: incRows.results.map((r) => ({ id: r.id, label: r.label, cents: r.amount_cents })),
    settings: settingsRow
      ? {
          usePseudoJuice: settingsRow.use_pseudo_juice === 1,
          publicEnabled: settingsRow.public_total_enabled === 1,
          publicCents: settingsRow.public_known_cents,
          publicPartial: settingsRow.public_is_partial === 1,
          publicUpdatedAt: settingsRow.public_updated_at,
        }
      : { ...DEFAULT_SETTINGS },
  };
}

/** Overlay the loaded catalog per the loaded settings/overrides, then roll up. */
export function rollupFromLoaded(d: LoadedEventCost): EventCostRollup {
  const recipeNames = new Map(d.recipeMeta.map((r) => [r.id, r.name]));
  const recipeTypeById = new Map(d.recipeMeta.map((r) => [r.id, r.type]));
  const overlaidIngredients = overlayIngredients(d.ingredients, recipeTypeById, {
    usePseudoJuice: d.settings.usePseudoJuice,
    overrides: d.overrides,
  });
  return rollupEventCost({
    drinks: d.drinks,
    resolutions: d.resolutions,
    recipes: d.recipes,
    recipeNames,
    lines: d.lines,
    overlaidIngredients,
    incidentals: d.incidentals,
  });
}

/** Drink-like recipes only (cocktail/punch/mocktail) — the matcher's candidate set and the
 *  reconcile dropdown's options; syrups / infusions / pseudo-juices are never logged as drinks. */
export function drinkLikeRecipes(recipeMeta: { id: number; name: string; type: string }[]): DrinkLikeRecipe[] {
  const drinkTypes = new Set<string>(CHARACTER_REQUIRED_TYPES);
  return recipeMeta.filter((r) => drinkTypes.has(r.type)).map((r) => ({ id: r.id, name: r.name }));
}

// ─────────────────────────── validation (POST payloads) ───────────────────────────

function asRecord(body: unknown): Record<string, unknown> {
  return (body ?? {}) as Record<string, unknown>;
}
function slugOf(b: Record<string, unknown>): string {
  return String(b.event_slug ?? '').trim();
}

export type ValidResolution = { service_drink_id: number; recipe_id: number | null; dismissed: boolean };

/** Shape validation for the matches payload; the route adds the domain cross-checks (drink ids
 *  belong to this event, recipe ids are drink-like) since those need the DB. */
export function validateResolutions(
  body: unknown,
): { event_slug: string; resolutions: ValidResolution[] } | { error: string } {
  const b = asRecord(body);
  const event_slug = slugOf(b);
  if (!event_slug || event_slug.length > 80) return { error: 'Event slug is required.' };

  const raw = Array.isArray(b.resolutions) ? b.resolutions : [];
  if (raw.length > 1000) return { error: 'Too many drinks.' };
  const resolutions: ValidResolution[] = [];
  for (const item of raw) {
    const r = asRecord(item);
    const service_drink_id = Number(r.service_drink_id);
    if (!Number.isInteger(service_drink_id) || service_drink_id <= 0) {
      return { error: 'Each resolution needs a drink.' };
    }
    const dismissed = r.dismissed === true;
    let recipe_id: number | null = null;
    if (!dismissed) {
      recipe_id = Number(r.recipe_id);
      if (!Number.isInteger(recipe_id) || recipe_id <= 0) {
        return { error: 'A resolution must match a recipe or be dismissed.' };
      }
    }
    resolutions.push({ service_drink_id, recipe_id, dismissed });
  }
  return { event_slug, resolutions };
}

export type ValidOverride = { ingredient_id: number; purchase_amount: number; purchase_unit: string; purchase_price_cents: number };
export type ValidIncidental = { label: string; amount_cents: number };
export type ValidPricing = {
  event_slug: string;
  use_pseudo_juice: boolean;
  overrides: ValidOverride[];
  incidentals: ValidIncidental[];
};

export function validatePricing(body: unknown): ValidPricing | { error: string } {
  const b = asRecord(body);
  const event_slug = slugOf(b);
  if (!event_slug || event_slug.length > 80) return { error: 'Event slug is required.' };
  const use_pseudo_juice = b.use_pseudo_juice === true;

  const rawOv = Array.isArray(b.overrides) ? b.overrides : [];
  if (rawOv.length > 500) return { error: 'Too many overrides.' };
  const overrides: ValidOverride[] = [];
  for (const item of rawOv) {
    const o = asRecord(item);
    const ingredient_id = Number(o.ingredient_id);
    if (!Number.isInteger(ingredient_id) || ingredient_id <= 0) return { error: 'Override needs an ingredient.' };
    const amount = Number(o.purchase_amount);
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'Override amount must be a positive number.' };
    const unit = String(o.purchase_unit ?? '').trim();
    if (!unit || unit.length > 20) return { error: 'Override needs a purchase unit (max 20 characters).' };
    const dollars = Number(o.purchase_price);
    if (!Number.isFinite(dollars) || dollars < 0) return { error: 'Override price must be a non-negative dollar amount.' };
    overrides.push({ ingredient_id, purchase_amount: amount, purchase_unit: unit, purchase_price_cents: Math.round(dollars * 100) });
  }

  const rawInc = Array.isArray(b.incidentals) ? b.incidentals : [];
  if (rawInc.length > 200) return { error: 'Too many incidentals.' };
  const incidentals: ValidIncidental[] = [];
  for (const item of rawInc) {
    const i = asRecord(item);
    const label = String(i.label ?? '').trim();
    if (!label || label.length > 60) return { error: 'Incidental needs a label (max 60 characters).' };
    const dollars = Number(i.amount);
    if (!Number.isFinite(dollars) || dollars < 0) return { error: 'Incidental amount must be a non-negative dollar amount.' };
    incidentals.push({ label, amount_cents: Math.round(dollars * 100) });
  }

  return { event_slug, use_pseudo_juice, overrides, incidentals };
}
