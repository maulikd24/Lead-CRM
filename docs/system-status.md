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

## Flags tab

Admin only (the `settings-flags` area in the access registry), read only. It lists every feature flag and environment setting in the canonical registry (`src/lib/flags/registry.ts`): its current effective value, its default, who owns it, what it depends on and what it conflicts with, the rule violations the validator finds in this environment (with how to fix each), and how the environment compares with the five named profiles (`docs/profiles/`). A `NEXT_PUBLIC_*` flag is labelled "set at build": the value shown is the environment now, and a change shows on screens only after a rebuild. Credentials, addresses and paths show only "set" or "not set". Nothing on this tab changes a flag. The Overview tab's Needs attention list also says when the validator finds an error.

The same validator runs when a server starts: in production an error from a safety rule (FR-05, FR-10, FR-11, FR-13, FR-14) stops the boot, anything else is logged once as a `flag_check` event. `FLAG_CHECK=warn` is the break-glass that downgrades the stop to a loud log. `npm run flags:check` runs the same checks in CI.

## Post-cutover checks

A list for the Admin to work through after the production address is switched. Automatic checks (database, migrations, scheduler, required settings) are computed from the live status. The rest are ticked by hand; who ticked and when are stored (existing `GoLiveCheck` table, ids prefixed `cutover:`) and each tick is audited (`CutoverCheck`).

## Keeping it honest

`flag-registry.test.ts` fails if a flag in `docs/feature-flags.md` is missing from the registry. `status.test.ts` fails if a provider in the integrations or messaging registry is missing from the integration list, and proves that no secret value appears in the result.

## AI tab

Admin only, behind `AI_ADMIN_TAB=1` and the `settings-ai` access area. Runs by agent and purpose over the last 7 days, failure, abstain and blocked rates, p50 and p95 latency, cost today (an estimate) against each purpose's daily budget, and the agent registry with each action's autonomy level, its ceiling and the agent's kill switch. The only control on it is the existing agent kill switch; autonomy levels are shown, not edited. No prompt, answer or customer text is stored or shown. See `docs/ai-gateway.md`.
