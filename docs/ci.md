# Continuous integration

Every check CI runs is an npm script, so a developer runs exactly what CI runs. Nothing in CI needs a secret, a provider key
or an outbound network call: tests use fixtures, the database is a throw-away Postgres, and `EVALS_REAL_PROVIDER` is never set.

## The matrix (`.github/workflows/ci.yml`, every pull request and every push to `main` / `allvest/train`)

| Job | Runs when | What it runs | Local command |
| --- | --- | --- | --- |
| `changes` | always | decides which heavy jobs a PR needs (`scripts/ci/changed-paths.mjs`); docs-only and Android-only changes stop at `static` | `node scripts/ci/changed-paths.mjs origin/main` |
| `static` | always | prisma generate, typegen, typecheck, **lint ratchet**, **AI gateway boundary** (`npm run ci:ai-boundary`: no model SDK, vendor URL or raw provider factory outside `src/lib/ai/gateway`), CI-script unit tests, **migration order and additive-only lint**, db-suite registry | `npm run typecheck`, `npm run ci:lint-ratchet`, `npm run ci:scripts-test`, `npm run ci:migration-order` |
| `unit` | code changed | `vitest run`, 4 shards (the `*.db.test.ts` files skip themselves without their env switch) | `npm test` |
| `db` | `prisma/**`, `src/lib/**`, `ci/**`, `scripts/ci/**`, db tests; always on push | every real-database suite, one file per database cloned from a freshly migrated and seeded template | `npm run ci:db-suites` |
| `migrations` | same paths as `db` | migrations from empty, **on top of upstream main's migrations**, schema-drift allow-list, equal schemas | `npm run ci:migrations` |
| `legacy-upgrade` | same paths as `db` | synthetic legacy database (original schema, about 0.4M rows) upgraded with the train's migrations; generator determinism | `npm run ci:legacy`, `npm run ci:legacy:determinism` |
| `build` (matrix `off`, `on`) | code changed | `next build` with every flag off (production default) and with `ci/flags-all-on.env` (the `NEXT_PUBLIC_*` flags are inlined at build time, so this is a second build); the `on` build is uploaded for `e2e` | `npm run ci:build:off`, `npm run ci:build:on` |
| `e2e` | `src/app/**`, `src/components/**`, access, nav, `prisma/**`, `e2e/**`; always on push | role-based Playwright against the flags-on build | `npm run ci:e2e` |
| `evals` | code changed | `npm run evals` (deterministic judge only) | `npm run evals` |

`npm run ci:check` runs the non-browser set in order (generate, typegen, typecheck, lint ratchet, script tests, migration order,
db-suite registry, unit tests, migrations, legacy upgrade, db suites) and prints a summary. `npm run ci:check -- --fast` skips the
three database steps; `--only <text>` runs the steps whose name contains the text.

Nightly (`.github/workflows/nightly.yml`, 02:00 IST and on demand): the large rehearsal (`LEGACY_SCALE=10`, about 4M rows, every real-DB
suite including the performance suite), the layout budget (30 routes at phone, 1440 and 1280) and axe on every screen each role can
open, both against the flags-on build, plus the agent evals and a report-only `npm audit`.

Runtime guards in the workflows: `permissions: contents: read`; `concurrency` cancels superseded PR runs; a `timeout-minutes` on every
job; the npm cache is keyed on `package-lock.json`; `.next/cache` is cached per flag set; Playwright browsers are cached by version;
Postgres runs on tmpfs; the flags-on build is built once and downloaded by `e2e`.

## Running it locally

You need Node 22+, a local Postgres (a superuser that can create databases) and, for the legacy and migration steps, `psql` and
`pg_dump` on the PATH. The scripts only ever create or drop databases whose name starts with `wt_ci_` (set `CI_DB_PREFIX` to change
it) and refuse any host that is not `127.0.0.1`, `localhost` or `::1`.

```bash
export CI_PGHOST=127.0.0.1 CI_PGPORT=5432 CI_PGUSER=postgres   # defaults; set CI_PGPORT for a non-standard port
export LC_ALL=en_US.UTF-8
npm ci
npm run ci:check            # everything except the browser run
npm run ci:e2e              # builds with the all-on flags if .next is missing, seeds wt_ci_e2e, runs the role matrix
npm run ci:e2e -- --project=rm --no-build   # extra arguments go to `playwright test`
```

Disk: a build is about 0.4 GB in `.next`; `npm run ci:e2e -- --clean` deletes it afterwards. `npm run e2e` (plain Playwright on the dev
server) still works, but the role projects sign in as six seeded users, so seed the database first with `npm run seed:e2e`.

## Lint baseline ratchet

`ci/lint-baseline.json` records the `eslint src --quiet` error count per file (today 18 errors in 10 files, all in code this work did
not touch). `npm run ci:lint-ratchet` fails when

1. the total is above the baseline,
2. a file that is not listed has an error, or
3. a listed file has more errors than before.

When the count goes **down** the check also fails, with "lower `ci/lint-baseline.json`": run `npm run ci:lint-ratchet -- --update` and
commit the new file. That locks the gain in. The baseline can only go down: `--update` refuses to raise it. Never edit it upward to get a
build green; fix the error. The long-term goal is an empty file and then `eslint` as a plain gate.

## Migrations

Prisma applies migrations in folder-name order, so the order has to match the order the train merged them in.
`npm run ci:migration-order` (no database) checks:

- folder names are `<14 digits>_<snake_case>` and no timestamp is used twice;
- every migration the train adds sorts after upstream main's last migration, and a migration introduced by a later merge never sorts
  before one introduced earlier (read from `git log --first-parent`, from `ci/migration-order-base.txt`; needs a full clone);
- no two migrations add the same value to the same enum (the second fails on a fresh database; use `IF NOT EXISTS` only on purpose);
- migrations the train adds are additive: no `DROP`, `ALTER ... DROP`, `ALTER COLUMN`, `RENAME`, `TRUNCATE`, `DELETE`, `UPDATE`, and no new
  `NOT NULL` column without a `DEFAULT`. Migrations already in upstream main are exempt (history cannot be edited).

`npm run ci:migrations` also applies the migrations twice, into scratch databases: from empty, and on top of the pinned upstream baseline
(`scripts/ci/legacy-db/baseline.txt`), and checks the applied count, that `prisma migrate diff` against `schema.prisma` prints nothing
except the ten known foreign-key statements in `ci/known-drift.txt` (they exist on upstream main too; the list can only shrink), and that
both schemas are identical. Print: `PASS` or `FAIL` per step and overall.

If `prisma migrate dev --create-only` emits those ten statements into a new migration, delete them by hand; the lint tolerates them only
because they are on the allow-list, and a migration should not carry them.

## Synthetic legacy database

`scripts/ci/legacy-db/` builds a messy database in the original (upstream main) schema state by applying only upstream's migrations
(pinned in `baseline.txt`), loads generic synthetic data (`seed-legacy.sql`: duplicate contacts, odd phone formats, soft-deleted and
merged customers, locked users, unicode, empty and very long text, a hash-chained audit log), records a fingerprint of every table,
applies the train's migrations, and `verify.mjs` proves every original table, row, column, constraint and index is unchanged, the
audit chain still verifies, no foreign key is orphaned, new tables are empty, and the schema equals a from-empty build.

```bash
npm run ci:legacy                         # scale 1: about 0.4M rows, about 30 s
LEGACY_SCALE=10 npm run ci:legacy         # nightly size, about 4M rows
node scripts/ci/legacy-db/run.mjs --generate-only --db wt_ci_mylegacy   # build one and keep it, to rehearse by hand
```

Everything is synthetic: mobiles are in the reserved `9000xxxxxx` range, e-mails end in `@example.invalid`, the password hash is a
placeholder no login can match; `run.mjs` asserts this before and after the upgrade, so the generator cannot be pointed at real data by
mistake. It never reads a real snapshot. The data is deterministic (fixed seed and time anchor).

## Real-database suites

`ci/db-suites.json` lists every `*.db.test.ts` file with the env switch it needs. `scripts/ci/db-suites.mjs` migrates and seeds one
template database, clones it per file, runs the file with its switch set, and fails if a suite ran zero tests (its switch or guard did not
take effect) or if a `*.db.test.ts` file exists that is not listed, so a new suite cannot be skipped silently. The performance suite is
nightly-only (`--nightly`).

## Role-based e2e

`prisma/seed-e2e.ts` composes the standard seeds and adds two RMs and twelve synthetic customers. `e2e/global-setup.ts` signs each of the
six roles in once through the real `/login` form and saves the session; Playwright has one project per role (`admin`, `manager`, `rm`,
`marketing`, `finance`, `partner`) plus `public` (signed out). Specs:

- `e2e/access-matrix.spec.ts`: generated from `src/lib/access/surfaces.ts` and `policy.ts` (the registry is the oracle). For each role,
  every static page opens or sends the person to their own home, and every guarded API route answers or refuses.
- `e2e/flows/f01-signin.spec.ts`: each role signs in, lands on its home and signs out; one generic error for a wrong password; signed-out
  visitors go to login.
- `e2e/flows/f03-client-task.spec.ts`: an RM opens a customer and adds a task; a manager opens a customer of their team.
- `e2e/flows/f06-segregation.spec.ts`: hand-written canaries so a registry bug cannot hide itself.
- `e2e/axe.spec.ts` (nightly): a NEW serious or critical accessibility violation fails. The ones that existed when the check was added are
  listed per role in `ci/axe-baseline.json` (`<path> :: <rule id>`), a ratchet like the lint baseline: entries are only ever removed, as
  screens are fixed (the nightly prints which entries no longer occur). To regenerate: `AXE_WRITE_BASELINE=1 npm run ci:e2e -- --axe
  --project='axe-*'` then `node scripts/ci/axe-baseline.mjs` (it refuses to add entries without `--allow-add`).

`e2e/support/fixtures.ts` fails any test whose page requests a non-local host: no flow can quietly reach an external service. The task form's
"Also create in ClickUp" box is asserted unticked and never used. Set `E2E_PORT` to move the port; `E2E_SERVER=start` serves a built app
(what `ci:e2e` does), `E2E_SERVER=dev` (default for plain `npm run e2e`) uses the dev server.

To add a flow: put `fNN-name.spec.ts` in `e2e/flows/`, import `test` and `expect` from `e2e/support/fixtures`, and add its filename pattern to
the role projects in `playwright.config.ts` if it should run under a role session.

## What CI does not do yet

Flag-profile validation (`scripts/flags/check.mjs`), the surface-diff script and the control-plane flows arrive with their own stages and
get their own jobs then. The layout-budget job on pull requests (path-filtered) is nightly-only for now. A `CODEOWNERS` file for `ci/**`,
`scripts/ci/**`, `src/lib/access/**` and `prisma/migrations/**` needs your team's handles, which this repository does not contain.
