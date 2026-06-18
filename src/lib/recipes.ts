// Recipe catalog shared types + validation + display helpers (issue #21).
import { NO_QTY_UNITS, UNITS } from './ingredients';

export const RECIPE_TYPES = [
  'cocktail', 'punch', 'mocktail', 'syrup', 'infusion', 'pseudo juice',
] as const;
export type RecipeType = (typeof RECIPE_TYPES)[number];

/** Types that read as a drink on the menu — these require a `character`. */
export const CHARACTER_REQUIRED_TYPES = ['cocktail', 'punch', 'mocktail'] as const;

export type ValidRecipeLine = {
  ingredient_id: number;
  amount: number | null;
  unit: string;
  is_garnish: boolean;
};

export type ValidRecipe = {
  name: string;
  micro: string | null;
  type: RecipeType;
  character: string | null;
  method: string;
  notes: string | null;
  /** Optional batch yield: how much of `yield_unit` one batch makes. The cost tool (#22)
   *  divides the batch cost by it to derive a per-unit price for a linked ingredient.
   *  Stored both-or-neither. */
  yield_amount: number | null;
  yield_unit: string | null;
  /** Build lines first, garnish after — array order is the stored position order. */
  lines: ValidRecipeLine[];
};

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function validateLine(raw: unknown, label: string, garnish: boolean): ValidRecipeLine | { error: string } {
  const l = (raw ?? {}) as Record<string, unknown>;
  const ingredient_id = Number(l.ingredient_id);
  if (!Number.isInteger(ingredient_id) || ingredient_id <= 0) {
    return { error: `Every ${label} line needs an ingredient.` };
  }
  const unit = text(l.unit);
  if (!(UNITS as readonly string[]).includes(unit)) {
    return { error: `Unit must be one of the standard units (${label} line).` };
  }

  let amount: number | null = null;
  const amountText = text(l.amount);
  if (amountText && !(NO_QTY_UNITS as readonly string[]).includes(unit)) {
    const n = Number(amountText);
    if (!Number.isFinite(n) || n <= 0) {
      return { error: `Amounts must be positive numbers (${label} line).` };
    }
    amount = n;
  }
  return { ingredient_id, amount, unit, is_garnish: garnish };
}

export function validateRecipe(body: unknown): ValidRecipe | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;

  const name = text(b.name);
  if (!name || name.length > 80) return { error: 'Name is required (max 80 characters).' };

  const micro = text(b.micro);
  if (micro.length > 120) return { error: 'Microcopy is too long (max 120 characters).' };

  const type = text(b.type) as RecipeType;
  if (!(RECIPE_TYPES as readonly string[]).includes(type)) {
    return { error: 'Type must be one of the standard types.' };
  }

  const character = text(b.character);
  if ((CHARACTER_REQUIRED_TYPES as readonly string[]).includes(type)) {
    if (!character || character.length > 40) {
      return { error: 'Character is required for drinks (max 40 characters).' };
    }
  }

  // Method: ordered steps, one per line. Stored unnumbered; strip any pasted "1. " prefixes.
  const method = text(b.method)
    .split('\n')
    .map((s) => s.trim().replace(/^\d+[.)]\s*/, ''))
    .filter(Boolean)
    .join('\n');
  if (!method) return { error: 'Method is required.' };
  if (method.length > 2000) return { error: 'Method is too long (max 2000 characters).' };

  const notes = text(b.notes);
  if (notes.length > 1000) return { error: 'Notes are too long (max 1000 characters).' };

  // Yield is optional but both-or-neither: an amount needs a unit to mean anything, and a
  // bare unit has nothing to divide. Unit comes from the shared list; amount must be > 0.
  let yield_amount: number | null = null;
  let yield_unit: string | null = null;
  const yieldAmountText = text(b.yield_amount);
  const yieldUnitText = text(b.yield_unit);
  if (yieldAmountText || yieldUnitText) {
    if (!yieldAmountText || !yieldUnitText) {
      return { error: 'Yield needs both an amount and a unit (or leave both blank).' };
    }
    const n = Number(yieldAmountText);
    if (!Number.isFinite(n) || n <= 0) return { error: 'Yield amount must be a positive number.' };
    if (!(UNITS as readonly string[]).includes(yieldUnitText)) {
      return { error: 'Yield unit must be one of the standard units.' };
    }
    yield_amount = n;
    yield_unit = yieldUnitText;
  }

  const rawBuild = Array.isArray(b.lines) ? b.lines : [];
  const rawGarnish = Array.isArray(b.garnish_lines) ? b.garnish_lines : [];
  if (rawBuild.length === 0) return { error: 'At least one ingredient line is required.' };
  if (rawBuild.length + rawGarnish.length > 50) return { error: 'Too many lines (max 50).' };

  const lines: ValidRecipeLine[] = [];
  for (const raw of rawBuild) {
    const v = validateLine(raw, 'ingredient', false);
    if ('error' in v) return v;
    lines.push(v);
  }
  for (const raw of rawGarnish) {
    const v = validateLine(raw, 'garnish', true);
    if ('error' in v) return v;
    lines.push(v);
  }

  return {
    name,
    micro: micro || null,
    type,
    // Non-drink types never carry a character, even if one was sent.
    character: (CHARACTER_REQUIRED_TYPES as readonly string[]).includes(type) ? character : null,
    method,
    notes: notes || null,
    yield_amount,
    yield_unit,
    lines,
  };
}

// --- Display helpers (used by SSR; the client mirrors search normalization) ---

const FRACTIONS: [number, string][] = [
  [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'],
  [2 / 3, '⅔'], [3 / 4, '¾'],
];

/** 0.75 → "¾", 1.5 → "1½", 2 → "2". Falls back to the plain number when no
 *  vulgar fraction matches (tolerance covers float noise on thirds). */
export function formatAmount(n: number): string {
  const whole = Math.floor(n);
  const frac = n - whole;
  if (frac < 0.01) return String(whole);
  for (const [value, glyph] of FRACTIONS) {
    if (Math.abs(frac - value) < 0.01) return whole === 0 ? glyph : `${whole}${glyph}`;
  }
  return String(n);
}

/** Case- and accent-insensitive search key (JALAPENO matches jalapeño). */
export function normalizeSearch(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
