# Control plane (first slice)

One place for an Admin to see whether the platform is alive, what ran, what failed and whether each integration works. It extends the System pages; it does not replace them. Off unless `NEXT_PUBLIC_CONTROL_PLANE=1` (build-time, default off): the page answers 404 and the nav item is hidden. Open it at **Settings > Control plane** (`/settings/control-plane`), also linked from System overview and System status.

**Who can see it: ADMIN only**, through the central access registry (area `control-plane`, view and manage held by nobody but ADMIN). MARKETING, MANAGER and every other role get the standard refusal and no nav item, command-palette entry, page, action or notification.

## The four tabs

| Tab | Answers | Source |
| --- | --- | --- |
| Health | Is the platform alive? Open alerts, scheduler heartbeat and last tick, database and migrations, queues, WhatsApp, data freshness, audit chain, release, and the 14 diagnosis questions with how much each is answered | `SystemHeartbeat`, `JobRun`, the System status collector |
| Jobs | What ran and what is late? Every scheduled job (32) and every inbound webhook route (11): schedule, last run, duration and trend, 24 h and 7 d success, next due, state in words | `JobRun` |
| Failures | What is stuck and can I retry it? Failures grouped by job or source and error class, with first seen, last seen, count, still failing or recovered, a Retry where it is safe, and "customer data: not lost / may be lost / cannot be told here" | `JobRun`, failed `LeadIntake`, failed WhatsApp sends, CleverTap and WhatsApp account errors, agent drafts waiting over 24 h |
| Integrations | Is each external system working? Working, needs a look, down, not tested, mock, flag off, needs setup, switched off; last success, last error class, rate-limit or sign-in problem, feeding jobs, link to its settings | the System status integration list plus the feeding jobs' runs (`integration-map.ts`) |

Every panel is read separately: one that fails shows "Could not read X (class)" and the rest still render. A missing table shows one banner ("Control plane tables are not installed: run migrations"). Every state is an icon and a word, never colour alone. Never shown: secret values, connection strings, driver error text, customer names or free text. Refresh is limited to once per 10 seconds.

## How runs are recorded

- Every cron job (the 30 that existed plus `pruneJobRuns`, `evaluateAlerts` and, from Wave 1, `ai-run-retention`) and the 11 webhook and ingest routes write a `JobRun` row: job key, kind (CRON, WEBHOOK, MANUAL, RETRY), status (OK, SKIPPED, FAILED, TIMEOUT, ABANDONED, REJECTED), start, finish, duration, attempt, error class, a scrubbed message (never for database errors), counts only, trigger and deploy ref.
- The job registry (`src/lib/system/job-registry.ts`) is the single list. A test fails if the tick runs a job that is not in it, or it lists one the tick never runs. Keys are the existing `runJob("...")` names.
- Recording never changes a job: results and failure behaviour are exactly as before, one job's failure never stops the next, and persistence failures are swallowed (time-boxed to 1 s each) and only mark `persistFailed` on the tick row. A job over 3x its expected time is **reported** as TIMEOUT; it is never cancelled.
- The tick keeps its lease (`cron_tick_lock`, 300 s), heartbeat-first order, `?wait=1` and `after()` behaviour. Rows are buffered and written in batches (at most 4 statements for a full tick). A tick skipped by the lease is recorded as SKIPPED "lease held". A tick still RUNNING after its lease plus a minute is marked ABANDONED by the next alert evaluation.
- Webhooks: `withRunRecord(spec, handler)` records after the response is decided and never reads the body. 2xx is OK, 401 and 403 are REJECTED (a counted security signal, no body or header stored), other 4xx are OK with the status as a count, 5xx or a throw is FAILED. The WhatsApp outbox poll records only failures.
- Retention (`pruneJobRuns`, in the tick, at most 5,000 rows per tick): SKIPPED 3 days, OK cron 14, OK webhook 7, FAILED, TIMEOUT, ABANDONED and REJECTED 90. The newest row of every job and every open alert are always kept; resolved alerts go after 180 days. There is no separate daily summary table in this slice: the screens need 7 days of rates.

## Retry (the only action besides acknowledge)

An Admin can re-run a failed job once, and only if the registry marks it `safeToRun` (idempotent by design): `retryFailedLeads`, `merge-suggestions`, `refreshStaleIntelligence`, `pruneSecurityTables`, `pruneJobRuns`, `runDailyAuditChainCheck`, `meta-ads-sync`, `google-ads-sync`, `backoffice-import`. Everything that sends a message or an email is not. A retry goes through the tick's own lease (so it cannot overlap a tick), is recorded as a RETRY run with `attempt + 1`, is capped at 5, and writes an audit row (`control_plane.retry`). Failed lead intakes can be retried per lead (`retryLeadIntake`, capped at 5, a double click processes the lead once). Webhook failures are not retried by hand: the sender redelivers and the body is deliberately not stored.

## Alerts

`evaluateAlerts` runs at the end of every tick and, at most once a minute, when the page loads. Rules: `heartbeat-stale`, `tick-overrun`, `job-failing:<job>` (3 in a row), `job-late:<job>`, `outbox-depth`, `lead-intake-failed`, `integration-down:<key>`, `integration-degraded:<key>`, `webhook-rejected-spike:<job>`, `jobrun-persist-failing`. One open row per key; resolved when the condition clears. Each new alert creates one in-app Notification per active ADMIN (type `control_plane_alert`), again at most once per 24 hours while open and unacknowledged. Acknowledge suppresses re-notification and keeps the alert in the strip. A CRITICAL alert offers an **email draft** with no recipient to copy or open in your own mail program. **The system sends no email, message or push.**

Thresholds have safe defaults in `alert-config.ts` and can be overridden with `CONTROL_PLANE_ALERT_*` variables (`HEARTBEAT_STALE_MINUTES`, `JOB_FAILING_CONSECUTIVE`, `OUTBOX_DEPTH`, `OUTBOX_OLDEST_MINUTES`, `LEAD_FAILED_24H`, `LEAD_UNRETRIED_MINUTES`, `WEBHOOK_REJECTED_COUNT`); a value outside its bounds or not a number is ignored.

Not built in this slice (their sources arrive later through the same rule list): `flags-invalid` (needs the flag registry), `db-slow`, `job-not-reached`, agent cost cap, consent coverage, dead letters, conversion outbox.

## Files

`src/lib/system/`: `job-registry`, `job-run`, `job-run-db`, `webhook-run`, `with-run-record`, `job-retention(-db)`, `alert-config`, `alerts`, `alerts-db`, `integration-map`, `integration-status`, `failures`, `failures-sources`, `job-retry(-db)`, `job-runners`, `control-plane-db`, `control-plane-model`, `control-plane-read`, `diagnosis`, `control-plane-flag`. UI: `src/app/(dashboard)/settings/control-plane/`. Migration: `20270410000000_control_plane_job_run` (two new tables, no foreign key, no change to any existing table).

## Tests

Unit tests run with `npm test`. The real-database suite is opt-in and refuses a non-local database: `CONTROLPLANE_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch> npx vitest run src/lib/system/job-run.db.test.ts` (run it on its own). For the layout budget and screenshots, seed synthetic runs into a scratch database first (a seed script lives outside the repository) and run `LB_BASE=... npm run layout-budget -- --only control-plane`.

## Rollback

Unset `NEXT_PUBLIC_CONTROL_PLANE` (needs a rebuild): the screens and nav item vanish. The tick tolerates a missing table, so even an un-migrated database keeps ticking. The two tables stay, and retention keeps them small.
