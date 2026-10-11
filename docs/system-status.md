# System status and post-cutover checks

Admin only. Settings, System Overview has a link to **System status** (`/settings/system/status`); the same data is available as JSON at `/api/system/status` (Admin session required, `Cache-Control: no-store`). The public `/api/health` for uptime monitors is separate and unchanged.

## What it shows

| Section | Source |
| --- | --- |
| Version | `VERCEL_GIT_COMMIT_SHA` (short), `VERCEL_GIT_COMMIT_REF`, `VERCEL_ENV`. Shows "unknown" when the host does not expose them |
| Database | Reachability, database name, Postgres version, round-trip time. Never the host or credentials |
| Migrations | Applied count, any failed or half-applied one, pending count (comparing with the `prisma/migrations` folder when it is part of the deployment, otherwise "unavailable") |
| Flags | Every flag in `src/lib/system/flag-registry.ts` that is exactly `1`, with build-time ones marked. A few non-secret settings are shown with their value (for example `CONSENT_RECORD_ONLY_PURPOSES`) |
| Scheduler and jobs | Last tick (stale after 15 minutes), last run of the daily jobs, ad syncs and back-office import |
| Queues | WhatsApp messages waiting to send, agent drafts waiting, conversation reviews waiting, lead intake errors in the last 7 days, open duplicate suggestions, each with the age of the oldest item |
| Integrations | Connected (live, enabled, credentials saved; not a live test), Needs setup, Mock, Flag off |
| Settings present | Variable names and set / not set. Values are never read into the page or the JSON |
| Needs attention | A short list assembled from the above |

If the database cannot be reached the page still opens and says so; the driver's error text is never shown (it can carry a connection string).

## Post-cutover checks

A list for the Admin to work through after the production address is switched. Automatic checks (database, migrations, scheduler, required settings) are computed from the live status. The rest are ticked by hand; who ticked and when are stored (existing `GoLiveCheck` table, ids prefixed `cutover:`) and each tick is audited (`CutoverCheck`).

## Keeping it honest

`flag-registry.test.ts` fails if a flag in `docs/feature-flags.md` is missing from the registry. `status.test.ts` fails if a provider in the integrations or messaging registry is missing from the integration list, and proves that no secret value appears in the result.
