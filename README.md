# Grunglebird

The site at <https://grunglebird.com>. Built with
[Astro](https://astro.build) (SSR), [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
for hosting, and [Cloudflare D1](https://developers.cloudflare.com/d1/) for storage.
Admin login is self-hosted WebAuthn (passkeys) — see [Admin auth](#admin-auth).

## Routes

The site is a shared shell (header nav + footer + one design-token system) that
every page renders inside. The default theme is the "Dive Bar" dark palette; a
theme is just a token-value override (`[data-theme="…"]`), so a page or event can
retint the whole shell without changing its structure. The tokens and shared
primitives are catalogued live on [`/styleguide`](https://grunglebird.com/styleguide).

| Route | What | In nav |
|---|---|---|
| `/` | Home / about — promo pill for the current event + the Grungle Bird namesake teaser | logo → home |
| `/cocktails` | Recipe & ingredient library (Grungle Bird recipe card today; built out later) | yes |
| `/tools` | Bar utilities — spirit finder (coming soon); a permanent bucket for more tools | yes |
| `/events` | Index of events; points at the current one | yes |
| `/events/framily-beach-bar-2026` | Mike's Beach Bar — the event page with its pledge form, beach-themed | via `/events` + home |
| `/juice` | Superjuice (pseudo-citrus) calculators — parked utility, not in nav | no |
| `/styleguide` | Living registry — every design token + shared primitive on one page | no |
| `/admin` | Admin sign-in / pledge management — the permanent sign-in escape hatch | affordance shown only when signed in |

## Mike's Beach Bar

The Mike's Beach Bar event page, where friends pledge toward stocking the bar
for our summer beach trip, at `/events/framily-beach-bar-2026`.

- The event page shows the menu, funding milestones ($500 / $750 / $1000),
  suggested pledge amounts, and a live progress meter
- Pledge form: name, dollar amount, Venmo handle, and a "keep my name private"
  checkbox (defaults to private)
- Public pledge list shows real names or "Anonymous"; Venmo handles are admin-only
- Pledgers can edit or delete their own pledge from the same browser without
  signing in (capability cookie tied to a per-row edit token)
- Public pledge writes have a small server-side rate limit (per-IP, not per-person) to slow down spam
- Admin page (`/admin`) gated by self-hosted passkey auth — view all pledges with
  real names + Venmo handles, mark them paid, or delete them

## Local development

```sh
npm install
npm run db:migrate:local   # one-time: apply the schema to the local SQLite D1
npm run dev
```

`astro dev` serves both the pages and the API routes against the local D1
via Cloudflare's Vite plugin. Without `db:migrate:local`, API routes will 500
with `no such table: pledges`. Admin auth is bypassed during dev (driven by
`import.meta.env.DEV`, statically removed at build time), so `/admin` shows the
table without signing in. To exercise the real passkey ceremony locally, use
`npm run preview` (DEV is false there).

To exercise the production build locally on the Workers runtime:

```sh
npm run preview            # astro build + astro preview on workerd
```

## Continuous integration

Every pull request targeting `main` runs `astro check` + `astro build` via GitHub
Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). Both roll up into a
single required status check, **Required checks**, that branch protection requires
before a PR can merge — a failing check or build blocks the merge. Since `main`
auto-deploys to production, this is the safety net between a PR and prod.

Direct pushes to `main` stay allowed for trivial edits (admins bypass the check); the
requirement applies to PR merges only. To add a future check (a style lint, tests),
add a step to the `ci` job — or a sibling job listed in the gate's `needs` — and
branch protection needs no change.

## First-time deploy

1. **Create the D1 database**

   ```sh
   npx wrangler d1 create grunglebird-db
   ```

   Copy the printed `database_id` into `wrangler.toml`.

2. **Apply migrations to the remote DB**

   ```sh
   npm run db:migrate:remote
   ```

   If your `CLOUDFLARE_API_TOKEN` doesn't have D1 write scope, paste the contents
   of the migration files into the D1 Console in the dashboard instead.

3. **Create a Cloudflare Workers Builds project** and connect this repo. In the
   Workers Builds dashboard:

   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Node.js version: `22.12` or later (required by Astro 6)
   - Bindings are read from `wrangler.toml` automatically (no dashboard setup
     needed for `DB`)

4. **Custom domain**: in the Worker → Settings → Domains & Routes, add your
   domain (e.g. `grunglebird.com`). Cloudflare adds the CNAME automatically if
   the domain is on Cloudflare.

5. **Set up admin auth** — see [Admin auth](#admin-auth) below.

## Admin auth

Admin access (`/admin` + `/api/admin/*`) is gated by self-hosted WebAuthn
passkeys. There is no users table — credential public keys live in D1
(`credentials`), and the session is a single HMAC-signed cookie. Rotating the
`SESSION_SECRET` secret invalidates every session.

**Migrating from Cloudflare Access:** if this site was previously protected by a
Cloudflare Access / Zero Trust application, **remove it** — Zero Trust dashboard
→ Access → Applications → delete the app covering `/admin`, `/admin/*`, and
`/api/admin/*`. Until it's removed, Cloudflare intercepts those routes upstream
and the new passkey sign-in surface on `/admin` is never reached.

**First-time setup:**

1. Set two secrets on the Worker:

   ```sh
   npx wrangler secret put SESSION_SECRET   # 32+ random bytes
   npx wrangler secret put SETUP_TOKEN      # any random string
   ```

2. Visit `/admin/setup?token=<SETUP_TOKEN>` on a device with 1Password. Register
   your first passkey (store it in 1Password so it syncs to your MacBook, Pixel,
   and Windows desktop). **Save the one-time recovery code it shows** into
   1Password — it's your escape hatch and is shown only once.

3. Delete the bootstrap token:

   ```sh
   npx wrangler secret delete SETUP_TOKEN
   ```

   The token is already inert once a credential exists (the setup route only
   works while the `credentials` table is empty), so this is belt-and-suspenders.

**Day-to-day:** sign in at `/admin`. The passkey syncs across devices via
1Password, or you can register additional passkeys from `/admin` once signed in.
Logging out clears the session cookie.

**Lost all passkeys?** Use the "recovery code" option on `/admin` to sign in with
the code you saved, then register a fresh passkey. A recovery code is single-use;
a new one is generated the next time you register a passkey while none is stored.

**Local dev:** auth is bypassed under `astro dev` (see [Local development]
(#local-development)). Use `npm run preview` to exercise the real ceremony.

## Project layout

```
.
├── astro.config.mjs
├── wrangler.toml
├── worker-configuration.d.ts   # generated by `wrangler types`, committed
├── migrations/
│   ├── 0001_init.sql           # pledge schema
│   ├── 0002_rate_limits.sql    # write throttle buckets
│   └── 0003_credentials.sql    # passkey credentials + auth_meta (recovery hash)
├── src/
│   ├── layouts/Layout.astro    # shared shell: header nav + footer + per-event theme
│   ├── styles/global.css       # design tokens + shared primitives (single source of truth)
│   ├── components/
│   │   └── PromoPill.astro      # reusable "what's on" promo capsule
│   ├── lib/
│   │   ├── api-utils.ts        # validation, cookies, rate limits
│   │   ├── auth.ts             # session cookie, admin guards, WebAuthn helpers
│   │   └── webauthn-client.ts  # browser-side passkey ceremony
│   └── pages/
│       ├── index.astro         # home / about
│       ├── cocktails.astro     # recipe library (Grungle Bird card)
│       ├── tools.astro         # spirit finder (coming soon)
│       ├── juice.astro         # superjuice calculators (not in nav)
│       ├── events/
│       │   ├── index.astro     # events index
│       │   └── framily-beach-bar-2026.astro  # Mike's Beach Bar event page — pledge form (beach-themed)
│       ├── admin.astro         # sign-in (unauthed) / admin table (authed)
│       ├── admin/setup.astro   # one-time bootstrap registration (token-gated)
│       └── api/
│           ├── pledges.ts          # GET (public list) / POST (create)
│           ├── pledges/
│           │   ├── me.ts           # GET self via cookie
│           │   └── [id].ts         # PATCH / DELETE self via cookie
│           └── admin/
│               ├── pledges.ts      # GET all (admin-gated)
│               ├── pledges/[id].ts # PATCH paid / DELETE (admin-gated)
│               └── auth/           # options, register, verify, recovery, logout
└── package.json
```

## License

MIT — see [LICENSE](./LICENSE).
