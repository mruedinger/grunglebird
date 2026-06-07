# Cocktails catalog — seed data & schema

Reference material for building the [#19](https://github.com/mruedinger/grunglebird/issues/19)
epic (ingredient inventory + recipe DB). Worked out with Mike, June 2026. The
canonical schema also lives in the issue comments on #20 / #21 / #22.

## Files
- **`ingredients.csv`** — the 107 locked ingredients (the **#20** seed).
  Columns: `Ingredient`, `Category` (search label), `Default unit`,
  `Purchase amount`, `Purchase unit`, `Purchase price ($)`, `Price updated`.
  Price is in **dollars** → multiply by 100 for `purchase_price_cents` at seed.
- **`recipes.json`** — the **raw Mixel export**, 51 recipes (source for the
  **#21** recipe pass; **not yet normalized**). Trust the JSON as the data;
  **ignore its `slug` / `source_url`** (Mixel artifacts — not used in grunglebird).

## How the import runs
- One-time bulk import. **Seed via `wrangler d1 execute --remote`** (existing CF
  creds) — **no upload API** (it's a one-shot graph load, not a write endpoint).
- **Normalize-first:** build #20 (ingredient catalog) → #21 (recipes referencing
  it) → then seed.

## The model (decisions that shaped the schema)
- **Ingredients are a FLAT list.** No base/bottle hierarchy. `category` is just a
  **search label** (rum, whiskey, syrup…). Specific bottles that matter are their
  own ingredient row (Campari, Smith & Cross, Planteray OFTD).
- **"Preferred bottles" is a separate feature** (a future list on `/cocktails`),
  not wired into the ingredient/recipe tables.
- **Units are NOT forced per recipe line.** Each ingredient has a `default_unit`
  that pre-fills when added to a recipe; the line may override to any unit. Keep a
  small canonical unit list for the dropdown: `oz, g, ml, tsp, dash, drop, pinch,
  each, rinse, rim, sprig` + garnish forms `peel, twist, wheel, slice, wedge`.
- **Price lives on the ingredient as a nullable FALLBACK.** The cost calculator is
  a **separate tool (#22)** — not shown by default on the recipe view (cost swings
  by bottle, so a default per-recipe number is noise).

## #20 — ingredients schema
```sql
CREATE TABLE ingredients (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT NOT NULL UNIQUE,
  category             TEXT,              -- search label; flat, not a hierarchy
  default_unit         TEXT,              -- pre-fills the recipe-line unit; overridable
  purchase_amount      REAL,              -- fallback price data (all nullable)
  purchase_unit        TEXT,              -- ml/oz/g/each/bag; may differ from default_unit
  purchase_price_cents INTEGER,           -- integer cents (matches pledges.amount_cents)
  price_updated_at     INTEGER            -- unix seconds; staleness signal
);
```
Build: store + admin CRUD + public browse/sort/filter, seeded from `ingredients.csv`.

## #21 — recipes schema
```sql
CREATE TABLE recipes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  subtitle    TEXT,
  category    TEXT NOT NULL,              -- cocktail|mocktail|punch|syrup|infusion|prep
  is_original INTEGER NOT NULL DEFAULT 0,
  notes       TEXT,                       -- prep notes / nuance live here
  source      TEXT                        -- nullable attribution (Alton Brown, Death & Co)
);

CREATE TABLE recipe_ingredients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id     INTEGER NOT NULL REFERENCES recipes(id),
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  position      INTEGER NOT NULL,         -- listed order; preserves intentional dup rows
  quantity      REAL,                     -- nullable = garnish / to-taste; ranges → one number
  unit          TEXT,                     -- defaults from ingredient.default_unit; any unit ok
  is_garnish    INTEGER NOT NULL DEFAULT 0 -- groups into an optional "Garnish" section
);

CREATE TABLE recipe_steps (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id),
  position  INTEGER NOT NULL,
  step      TEXT NOT NULL
);
```
Notes:
- **50 recipes** (the Mixel "Gingerbread Syrup" *recipe* is dropped; the
  `gingerbread syrup` *ingredient* stays). 16/50 have **no steps** — keep empty,
  don't invent.
- **No per-recipe slug.** Recipes show in a table on `/cocktails`; detail opens in
  a **modal** (open → close → open another). Keyed by `id`.
- **Garnish** = the `is_garnish` flag on a line, rendered in its own optional
  section; the garnish *form* is that line's `unit` (twist/peel/wheel/…).
- **Super / pseudo juice = a prep recipe ONLY, never an ingredient.** Recipes
  reference `lime juice` / `lemon juice`; super juice is a cheaper *cost-source*
  for them (the link is a #22 concern). Principle: the catalog holds what cocktails
  call for *by name* — no cocktail names "super juice".

## #21 — name bridges (raw Mixel name → grunglebird ingredient)
The recipe pass maps `recipes.json` ingredient names onto `ingredients.csv`.

**Clean 1:1 renames:** Bourbon whiskey→`bourbon` · rye whiskey→`rye` ·
white vermouth (sweet)→`blanc vermouth` · bar sugar→`sugar` · Grenadine→`grenadine` ·
orgeat syrup→`orgeat` · Sriracha→`hot sauce` · Cream of coconut (Lopez)→`cream of coconut` ·
Coffee Beans→`coffee beans` · half-and-half→`half and half` · Irish Cream→`Irish cream` ·
Bourbon Cream→`bourbon cream` · cardamom→`green cardamom` · cinnamon stick→`cinnamon stick`.

**Folds / consolidations:** London dry gin→`gin` · orange Curaçao + Curaçao→`dry curaçao` ·
Herbsaint→`absinthe` · Funky Jamaican Rum→`Smith & Cross` · light overproof rum→`Wray & Nephew` ·
overproof Demerara rum→`Planteray OFTD` · espresso→`cold brew concentrate` ·
ground coffee→`coffee beans` (+ "coarse grind" in prep notes) ·
cinnamon bark syrup + Cinnamon Syrup→`cinnamon syrup` ·
Crude Tropi-500 bitters→`tiki bitters` · Crude No No Bitters→`spicy bitters`.

**Needs per-recipe judgment (Mike resolves during the pass):**
- rum: old "aged rum" / generic "rum" → `aged Spanish rum` vs `aged Jamaican rum`.
- amaro: "Amaro" (Paper Plane = Nonino) → `light amaro`; "Amaro Montenegro" → `medium amaro`.
  (Paper Plane: prep note "Nonino is the original spec; subs welcome".)
- tea: "tea" → `black tea` / `green tea` / `Earl Gray tea`.
- egg: → `egg (whole)` / `egg (white)` / `egg (yolk)`.

**Dropped:** Hazelnut bitters (discontinued, garnish-only — Espresso Martini loses
it); the Gingerbread Syrup recipe and its unique inputs (clove, ginger, molasses,
vanilla extract).

## #22 — pricing / cost (deferred follow-on)
- Cost calculator is **its own tool**, not on the recipe view by default.
- Computes from the ingredient `purchase_*` fallbacks; **degrade gracefully** to a
  partial estimate when a price is null.
- `purchase_unit` (buy 750 ml) commonly differs from `default_unit` (pour oz) — the
  calculator does the conversion (oz↔ml).
- Super juice ↔ lime/lemon juice cost-source link is designed here.
