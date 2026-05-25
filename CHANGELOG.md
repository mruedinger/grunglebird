# Changelog

Notable changes to grunglebird that land on `main`. This tracks **significant**
changes only — new features, auth/security changes, data-model or infrastructure
shifts. Trivial changes (styling tweaks, copy edits, small bug fixes, refactors)
are intentionally left out to keep this readable.

## 2026-05-24

### Changed
- **Admin authentication: replaced Cloudflare Access with self-hosted passkeys (WebAuthn).**
  Signing in at `/admin` now uses a passkey (stored in 1Password, synced across
  devices) instead of Cloudflare Access. Sessions are an HMAC-signed cookie —
  rotating the `SESSION_SECRET` secret signs everyone out. Admin credentials live
  in Cloudflare D1, with a one-time recovery code as a backup sign-in method.
  No users table — single-admin by design. (#6, PR #8)
