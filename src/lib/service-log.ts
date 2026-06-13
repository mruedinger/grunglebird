// Service-log shared types + validation (issue #72). Mirrors recipes.ts:
// the API routes validate with this, the page SSRs its own view model.
import { normalizeSearch } from './recipes';

export type ValidNightGuest = { name: string; key: string };
export type ValidNightDrink = { name: string; key: string; count: number };
export type ValidNightAttribution = { guest_key: string; drink_key: string };

export type ValidNight = {
  event_slug: string;
  service_date: string;
  opened_at: string | null;
  closed_at: string | null;
  notes: string | null;
  guests: ValidNightGuest[];
  drinks: ValidNightDrink[];
  attributions: ValidNightAttribution[];
};

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

/** Identity key for guests and drinks: case/accent-folded, whitespace collapsed. */
export function nameKey(name: string): string {
  return normalizeSearch(name).replace(/\s+/g, ' ').trim();
}

/** Validation is deliberately lenient — this is a capture tool, not a gatekeeper.
 *  Only the date (and a sane event slug) are required; a night with no guests,
 *  no tally, and no notes is still a night. */
export function validateNight(body: unknown): ValidNight | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;

  const event_slug = text(b.event_slug);
  if (!event_slug || event_slug.length > 80) return { error: 'Event slug is required.' };

  const service_date = text(b.service_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(service_date)) return { error: 'A service date is required.' };

  const opened_at = text(b.opened_at);
  const closed_at = text(b.closed_at);
  for (const t of [opened_at, closed_at]) {
    if (t && !/^\d{2}:\d{2}$/.test(t)) return { error: 'Times must look like HH:MM.' };
  }

  const notes = text(b.notes);
  if (notes.length > 2000) return { error: 'Notes are too long (max 2000 characters).' };

  // Guests: dedupe by identity key, first spelling wins.
  const rawGuests = Array.isArray(b.guests) ? b.guests : [];
  if (rawGuests.length > 100) return { error: 'Too many guests (max 100).' };
  const guests: ValidNightGuest[] = [];
  for (const raw of rawGuests) {
    const name = text(raw);
    if (!name || name.length > 60) return { error: 'Guest names must be 1–60 characters.' };
    const key = nameKey(name);
    if (!guests.some((g) => g.key === key)) guests.push({ name, key });
  }

  // Drinks: dedupe by identity key, counts merge.
  const rawDrinks = Array.isArray(b.drinks) ? b.drinks : [];
  if (rawDrinks.length > 100) return { error: 'Too many drinks (max 100).' };
  const drinks: ValidNightDrink[] = [];
  for (const raw of rawDrinks) {
    const d = (raw ?? {}) as Record<string, unknown>;
    const name = text(d.name);
    if (!name || name.length > 80) return { error: 'Drink names must be 1–80 characters.' };
    const count = Number(d.count);
    if (!Number.isInteger(count) || count < 1 || count > 999) {
      return { error: 'Drink counts must be whole numbers from 1 to 999.' };
    }
    const key = nameKey(name);
    const existing = drinks.find((x) => x.key === key);
    if (existing) existing.count += count;
    else drinks.push({ name, key, count });
  }

  // Attributions reference guests/drinks of THIS night by name; anything else is a 400.
  const rawAttr = Array.isArray(b.attributions) ? b.attributions : [];
  if (rawAttr.length > 500) return { error: 'Too many attributions (max 500).' };
  const attributions: ValidNightAttribution[] = [];
  for (const raw of rawAttr) {
    const a = (raw ?? {}) as Record<string, unknown>;
    const guest_key = nameKey(text(a.guest));
    const drink_key = nameKey(text(a.drink));
    if (!guests.some((g) => g.key === guest_key) || !drinks.some((d) => d.key === drink_key)) {
      return { error: 'Attributions must reference the night’s own guests and drinks.' };
    }
    if (!attributions.some((x) => x.guest_key === guest_key && x.drink_key === drink_key)) {
      attributions.push({ guest_key, drink_key });
    }
  }

  return {
    event_slug,
    service_date,
    opened_at: opened_at || null,
    closed_at: closed_at || null,
    notes: notes || null,
    guests,
    drinks,
    attributions,
  };
}

// --- Statement builders shared by the POST and PATCH routes ---

/** Upserts that make guest/drink names durable identities: first spelling wins,
 *  later variants land on the existing row via the name_key UNIQUE. */
export function identityUpserts(db: D1Database, v: ValidNight): D1PreparedStatement[] {
  return [
    ...v.guests.map((g) =>
      db.prepare(
        `INSERT INTO service_guests (name, name_key) VALUES (?, ?)
         ON CONFLICT(name_key) DO NOTHING`,
      ).bind(g.name, g.key),
    ),
    ...v.drinks.map((d) =>
      db.prepare(
        `INSERT INTO service_drinks (name, name_key) VALUES (?, ?)
         ON CONFLICT(name_key) DO NOTHING`,
      ).bind(d.name, d.key),
    ),
  ];
}

/** Child-row inserts for a night whose id is produced by `nightIdSql` (either a
 *  bound `?` or a subselect), with `nightIdBind` carrying its bindings if any. */
export function childInserts(
  db: D1Database,
  v: ValidNight,
  nightIdSql: string,
  nightIdBind: unknown[],
): D1PreparedStatement[] {
  return [
    ...v.guests.map((g) =>
      db.prepare(
        `INSERT INTO service_night_guests (night_id, guest_id)
         VALUES (${nightIdSql}, (SELECT id FROM service_guests WHERE name_key = ?))`,
      ).bind(...nightIdBind, g.key),
    ),
    ...v.drinks.map((d) =>
      db.prepare(
        `INSERT INTO service_night_drinks (night_id, drink_id, count)
         VALUES (${nightIdSql}, (SELECT id FROM service_drinks WHERE name_key = ?), ?)`,
      ).bind(...nightIdBind, d.key, d.count),
    ),
    ...v.attributions.map((a) =>
      db.prepare(
        `INSERT INTO service_night_guest_drinks (night_id, guest_id, drink_id)
         VALUES (${nightIdSql},
                 (SELECT id FROM service_guests WHERE name_key = ?),
                 (SELECT id FROM service_drinks WHERE name_key = ?))`,
      ).bind(...nightIdBind, a.guest_key, a.drink_key),
    ),
  ];
}
