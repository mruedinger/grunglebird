# Changelog

Notable changes to grunglebird that land on `main`. This tracks **significant**
changes only — new features, auth/security changes, data-model or infrastructure
shifts. Trivial changes (styling tweaks, copy edits, small bug fixes, refactors)
are intentionally left out to keep this readable.

## 2026-06-12

### Added
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
