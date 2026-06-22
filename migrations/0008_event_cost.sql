-- Event-level cost reconciliation (epic #19, issue #80). Bridges the service log (#72) to the
-- recipe DB (#21) + cost engine (#22/#24): match each logged drink to a recipe, override pricing
-- for the event, add incidentals, and snapshot a public total. Every table is event-scoped — each
-- event owns its own reconciliation and books, so a match made here never mutates the shared
-- catalog, and editing one can't retroactively change another event's published total.

-- Per-event drink -> recipe reconciliation. recipe_id NOT NULL ⇒ matched; dismissed = 1 (with
-- recipe_id NULL) ⇒ logged but non-costable (a beer, water); a row with neither is treated as
-- unresolved. ON DELETE SET NULL on recipe_id: deleting a recipe un-resolves the drinks it matched
-- (they resurface for re-matching) rather than 409-blocking the recipe delete. The drink identity
-- cascades (a deleted service_drink takes its resolutions with it).
CREATE TABLE event_drink_resolutions (
  event_slug       TEXT NOT NULL,
  service_drink_id INTEGER NOT NULL REFERENCES service_drinks(id) ON DELETE CASCADE,
  recipe_id        INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
  dismissed        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_slug, service_drink_id)
);

-- Per-event ingredient price override: a purchase price for a purchase amount/unit (e.g. $X per
-- 750 ml bottle) — exactly the shape the cost engine reads. Overlays the fetched catalog row in
-- memory before costing; it never writes back to `ingredients`.
CREATE TABLE event_ingredient_prices (
  event_slug           TEXT NOT NULL,
  ingredient_id        INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  purchase_amount      REAL NOT NULL,
  purchase_unit        TEXT NOT NULL,
  purchase_price_cents INTEGER NOT NULL,
  PRIMARY KEY (event_slug, ingredient_id)
);

-- Flat incidental line items (ice, cups, …) folded into the grand total. Display order = id.
CREATE TABLE event_incidentals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_slug   TEXT NOT NULL,
  label        TEXT NOT NULL,
  amount_cents INTEGER NOT NULL
);
CREATE INDEX idx_event_incidentals_event ON event_incidentals(event_slug);

-- Per-event cost settings + the published public-total snapshot. The public Stats section reads
-- ONLY this row: when public_total_enabled it renders public_known_cents (marked partial if
-- public_is_partial) and never runs the cost engine, so per-cocktail / ingredient pricing can't
-- leak. The snapshot is recomputed server-side on every (re-)publish.
CREATE TABLE event_cost_settings (
  event_slug           TEXT PRIMARY KEY,
  use_pseudo_juice     INTEGER NOT NULL DEFAULT 0,
  public_total_enabled INTEGER NOT NULL DEFAULT 0,
  public_known_cents   REAL,
  public_is_partial    INTEGER NOT NULL DEFAULT 0,
  public_updated_at    INTEGER
);
