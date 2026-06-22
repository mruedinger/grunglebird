# Changelog

Notable changes to grunglebird that land on `main`. This tracks **significant**
changes only — new features, auth/security changes, data-model or infrastructure
shifts. Trivial changes (styling tweaks, copy edits, small bug fixes, refactors)
are intentionally left out to keep this readable.

## 2026-06-22

### Added
- **Beach bar: cost the event from the service log.** A new admin-only tool on the beach-bar
  event page bridges the service log to the recipe DB and cost engine. Reconcile each logged
  drink to a recipe in three tiers — identical names match silently, near/abbreviated names
  are flagged with a suggestion to confirm, unmatched names link out to `/cocktails` — or
  dismiss a drink as non-costable. Once every drink is sorted it rolls the event up into a
  per-cocktail table and a grand total, with a pricing-review step: an aggregate ingredient
  list, an event-wide lime/lemon → super-juice toggle, per-ingredient price overrides (a
  bottle/purchase price, never mutating the shared catalog), and flat incidentals. Pricing
  degrades gracefully — a missing price marks a partial, never a block. An admin can publish
  **only the overall total** to the public Stats section (a snapshot that holds until
  re-published); per-cocktail and ingredient pricing never reach the public. New D1 tables
  (migration `0008`): `event_drink_resolutions`, `event_ingredient_prices`, `event_incidentals`,
  `event_cost_settings`. (#80)

## 2026-06-18

### Added
- **Recipe scaling & units.** The recipe view gains a batch control at the foot of the
  modal: step or type a multiplier to scale every build amount live, and a unit button that
  cycles a recipe's real-volume lines (oz/ml/tsp) through as-written → ml → oz. Garnishes
  stay as written; count/fuzzy build units (dashes, each) scale too but never convert.
  Nothing is persisted — scaling and conversion only change what's shown.
  Backed by a new shared conversion primitive (`src/lib/units.ts`) covering volume
  (ml/oz/tsp/dash) plus a couple of count ratios (wedge = ⅛ each, sprig = 6 leaf). It also
  closes the cost estimator's cross-unit gap: mismatched-unit lines that read "partial"
  before now cost out through the same table, with trace drop/pinch amounts treated as
  negligible rather than partial. (#24)
- **Cost estimator.** `/tools` gains a public "Cost" section: a sortable, searchable
  table with one row per recipe, each expandable to a per-ingredient breakdown.
  Estimates come from the ingredients' price-fallback data and degrade gracefully — a
  missing price, a missing yield, or a unit we can't convert yet shows a clearly-marked
  partial with the known subtotal still totalled (never a block). An ingredient can draw
  its cost from a prep recipe (simple syrup) or a cheaper prep substitute (lime juice →
  super juice) through a new cost-source link, and recipes carry an optional batch yield
  so a prep's cost becomes a per-unit price. New D1 columns (migration `0007`):
  `ingredients.cost_recipe_id` and `recipes.yield_amount`/`yield_unit`, edited from the
  existing `/cocktails` admin modals. Cost stays off the recipe view by design.
  Cross-unit conversion is deferred to #24; until it lands, mismatched-unit lines read
  partial. (#22)

## 2026-06-15

### Added
- **Beach bar stats.** `/events/framily-beach-bar-2026` gains a public, read-only
  Stats section below the menu: overall callouts (drinks poured, unique guests,
  house favorite, drinks in rotation), a drinks-per-night chart, a top-drinks
  ranking, and a per-night breakdown that's collapsed by default and expands to
  that night's drink tally. Sourced strictly from the service log's night-level
  aggregates — no guest names or per-guest data reach the public view. No schema
  change. (#75)

## 2026-06-12

### Added
- **Service log.** `/events/framily-beach-bar-2026` gains an admin-only log for
  transcribing each night of service from paper: date, open/close times, guests,
  per-drink tallies (menu drinks pre-listed, off-menu free-form), optional
  per-guest favorites, and notes. New D1 schema (migration `0006`) keeps
  guests and drinks as consistent cross-night identities and is keyed by event
  slug for reuse at future events. Signed-out visitors see the poster unchanged.
  Data capture only — analytics comes later. (#72)
- **Cheat sheets.** `/cocktails` gains a "Cheat Sheets" section between recipes
  and inventory: a static quick-conversion table (deliberately imprecise head-math
  values) and a curated preferred-bottles table mapping generic recipe ingredients to
  the actual bottles to buy. Read-only content, no schema change. (#69)

### Changed
- **Beach bar poster rework.** `/events/framily-beach-bar-2026` drops the pledge
  meter, form, and list in favor of a Donate section — Venmo link + QR code,
  suggested $3 per drink. The menu is now a single card (Favorites / Tiki /
  Classics / Mocktails) with per-drink ingredient lines mirroring the recipe DB.
  The now-unused `/api/pledges` endpoints remain; removal is a follow-up.

## 2026-06-11

### Added
- **Cocktail recipe DB.** `/cocktails` now leads with the recipe book: a new D1
  `recipes` + `recipe_lines` schema (migration `0005`) stores ordered ingredient
  lines referencing the inventory, a clearly-optional garnish section, unnumbered
  method steps, and notes. Everyone browses, sorts, and searches (all fields,
  case- and accent-insensitive); a row opens the recipe in a modal. Admins build,
  edit, reorder, and delete recipes in that same modal. Seeded with the 56 curated
  recipes. Units gain `leaf`, drop `peel`; deleting an inventory ingredient a
  recipe still uses is now refused with the recipes that hold it. (#21)

### Removed
- **One-time ingredient seed path.** Retired the stale committed ingredient seed
  artifact and generator after the production inventory moved ahead of the original
  first-pass seed. Production D1 is now the source of truth for ingredient rows; schema
  still lives in migrations. (#20)

## 2026-06-07

### Added
- **Cocktail ingredient inventory.** `/cocktails` is now a working, admin-curated catalog
  instead of a stub. A new D1 `ingredients` table (migration `0004`) holds the flat
  ingredient list — name, search-label category, default unit, and optional price-fallback
  data (what's bought, how much, for what, last updated). Signed-in admins create / edit /
  delete through a modal; everyone browses, filters by name/category, and sorts. First
  slice of the cocktails-catalog epic; the price data is stored here, the cost tool that
  uses it is a later chunk. (#20)

## 2026-06-03

### Added
- **Worker types drift guard.** CI now regenerates `worker-configuration.d.ts`
  (`npm run generate-types`) and fails if the committed copy is stale — part of the
  `Required checks` gate. A wrangler bump ships a newer workerd and silently leaves the
  checked-in types behind (Dependabot won't regenerate them); this catches that on the
  bump's own PR instead of letting it surface later on an unrelated change.
- **Off-scale dimensions now fail CI.** `npm run lint:styles` rejects a hardcoded
  `px`/`rem` (or `em` on `font-size`) for `font-size`, `margin`, `padding`, and
  `border-radius` on standard pages — so a page can't reintroduce an off-scale value the
  design system already has a scale step for. `gap`, widths, and heights stay on the
  review checklist. A deliberate one-off needs a reasoned `stylelint-disable … -- reason`
  (bare disables now error), so every exception lands in the diff. This closes epic #34's
  enforcement step. (#38)

### Removed
- **`/juice` superjuice calculator.** The parked, unlinked pseudo-citrus calculator is
  retired (long marked for removal); its raw dimensions were the last off-scale holdout. (#38)

## 2026-06-01

### Added
- **Design system + living styleguide.** `src/styles/global.css` is now the complete
  visual registry — named type, spacing, sizing, and radius scales plus the full catalog
  of shared primitives (neon hero, headings, subhead, body copy, buttons, inputs, card,
  badge, promo, table, modal, alert) built from those tokens. A new public-but-unlinked
  `/styleguide` renders every token and primitive on one page as the review/acceptance
  surface. Appearance only — no page migration or new lint enforcement yet (epic #34
  items 2/3). (#36)

### Changed
- **New look: "Dive Bar."** The default palette moves to a dark-scarlet "dive bar"
  umbrella, and the display font from Fraunces to Bricolage Grotesque. Because every page
  consumes the shared tokens, the whole site retints and retypes at once; per-event
  theming (`[data-theme]`, e.g. beach) still works. (#36)
- **More legible input fields.** Inputs now use a dedicated `--control-border` token
  (distinct from the decorative `--hair` hairline) over a deeper well, so a field reads as
  a defined control whether it sits on the page or in a card. It stays dim by default and
  bumps to a higher-contrast edge under `prefers-contrast: more` — an opt-in accessibility
  boost that leaves the default look untouched. (follow-up to #36)

## 2026-05-30

### Added
- **Styling guardrail.** `npm run lint:styles` now enforces the centralized-styling rule
  automatically on every PR (a step in the `Required checks` gate): Stylelint forbids
  hardcoded colors and local re-declaration of shared primitives in `.astro` `<style>`
  blocks, and a companion scan catches color literals in inline/SVG attributes. The token
  stylesheet and event poster pages are exempt; the events listing stays enforced. Editor
  feedback is wired up via `.vscode`, and the mechanism — including how to deliberately
  override it and a review checklist for what can't be linted — is documented in
  `docs/styling.md`. (#13)

## 2026-05-29

### Added
- **Continuous integration.** Every PR to `main` now runs `astro check` + `astro build`
  via GitHub Actions, rolled up into a single required `Required checks` status that
  branch protection enforces — a failing check or build blocks the merge. This is the
  safety net between a PR and the auto-deploy to production; direct pushes to `main`
  stay open for trivial admin edits. Future checks (style lint, tests) slot in without
  touching branch protection. (#16)
- **Automated dependency & security maintenance.** Dependabot alerts and security
  updates are enabled, plus a `dependabot.yml` that opens grouped monthly version-update
  PRs for npm and GitHub Actions — so the project flags vulnerabilities and resists
  dependency rot without hands-on attention. Secret scanning with push protection is
  also on.

## 2026-05-27

### Changed
- **Brand mark + favicon: scarlet ibis.** Replaced the placeholder bird in the nav with a
  real mark — a scarlet ibis silhouette (CC0, derived from a US Fish & Wildlife Service
  line drawing by Bob Hines) — and added a matching SVG favicon (none existed before).
  The Campari umbrella accent shifts from pink-red (`#ff5a6e`) to true scarlet (`#ff2d2d`)
  so the mark reads as the bird it is; the brand now lifts on hover to set up future
  auth-state treatments. (#10)

## 2026-05-26

### Changed
- **Site redesign: landing page + nav shell + information architecture.** `/` is now an
  about-style home instead of the Mike's Beach Bar pledge page. A shared header nav (Cocktails ·
  Tools · Events, with the admin affordance shown only when signed in) and a site-wide footer
  wrap every page. Styling is centralized into one stylesheet + one design-token set — the
  "Campari" dark theme by default, themeable per event via token overrides. New routes:
  `/cocktails`, `/tools` (spirit-finder stub), and `/events`; the Mike's Beach Bar page (with
  its pledge form) moved intact to `/events/framily-beach-bar-2026`, and the juice calculator
  to `/juice`. (#9)

## 2026-05-24

### Changed
- **Admin authentication: replaced Cloudflare Access with self-hosted passkeys (WebAuthn).**
  Signing in at `/admin` now uses a passkey (stored in 1Password, synced across
  devices) instead of Cloudflare Access. Sessions are an HMAC-signed cookie —
  rotating the `SESSION_SECRET` secret signs everyone out. Admin credentials live
  in Cloudflare D1, with a one-time recovery code as a backup sign-in method.
  No users table — single-admin by design. (#6, PR #8)
