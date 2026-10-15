# Hosting the Allvest Customer OS: handover for Sohel

Plain-English, one page. Companion files in this folder: `production.env.example` (the app's environment) and
`postgres.env.example` (the database). Both contain placeholders only. Do not put real values in git, chat or email.

## 1. What runs

| Piece | What it is | Notes |
|---|---|---|
| App | One Next.js container (Node, standalone build), running as non-root | Stateless: run 1 or more pods. Public via your load balancer over https. |
| Cron tick | An in-cluster Kubernetes CronJob named `supportify-tick`, every 5 minutes | It POSTs `/api/internal/cron/tick` with the header `x-cron-secret: <CRON_SECRET>`. This is the app's scheduler: briefs, syncs, audit-log backup, health heartbeat. Exactly one scheduler should call it. |
| Postgres | One PostgreSQL database (16 recommended) | Two roles: an **owner** role that runs migrations, and the restricted **`supportify_app`** role that the app uses. |
| Optional | WhatsApp worker (`whatsapp-worker/`) | Separate service. Do NOT deploy it for go-live unless the owner asks. |

The cron tick is part of the product, not a nice-to-have. If it stops, `/api/health` turns 503 on the Customer OS build
(see step 6) and nothing scheduled runs.

## 2. Order of steps (do them in this order)

1. **Back up.** Take a managed backup / PITR point of the production database inside the company cloud and note its
   timestamp. Do not download it to a laptop. This is the only way to roll the database back.
2. **Restore-test on a copy.** Restore that backup into a separate database. Run steps 4 and 5 against the copy, time the
   migrations (the audit-log backfill is the slow one), and run `setup-app-role.mjs check`. Do not let the copy reach real
   integrations (it must not use production CleverTap/WhatsApp/SendGrid credentials). Only continue when this works.
3. **Set the environment.** Fill `production.env.example` from your secret manager (checklist in section 6). Build the
   image with the `NEXT_PUBLIC_*` values as build args: they are baked in at build time. `NODE_ENV=production`,
   `APP_ENV=production` (and `VERCEL_ENV=production` on builds without `runtime-env.ts`, see the file) must be set.
4. **Run migrations once, as the owner role.** From a one-off job or shell that has the owner connection string:
   `DATABASE_URL="$DIRECT_DATABASE_URL" npx prisma migrate deploy` (Prisma 7 reads `DATABASE_URL` in `prisma.config.ts`, so
   map the owner URL onto it for this command only). Then create/refresh the restricted role:
   `node scripts/db/setup-app-role.mjs setup` and prove it with `... check` (see `postgres.env.example`).
   Decision for you: the supportify image's start command is `migrate deploy && node server.js`, which runs on every pod
   start using the pod's `DATABASE_URL`. With the restricted role that step will fail, and giving the pod the owner URL
   defeats the point of the split. Preferred: run migrations as a one-off Job (this step) and start pods with
   `node server.js` only. Confirm how your Helm chart is set up; the Dockerfile and probes live in the supportify and
   git-ops repos, which this folder does not cover.
5. **Start the app** with `DATABASE_URL` set to the restricted `supportify_app` role. If it refuses to start, read the
   pod log: the start-up flag check names the exact rule that failed. Do not set `FLAG_CHECK=warn` to hide it.
6. **Health check.** `GET /api/health` must return 200. On this tree it also reports `scheduler: "ticking"` once the
   CronJob has run (503 with `never-ran`/`stale` otherwise, so create the CronJob first or the probe will restart pods).
   On the supportify port `/api/health` is a static `{ok:true}` and the database/scheduler detail is at
   `/api/health/status`. Use `/api/health` for the Kubernetes probe, `/api/health/status` for monitoring.
7. **First admin login and forced password reset.** The database already holds the real users. Migration
   `20261022000000_force_password_reset` marks every active Admin, Manager and Team Manager as "must change password" and
   signs them out, so each of them sets a new password at their next sign-in (they are sent to `/change-password`).
   Warn them before the window. The first Admin then opens `/go-live` and Settings > System status: required names must
   show as Set. A brand-new empty database has no Admin, and the seed scripts (which create `@supportify.local` users with
   a known password) refuse to run against anything but a local database. There is no supported bootstrap yet; ask the
   owner before creating the first Admin by hand.
8. **Turn flags on one at a time.** Start with the first-week set in section 7 of `production.env.example`. For each
   later flag: change one value, restart (or rebuild for `NEXT_PUBLIC_*`), verify one test record, then move on. Every
   outbound flag needs the owner's explicit approval first.

## 3. What must NOT be set

- `NEXT_PUBLIC_DEMO_MODE` (build time), `DEMO_MODE`, `CLOSED_LOOP_DEMO`, `PARTNER_ALLOW_SAMPLE`, `PARTNER_SOURCE=sample`,
  `KYC_AUTOMATION_PROVIDER=mock`, `AI_PROVIDER=fake`, `PUSH_DRY_RUN=1`.
- Never `source` or mount `ci/flags-all-on.env` or `docs/profiles/demo.env` / `all-on.env`. The `go-live.env` profile is not
  safe unedited either (it turns on SSO-only, ad syncs and ingest).
- Never run a demo or seed script against production: `prisma migrate reset`, `prisma/seed*.ts`, `scripts/decision/seed-demo.ts`,
  `scripts/layout-budget/*`. They create `@supportify.local` users with known passwords. After go-live, the Admin runs the
  `/go-live` check "No demo or test accounts remain".
- `DAILY_BRIEF_EVENING_ENABLED` must be explicitly `0`: unlike every other flag it is ON when unset.
- Do not enable `SSO_ONLY` without a break-glass list, and do not turn any outbound flag on without approval.

## 4. The two risky migrations (read before step 4)

1. **`20261008000000_tamper_evident_audit_log`**: adds a hash chain to `AuditLog`, backfills every existing audit row one
   by one, then installs triggers that make the table **append-only for every role** (no UPDATE, DELETE or TRUNCATE).
   Run time grows with the size of `AuditLog` and audit writes are blocked while it runs. It cannot be undone in place:
   the only way back is the pre-cutover restore point. (Its companion `20261009000000_audit_chain_security_definer` needs the
   owner role to be allowed to `ALTER FUNCTION`; if it fails, `migrate deploy` stops with `P3009` and every later start
   fails until the owner resolves it. Do not use `migrate resolve` on production without asking.)
2. **`20261022000000_force_password_reset`**: signs out and forces a password change for every active Admin, Manager
   and Team Manager at the moment it runs. Schedule it in a maintenance window and tell those people first.

Also irreversible: the `MARKETING` role value (`20270401000000`), and the client identity-key backfill
(`20261023000000`, full-table updates on Client and AccountHolder). All other new migrations only add tables or columns.

## 5. Rollback

- **Database:** restore the pre-cutover PITR point. Anything written after the cutover is lost, so freeze writes during
  the window. Decision rule: if a migration fails or the audit-log step outlasts the window, stop, restore, keep the old image.
- **Code only:** revert the image tag. This is generally safe because the new schema is additive, but an older image
  running `migrate deploy` against a newer database is untested: try it on the restored copy first.
- **Flags:** change the env value and restart (rebuild for `NEXT_PUBLIC_*`). `AI_KILL_SWITCH=1` stops all AI calls and
  `CLOSED_LOOP_KILL_SWITCH=1` stops all conversion sends, with no deploy.

## 6. Secrets you must create yourself (store in a secret manager, never in git)

Tick each off. Generate with `openssl rand -hex 32` unless noted.

- [ ] `AUTH_SECRET` (signs sessions; changing it signs everyone out)
- [ ] `CRON_SECRET` (identical value in the app and the `supportify-tick` CronJob)
- [ ] `ENCRYPTION_KEY` (64 hex characters; generate ONCE; if production already has saved integration credentials, reuse
      the existing key; keep a sealed offline copy: losing it means re-entering every credential)
- [ ] Owner role name and password (`POSTGRES_USER`, `POSTGRES_PASSWORD`, used in `DIRECT_DATABASE_URL`)
- [ ] `APP_DB_PASSWORD` for the `supportify_app` role (24+ characters; goes into `DATABASE_URL`)
- [ ] `DATABASE_URL` and `DIRECT_DATABASE_URL` strings with `sslmode=require` (the owner string only for the migration job)
- [ ] `AUTH_URL` / `NEXTAUTH_URL` (the public https address; not a secret, but required)
- [ ] When the owner approves them: `APP_SIGNUP_SECRET`, `PORTFOLIO_FEED_SECRET`, `DEVICE_HASH_KEY`, `WHATSAPP_WORKER_SECRET`,
      `META_WEBHOOK_VERIFY_TOKEN`/`META_APP_SECRET`
- [ ] Received from others and stored by you: AI provider key(s) (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) plus
      `AI_PURPOSE_BUDGETS_USD` or `AI_BUDGET_DEFAULT_USD`; `SENDGRID_API_KEY` (Mail Send only); Keycloak issuer/client
      id/secret; Google sign-in id/secret; `GCHAT_LEAD_WEBHOOK_URL`; `FIREBASE_SERVICE_ACCOUNT_JSON`
- [ ] Audit-log backup: an Object-Lock S3 bucket and a Put/Get-only IAM key (`AUDIT_ANCHOR_*`)
- [ ] Not yours to store: WhatsApp, CleverTap, Freshdesk, Meta Ads, Google Ads and Exotel credentials are typed by an
      Allvest Admin into Settings > Apps & Integrations inside the app (encrypted with `ENCRYPTION_KEY`).

## 6a. Things to confirm with the owner before go-live

- Which image builds you deploy: if it lacks `src/lib/security/runtime-env.ts`, you need `VERCEL_ENV=production` in the pod env.
- How `NEXT_PUBLIC_*` reach the image build (the dev workflow passes no build args, so those screens would be off).
- Probe settings point at `/api/health`, and one scheduler only calls the tick.
- The production Postgres major version, size and `_prisma_migrations` contents (unknown at the time of writing).
