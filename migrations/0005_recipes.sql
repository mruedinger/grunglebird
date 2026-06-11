-- Recipe catalog (epic #19, issue #21).
-- A recipe is metadata + an ordered list of lines referencing the ingredient
-- inventory (#20). `method` is ordered display prose (one step per line, never
-- reordered), so it stays TEXT rather than a child table.
CREATE TABLE recipes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL UNIQUE,
  micro     TEXT,              -- in-voice subhead, optional
  type      TEXT NOT NULL,     -- app-validated against the locked RECIPE_TYPES list
  character TEXT,              -- scanning aid; required for drink types, NULL otherwise
  method    TEXT NOT NULL,     -- ordered steps, one per line, unnumbered
  notes     TEXT
);

-- One position sequence per recipe (build lines first, garnish after), derived
-- server-side from the submitted array order — the client never sends positions.
-- UNIQUE makes duplicate slots impossible even via manual SQL or a bad seed.
-- ingredient_id deliberately has no CASCADE: deleting an in-use ingredient must
-- fail (the inventory API turns that into a friendly 409).
CREATE TABLE recipe_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id     INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  amount        REAL,               -- nullable; rinse/rim/twist never carry one
  unit          TEXT NOT NULL,      -- canonical UNITS list (app-validated)
  is_garnish    INTEGER NOT NULL DEFAULT 0,
  position      INTEGER NOT NULL,
  UNIQUE (recipe_id, position)
);

CREATE INDEX idx_recipe_lines_ingredient ON recipe_lines(ingredient_id);
