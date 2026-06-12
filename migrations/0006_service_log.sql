-- Nightly service log (issue #72). End-of-night transcription from paper: who
-- came, what got made, when the bar ran, anything memorable. Data capture only —
-- analytics reads come later. Nights carry an event_slug so future events reuse
-- the same schema; nothing here couples to the recipe DB (the bar menu is
-- hand-kept on the poster and off-menu drinks are first-class).
CREATE TABLE service_nights (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_slug   TEXT NOT NULL,
  service_date TEXT NOT NULL,   -- YYYY-MM-DD
  opened_at    TEXT,            -- HH:MM; closed_at earlier than opened_at just means past midnight
  closed_at    TEXT,
  notes        TEXT
);

CREATE INDEX idx_service_nights_event ON service_nights(event_slug, service_date);

-- Guests and drinks are cross-night identities keyed by a normalized name
-- (case/accent-folded app-side), so "Sara" and "sara" stay one person rather
-- than spelling variants. Rows are created on first use; deleting a night never
-- deletes them — they ARE the identity that later nights reuse.
CREATE TABLE service_guests (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE
);

CREATE TABLE service_drinks (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE
);

CREATE TABLE service_night_guests (
  night_id INTEGER NOT NULL REFERENCES service_nights(id) ON DELETE CASCADE,
  guest_id INTEGER NOT NULL REFERENCES service_guests(id),
  UNIQUE (night_id, guest_id)
);

CREATE TABLE service_night_drinks (
  night_id INTEGER NOT NULL REFERENCES service_nights(id) ON DELETE CASCADE,
  drink_id INTEGER NOT NULL REFERENCES service_drinks(id),
  count    INTEGER NOT NULL,
  UNIQUE (night_id, drink_id)
);

-- Optional per-guest attribution: presence only ("this guest had this drink").
-- The night tally above stays the source of totals; this never has to add up.
CREATE TABLE service_night_guest_drinks (
  night_id INTEGER NOT NULL REFERENCES service_nights(id) ON DELETE CASCADE,
  guest_id INTEGER NOT NULL REFERENCES service_guests(id),
  drink_id INTEGER NOT NULL REFERENCES service_drinks(id),
  UNIQUE (night_id, guest_id, drink_id)
);
