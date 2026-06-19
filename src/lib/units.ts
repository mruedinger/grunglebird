// Shared unit-conversion primitive (issue #24). A small table mapping each convertible unit to
// a base amount within its dimension, plus a `convert` helper. Two consumers read it with
// different allow-lists: the cost engine (`src/lib/cost.ts`) converts even fuzzy units like
// `dash` or `wedge` because it must to price a line; the recipe-view unit toggle converts real
// volume units only (oz/ml/tsp) and leaves a `dash`/`wedge` written as-is. Same table, two
// policies.
//
// Conversion only happens within a dimension — `convert` returns null across dimensions (e.g.
// oz->each), so a mismatched line falls back to the caller's partial/verbatim handling.
//
// Pure module (no Cloudflare imports) so it runs server-side and in the browser bundle.

const OZ_ML = 29.5735; // 1 fl oz, accurate

type UnitConv = { dim: string; base: number };

/**
 * Convertible units, each as `{ dimension, amount-in-base-units }`.
 *  - Volume (base ml): oz, tsp accurate (1 tsp = 1/6 oz). `dash` mirrors the cheat sheet's
 *    head-math (5 dashes = 1/8 oz => 1 dash = 1/40 oz), imprecise by design — keep in sync with
 *    `CONVERSIONS` in `src/pages/cocktails.astro`, which stays the hand-curated human reference.
 *  - Count (base each): a `wedge` is 1/8 of a whole fruit — costing a lime wedge ~ 1/8 a lime.
 *  - Herb (base leaf): a `sprig` is ~6 leaves.
 * The count/herb ratios are approximations for costing; the display toggle never uses them.
 */
export const UNIT_CONV: Record<string, UnitConv> = {
  ml: { dim: "vol", base: 1 },
  oz: { dim: "vol", base: OZ_ML },
  tsp: { dim: "vol", base: OZ_ML / 6 },
  dash: { dim: "vol", base: OZ_ML / 40 },
  each: { dim: "count", base: 1 },
  wedge: { dim: "count", base: 1 / 8 },
  leaf: { dim: "herb", base: 1 },
  sprig: { dim: "herb", base: 6 },
};

/**
 * Convert `amount` of `from` into `to`. Returns `null` when either unit is unknown or the two
 * sit in different dimensions — callers fall back to their own partial/verbatim handling rather
 * than guessing.
 */
export function convert(amount: number, from: string, to: string): number | null {
  const f = UNIT_CONV[from];
  const t = UNIT_CONV[to];
  if (!f || !t || f.dim !== t.dim) return null;
  return (amount * f.base) / t.base;
}
