// Cost estimation engine (issue #22). Pure + server-side: it takes an already-fetched
// ingredient / recipe / line graph and estimates what each recipe costs to make.
//
// It degrades gracefully — a missing price, a missing yield, or a unit it can't convert
// yields a clearly-marked PARTIAL estimate (the known subtotal still shows), never a block.
// Cross-unit volume conversion (oz<->ml, dash, tsp) runs through the shared `convert` primitive
// (issue #24); a line falls to partial only when its unit isn't a known volume unit.
import { NO_QTY_UNITS } from './ingredients';
import { convert } from './units';

// Units that cost as negligible (0 cents) rather than partial: the inherently amountless
// rinse/rim/twist, plus the trace decorative drop/pinch — a stray garnish-scale amount should
// never drag a whole recipe to partial. `dash` is intentionally absent: bitters by the dash is
// a real (if small) cost, and `convert` can price it.
const NEGLIGIBLE_UNITS = new Set<string>([...NO_QTY_UNITS, 'drop', 'pinch']);

export type CostIngredient = {
  id: number;
  name: string;
  purchase_amount: number | null;
  purchase_unit: string | null;
  purchase_price_cents: number | null;
  cost_recipe_id: number | null;
};

export type CostRecipe = {
  id: number;
  yield_amount: number | null;
  yield_unit: string | null;
};

export type CostLine = {
  recipe_id: number;
  ingredient_id: number;
  amount: number | null;
  unit: string;
};

/** One costed line in a recipe's breakdown. `cents` is null exactly when `partial`. */
export type LineCost = {
  /** the line's ingredient id — lets a consumer attribute line costs back to a catalog row
   *  (the event-cost rollup aggregates by it; the per-recipe breakdown ignores it). */
  ingredientId: number;
  ingredient: string;
  amount: number | null;
  unit: string;
  cents: number | null;
  partial: boolean;
  /** why this line couldn't be costed (shown in the breakdown); null when known/negligible */
  reason: string | null;
};

export type RecipeCost = {
  /** sum of the lines we could cost, in cents (may be fractional) */
  knownCents: number;
  /** how many lines we couldn't fully cost */
  partialLines: number;
  lines: LineCost[];
};

/** Per-unit cost of an ingredient in a given unit. `cents` null ⇒ couldn't resolve. */
type UnitCost = { cents: number | null; reason: string | null };

export type CostEngine = {
  /** Estimate the cost to make one batch of a recipe as written. */
  recipeCost(recipeId: number): RecipeCost;
};

/**
 * Build a cost engine over the whole catalog graph. Costs are memoized so the graph is
 * walked once; a per-traversal stack breaks reference cycles (a recipe whose cost source
 * eventually depends on itself) so a bad link degrades to partial instead of looping.
 *
 * Why caching the walked results is safe: a cycle short-circuit only fires when the very
 * id being requested is already on the stack — which means that id genuinely sits in a
 * cycle and is intrinsically partial in every context. We never cache that short-circuit
 * itself; everything else we compute is deterministic for its id (+unit) regardless of
 * caller, so it caches cleanly. Memo keys for per-unit results include the unit, so an
 * `oz` price is never reused for an `ml`/`each` request.
 */
export function buildCostEngine(
  ingredients: CostIngredient[],
  recipes: CostRecipe[],
  lines: CostLine[],
): CostEngine {
  const ingById = new Map<number, CostIngredient>(ingredients.map((i) => [i.id, i]));
  const recById = new Map<number, CostRecipe>(recipes.map((r) => [r.id, r]));
  const linesByRecipe = new Map<number, CostLine[]>();
  for (const l of lines) {
    const arr = linesByRecipe.get(l.recipe_id);
    if (arr) arr.push(l);
    else linesByRecipe.set(l.recipe_id, [l]);
  }

  const recipeMemo = new Map<number, RecipeCost>();
  const unitMemo = new Map<string, UnitCost>();

  function recipeCostInner(recipeId: number, stack: Set<string>): RecipeCost {
    const cached = recipeMemo.get(recipeId);
    if (cached) return cached;
    const guard = `recipe:${recipeId}`;
    // cycle: this recipe is already being costed above us — break, mark partial, don't cache
    if (stack.has(guard)) return { knownCents: 0, partialLines: 1, lines: [] };

    stack.add(guard);
    const out: LineCost[] = [];
    let knownCents = 0;
    let partialLines = 0;

    for (const l of linesByRecipe.get(recipeId) ?? []) {
      const name = ingById.get(l.ingredient_id)?.name ?? 'unknown ingredient';

      // negligible units (rinse / rim / twist / drop / pinch): 0 cents, not partial
      if (NEGLIGIBLE_UNITS.has(l.unit)) {
        out.push({ ingredientId: l.ingredient_id, ingredient: name, amount: l.amount, unit: l.unit, cents: 0, partial: false, reason: null });
        continue;
      }
      // a costable unit with no amount means an unknown quantity — partial, don't drop it
      if (l.amount == null) {
        out.push({ ingredientId: l.ingredient_id, ingredient: name, amount: null, unit: l.unit, cents: null, partial: true, reason: 'no amount' });
        partialLines++;
        continue;
      }

      const uc = unitCostInner(l.ingredient_id, l.unit, stack);
      if (uc.cents == null) {
        out.push({ ingredientId: l.ingredient_id, ingredient: name, amount: l.amount, unit: l.unit, cents: null, partial: true, reason: uc.reason });
        partialLines++;
      } else {
        const cents = uc.cents * l.amount;
        out.push({ ingredientId: l.ingredient_id, ingredient: name, amount: l.amount, unit: l.unit, cents, partial: false, reason: null });
        knownCents += cents;
      }
    }

    stack.delete(guard);
    const result: RecipeCost = { knownCents, partialLines, lines: out };
    recipeMemo.set(recipeId, result);
    return result;
  }

  function unitCostInner(ingredientId: number, unit: string, stack: Set<string>): UnitCost {
    const key = `i:${ingredientId}:${unit}`;
    const cached = unitMemo.get(key);
    if (cached) return cached;
    const guard = `ingredient:${ingredientId}`;
    if (stack.has(guard)) return { cents: null, reason: 'circular cost' }; // cycle — don't cache

    const ing = ingById.get(ingredientId);
    let result: UnitCost;
    if (!ing) {
      result = { cents: null, reason: 'unknown ingredient' };
    } else if (ing.cost_recipe_id != null) {
      // cost comes from a linked recipe (a prep recipe, or a cheaper super-juice substitute)
      stack.add(guard);
      result = recipeUnitCostInner(ing.cost_recipe_id, unit, stack);
      stack.delete(guard);
    } else if (
      ing.purchase_price_cents != null &&
      ing.purchase_amount != null &&
      Number.isFinite(ing.purchase_amount) &&
      ing.purchase_amount > 0 &&
      ing.purchase_unit != null
    ) {
      // direct fallback price. Per-priced-unit cost is price/amount; convert it into the line's
      // unit via the volume table. amount > 0 guards the divide. Same unit keeps the exact value
      // (no float round-trip); cross-unit falls to partial only when convert can't (e.g. a `bag`).
      const perPriced = ing.purchase_price_cents / ing.purchase_amount;
      if (ing.purchase_unit === unit) {
        result = { cents: perPriced, reason: null };
      } else {
        const pricedPerUnit = convert(1, unit, ing.purchase_unit); // priced-units in 1 line-unit
        result =
          pricedPerUnit == null
            ? { cents: null, reason: `priced per ${ing.purchase_unit}, not ${unit}` }
            : { cents: perPriced * pricedPerUnit, reason: null };
      }
    } else {
      result = { cents: null, reason: 'no price' };
    }

    unitMemo.set(key, result);
    return result;
  }

  function recipeUnitCostInner(recipeId: number, unit: string, stack: Set<string>): UnitCost {
    const key = `r:${recipeId}:${unit}`;
    const cached = unitMemo.get(key);
    if (cached) return cached;
    if (stack.has(`recipe:${recipeId}`)) return { cents: null, reason: 'circular cost' }; // don't cache

    const rec = recById.get(recipeId);
    let result: UnitCost;
    if (!rec) {
      result = { cents: null, reason: 'unknown cost source' };
    } else if (rec.yield_amount == null || rec.yield_unit == null || !(rec.yield_amount > 0)) {
      result = { cents: null, reason: 'cost source has no yield' };
    } else {
      const batch = recipeCostInner(recipeId, stack);
      if (batch.partialLines > 0) {
        // a partial batch cost can't give a trustworthy per-unit price
        result = { cents: null, reason: 'cost source is itself partial' };
      } else {
        const perYieldUnit = batch.knownCents / rec.yield_amount; // cents per yield_unit
        if (rec.yield_unit === unit) {
          result = { cents: perYieldUnit, reason: null };
        } else {
          const yieldPerUnit = convert(1, unit, rec.yield_unit); // yield-units in 1 line-unit
          result =
            yieldPerUnit == null
              ? { cents: null, reason: `cost source yields ${rec.yield_unit}, not ${unit}` }
              : { cents: perYieldUnit * yieldPerUnit, reason: null };
        }
      }
    }

    unitMemo.set(key, result);
    return result;
  }

  return {
    recipeCost: (recipeId: number) => recipeCostInner(recipeId, new Set<string>()),
  };
}

/** Cents (possibly fractional) → "$1.14". */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
