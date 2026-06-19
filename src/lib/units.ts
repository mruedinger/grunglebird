// Shared volume-conversion primitive (issue #24). One `unit -> ml` size table over the
// volume-compatible units, plus a `convert` helper. Two consumers read it with different
// allow-lists: the cost engine (`src/lib/cost.ts`) converts even fuzzy volume units like
// `dash` because it must to price a line; the recipe-view unit toggle converts real volume
// units only (oz/ml/tsp) and leaves a `dash` written as a dash. Same table, two policies.
//
// Pure module (no Cloudflare imports) so it runs server-side and in the browser bundle.

const OZ_ML = 29.5735; // 1 fl oz, accurate

/**
 * Volume table, in millilitres. Locked to ml/oz/tsp/dash (issue #24).
 *  - oz, tsp accurate: 1 tsp = 1/6 oz.
 *  - `dash` mirrors the cheat sheet's head-math (5 dashes = 1/8 oz => 1 dash = 1/40 oz) and is
 *    imprecise by design. Keep it in sync with `CONVERSIONS` in `src/pages/cocktails.astro`,
 *    which stays the hand-curated human reference — don't render one from the other.
 */
export const UNIT_ML: Record<string, number> = {
  ml: 1,
  oz: OZ_ML,
  tsp: OZ_ML / 6,
  dash: OZ_ML / 40,
};

/**
 * Convert `amount` of `from` into `to`. Returns `null` when either unit isn't a known volume
 * unit — callers fall back to their own partial/verbatim handling rather than guessing.
 */
export function convert(amount: number, from: string, to: string): number | null {
  const f = UNIT_ML[from];
  const t = UNIT_ML[to];
  if (f == null || t == null) return null;
  return (amount * f) / t;
}
