# Cocktails — Design Doc

A cocktail recipe builder/viewer for the site. Public users can browse ingredients and recipes; admins (via Cloudflare Access) curate the catalog.

This doc captures design decisions before any schema or code lands. Implementation will follow in phases:

1. **Ingredient DB + admin CRUD** ← this doc covers the design for this phase
2. Recipe DB + admin CRUD (next round)
3. Public browse pages
4. Recipe-builder UI

---

## Phase 1: Ingredient Database

### Goals

The schema must accommodate three kinds of ingredients:

1. **Simple / unambiguous** — `lime juice`, `maple syrup`, `Campari`. No category, no variants.
2. **Category with optional brand preference** — a recipe can call for generic `bourbon`, or for `bourbon` with a recommended bottle like `Old Forester Signature`. A user can swap in any bourbon they have.
3. **Derived from a prep recipe** — `cinnamon simple syrup`, `allspice dram`. These are ingredients in their own right but are *made* by following a recipe stored in the recipes table.

Plus:

- **Optional pricing** to estimate the cost of a recipe.
- **Admin-curated catalog** (no open user submissions).

### Schema

A single `ingredients` table handles all three kinds via two nullable foreign keys:

- `parent_id` — self-reference to another ingredient row, used for category→brand relationships.
- `derived_from_recipe_id` — link to a recipe that produces this ingredient.

```sql
CREATE TABLE ingredients (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  name                      TEXT    NOT NULL,
  slug                      TEXT    NOT NULL UNIQUE,

  -- Category / brand relationship (self-ref).
  -- NULL parent_id = top-level (either a generic category like "Bourbon"
  -- or an unambiguous standalone like "Lime Juice").
  -- Non-NULL parent_id = a specific brand of the parent category.
  parent_id                 INTEGER REFERENCES ingredients(id) ON DELETE SET NULL,

  -- Free-text grouping for filtering / browse UI.
  -- e.g. "Spirits", "Citrus", "Syrups", "Bitters", "Mixers", "Garnish".
  category                  TEXT,

  -- Link to a prep recipe that produces this ingredient
  -- (e.g. "Cinnamon Simple Syrup" -> recipe that makes it).
  -- Forward-declares recipes; FK enforced once recipes table exists.
  derived_from_recipe_id    INTEGER REFERENCES recipes(id) ON DELETE SET NULL,

  -- Pricing (all nullable; cost estimation degrades gracefully).
  price_cents               INTEGER,   -- price paid for `purchase_amount` of `purchase_unit`
  purchase_amount           REAL,      -- e.g. 750
  purchase_unit             TEXT,      -- e.g. "ml", "oz", "each"

  -- Recipe-side unit: how this ingredient is measured in cocktails.
  default_recipe_unit       TEXT,      -- e.g. "oz", "dash", "tsp", "each"

  -- Conversion: how many `default_recipe_unit` are in one `purchase_unit`.
  -- e.g. a 750 ml bottle = 25.36 oz, so for default_recipe_unit='oz' and
  --      purchase_amount=750, purchase_unit='ml' -> recipe_units_per_purchase=25.36.
  -- If NULL, recipe cost cannot be auto-computed for this ingredient.
  recipe_units_per_purchase REAL,

  notes                     TEXT,
  created_at                INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX idx_ingredients_parent   ON ingredients(parent_id);
CREATE INDEX idx_ingredients_category ON ingredients(category);
```

### How the three cases map to rows

| id | name                   | parent_id | category | derived_from_recipe_id | notes                  |
|----|------------------------|-----------|----------|------------------------|------------------------|
| 1  | Bourbon                | NULL      | Spirits  | NULL                   | generic category       |
| 2  | Old Forester Signature | 1         | Spirits  | NULL                   | specific bottle        |
| 3  | Wild Turkey 101        | 1         | Spirits  | NULL                   | specific bottle        |
| 4  | Lime Juice             | NULL      | Citrus   | NULL                   | simple, no variants    |
| 5  | Campari                | NULL      | Spirits  | NULL                   | simple, no variants    |
| 6  | Cinnamon Simple Syrup  | NULL      | Syrups   | 42                     | made by recipe #42     |

Queries:
- "All bourbons" → `WHERE parent_id = 1`
- "All top-level ingredients to show in the picker" → `WHERE parent_id IS NULL`
- "What is this brand a kind of?" → follow `parent_id`

### How variants are referenced from recipes

Brand preference lives on the **recipe ingredient row** (the join row), not on the ingredient itself:

```sql
CREATE TABLE recipe_ingredients (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id            INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id        INTEGER NOT NULL REFERENCES ingredients(id),       -- the canonical thing called for
  preferred_variant_id INTEGER          REFERENCES ingredients(id),       -- optional: a specific brand
  amount               REAL    NOT NULL,
  unit                 TEXT    NOT NULL,
  notes                TEXT,
  sort_order           INTEGER NOT NULL DEFAULT 0
);
```

(Full recipes schema is deferred to Phase 2; this snippet is only here to show how the brand-preference mechanism resolves.)

Three example recipe rows:

| Recipe says                       | ingredient_id  | preferred_variant_id     |
|-----------------------------------|----------------|--------------------------|
| "0.75 oz lime juice"              | Lime Juice (4) | NULL                     |
| "2 oz bourbon" (no preference)    | Bourbon (1)    | NULL                     |
| "2 oz bourbon, ideally OF Sig."   | Bourbon (1)    | Old Forester Sig. (2)    |

The category is always the canonical thing called for; the variant is a *recommendation*. The recipe UI renders `"{amount} {unit} {ingredient.name}"` and, if `preferred_variant_id` is set, appends `" (preferred: {variant.name})"`.

**Validation (application-level, not DB):** if `preferred_variant_id` is set, its `parent_id` must equal `ingredient_id`.

### Cost estimation fallback

For each `recipe_ingredients` row, resolve the per-ingredient cost in this order:

1. Use `preferred_variant_id`'s pricing if present and complete.
2. Else use `ingredient_id`'s pricing if complete.
3. Else mark this line's cost as **unknown** and surface a "partial estimate" badge on the recipe.

"Complete" pricing means all four of `price_cents`, `purchase_amount`, `purchase_unit`, `recipe_units_per_purchase` are set.

Per-line cost math:

```
cost_cents = price_cents * (amount / recipe_units_per_purchase)
```

(Assumes `unit` in the recipe row matches the ingredient's `default_recipe_unit`. Cross-unit conversion is out of scope for v1; require recipe authors to use the ingredient's default unit.)

Seeding the **generic category row** (e.g. Bourbon) with a representative price means recipes that don't name a specific brand still get a cost estimate.

### Auth

- **Writes** (create/edit/delete ingredients): gated by `cf-access-jwt-assertion` header, same pattern as existing admin endpoints in `/src/pages/api/admin/`.
- **Reads** (list, view): public, no auth.

### API routes (Phase 1 implementation, not in this commit)

- `GET  /api/ingredients` — list, with optional `?parent_id=`, `?category=`, `?top_level=true` filters.
- `GET  /api/ingredients/[id]` — single ingredient + children.
- `POST /api/ingredients` — admin only.
- `PATCH /api/ingredients/[id]` — admin only.
- `DELETE /api/ingredients/[id]` — admin only. Refuses delete if other rows reference this one (as parent or as a recipe ingredient).

### Files to add (Phase 1 implementation, not in this commit)

- `/migrations/0003_ingredients.sql` — the table above. (Stub `recipes` table forward-declared as well, or the FK column added in a later migration once Phase 2 lands.)
- `/src/pages/api/ingredients.ts` — list + create.
- `/src/pages/api/ingredients/[id].ts` — get + patch + delete.
- `/src/pages/admin.astro` — extend to include ingredient CRUD UI.

### Open questions / deferred

- **Full recipes schema** — next planning round.
- **Multi-level categories** (e.g. `Spirits → Whiskey → Bourbon → Old Forester Signature`) — current design supports only one level of `parent_id` nesting in practice. If multi-level becomes needed, the schema already permits it; UI and queries would need to handle it.
- **Tags** beyond a single `category` string — defer.
- **Photos** for ingredients — defer.
- **Cross-unit conversion** (recipe asks for tsp, ingredient priced in ml) — defer; v1 requires matching units.
- **Soft delete / archiving** — defer.
