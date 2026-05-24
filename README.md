# Grunglebird

The site at <https://grunglebird.com>. Built with
[Astro](https://astro.build) (SSR), [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
for hosting, and [Cloudflare D1](https://developers.cloudflare.com/d1/) for storage.
Admin login is self-hosted WebAuthn (passkeys) — see [Admin auth](#admin-auth).

## Donate — Mike's Beach Bar

A small donation site for stocking the bar at our summer beach trip.

- Public landing page with the menu, funding milestones ($500 / $750 / $1000),
  suggested donation amounts, and a live progress meter
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
│   ├── layouts/Layout.astro
│   ├── lib/
│   │   ├── api-utils.ts        # validation, cookies, rate limits
│   │   ├── auth.ts             # session cookie, admin guards, WebAuthn helpers
│   │   └── webauthn-client.ts  # browser-side passkey ceremony
│   └── pages/
│       ├── index.astro         # donate page
│       ├── tools.astro         # bar calculators
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
