-- Cost estimation (epic #19, issue #22). Two nullable additions wire up the cost tool;
-- no existing data changes.
--
-- An ingredient may draw its cost from a recipe instead of (or as a cheaper stand-in for)
-- its own purchase price. ONE link covers both modeled cases: an ingredient that is really
-- a prep recipe (simple syrup -> the simple-syrup recipe) and a catalog ingredient costed
-- via a cheaper prep substitute (lime juice -> the lime-super-juice recipe). Recipes still
-- reference the plain ingredient; only costing follows this link.
--
-- No ON DELETE clause (NO ACTION, like recipe_lines.ingredient_id): deleting a recipe that
-- is still a cost source must FAIL, so the delete route turns it into a friendly 409 rather
-- than silently orphaning a cost. SQLite permits ADD COLUMN ... REFERENCES only when the new
-- column defaults to NULL, which it does.
ALTER TABLE ingredients ADD COLUMN cost_recipe_id INTEGER REFERENCES recipes(id);
CREATE INDEX idx_ingredients_cost_recipe ON ingredients(cost_recipe_id);

-- A prep recipe's batch yield: the denominator that turns its batch cost into a per-unit
-- price (amount of `yield_unit` produced by one batch). Both nullable; `yield_unit` is
-- validated app-side against the shared UNITS list. Absent yield just degrades a derived
-- cost to a marked partial estimate.
ALTER TABLE recipes ADD COLUMN yield_amount REAL;
ALTER TABLE recipes ADD COLUMN yield_unit TEXT;
