// Ingredient catalog shared types + validation (issue #20).
// The canonical unit list drives the recipe-line `default_unit` dropdown and is the
// only place units are defined. `purchase_unit` is intentionally NOT constrained to
// this list — it's how a bottle is *bought* (ml, bag, …), not a recipe-line unit.
export const UNITS = [
  'oz', 'g', 'ml', 'tsp', 'dash', 'drop', 'pinch', 'each', 'rinse', 'rim', 'sprig',
  'peel', 'twist', 'wheel', 'slice', 'wedge',
] as const;
export type Unit = (typeof UNITS)[number];

/** Normalized, validated ingredient fields. `price_updated_at` is set by the route, not here
 *  (it depends on whether the price actually changed, which only the handler knows). */
export type ValidIngredient = {
  name: string;
  category: string;
  default_unit: string;
  purchase_amount: number | null;
  purchase_unit: string | null;
  purchase_price_cents: number | null;
};

function optionalText(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

export function validateIngredient(body: unknown): ValidIngredient | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = optionalText(b.name);
  const category = optionalText(b.category);
  const default_unit = optionalText(b.default_unit);

  if (!name || name.length > 80) return { error: 'Name is required (max 80 characters).' };
  if (!category || category.length > 40) return { error: 'Category is required (max 40 characters).' };
  if (!(UNITS as readonly string[]).includes(default_unit)) {
    return { error: 'Default unit must be one of the standard units.' };
  }

  // Price block is optional fallback data — every field nullable; absence is fine.
  const purchaseUnitText = optionalText(b.purchase_unit);
  if (purchaseUnitText.length > 20) return { error: 'Purchase unit is too long (max 20 characters).' };
  const purchase_unit = purchaseUnitText || null;

  let purchase_amount: number | null = null;
  const amountText = optionalText(b.purchase_amount);
  if (amountText) {
    const n = Number(amountText);
    if (!Number.isFinite(n) || n < 0) return { error: 'Purchase amount must be a non-negative number.' };
    purchase_amount = n;
  }

  // Price is entered in dollars and stored as integer cents (matches pledges.amount_cents).
  let purchase_price_cents: number | null = null;
  const priceText = optionalText(b.purchase_price);
  if (priceText) {
    const dollars = Number(priceText);
    if (!Number.isFinite(dollars) || dollars < 0) {
      return { error: 'Price must be a non-negative dollar amount.' };
    }
    purchase_price_cents = Math.round(dollars * 100);
  }

  return { name, category, default_unit, purchase_amount, purchase_unit, purchase_price_cents };
}
