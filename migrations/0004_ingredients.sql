-- Flat ingredient catalog (epic #19, issue #20).
-- `category` is a search/grouping label, not a hierarchy; a specific bottle is its
-- own row. Price columns are nullable fallback data only — the cost tool is #22.
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

CREATE INDEX idx_ingredients_category ON ingredients(category);
