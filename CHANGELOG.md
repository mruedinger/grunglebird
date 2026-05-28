# Changelog

Notable changes to grunglebird that land on `main`. This tracks **significant**
changes only — new features, auth/security changes, data-model or infrastructure
shifts. Trivial changes (styling tweaks, copy edits, small bug fixes, refactors)
are intentionally left out to keep this readable.

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
