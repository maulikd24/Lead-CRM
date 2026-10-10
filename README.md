This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Database roles (audit log protection)

> **Not available on Prisma Postgres (current host).** It runs migrations as a "restricted superuser" that
> cannot `GRANT`/`REVOKE` privileges (confirmed on the 8 October 2026 production deploy), so the
> restricted role below can't be created there. On Prisma Postgres the audit log is protected by the
> append-only triggers, the hash chain and the daily S3 backup check. The steps below apply only if the
> database moves to a host that allows custom roles (e.g. Neon, Supabase, RDS).

`AuditLog` is append-only and hash-chained by database triggers. Those triggers stop the app, but the
table's **owner** can still disable them. To close that gap, the app runs as a restricted role that
does not own any table:

| Env var | Role | Used for |
| --- | --- | --- |
| `DIRECT_DATABASE_URL` | owner (existing credentials) | `prisma migrate deploy` during the Vercel build |
| `DATABASE_URL` | `supportify_app` | the running app: plain reads/writes; `AuditLog` insert + read only |

One-time rollout (and re-run `setup` any time; it is idempotent):

1. Deploy the migrations first, still on the old credentials.
2. Create the role as the owner, with a new random 24+ character password:
   `DIRECT_DATABASE_URL=<owner url> APP_DB_PASSWORD=<password> node scripts/db/setup-app-role.mjs setup`
3. Check it, logging in as the new role: every line must say PASS.
   `APP_DATABASE_URL=<same host/db, user supportify_app> node scripts/db/setup-app-role.mjs check`
4. In Vercel, set `DIRECT_DATABASE_URL` to the owner URL (if not already) and `DATABASE_URL` to the
   `supportify_app` URL, then redeploy. Settings → System → Database should show
   **Audit log protection: Restricted app role**.

Rollback: point `DATABASE_URL` back at the owner URL and redeploy. The triggers keep the log
append-only either way.

## Audit log backup to S3 (write-once)

Every day the cron job writes the audit chain's latest `seq` + `hash` to an S3 bucket with Object Lock,
then compares the last 30 days of these backups against the database. This catches the one attack the
chain check alone can't: someone with database-owner access rewriting a row *and* recomputing every
later hash. Admins are alerted on a mismatch, and once a day if the backup write keeps failing.

Settings live in env vars only, never the database, so a database owner can't redirect them.

1. **Create the bucket with Object Lock enabled.** It can only be turned on at creation, and it enables
   versioning automatically. Use a separate AWS account or tightly restricted access if you can.
   ```bash
   aws s3api create-bucket --bucket <bucket> --region ap-south-1 \
     --create-bucket-configuration LocationConstraint=ap-south-1 \
     --object-lock-enabled-for-bucket
   ```
2. **Create an IAM user with only this policy**, and an access key for it. It can write and read backups
   but not delete them or change their retention:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": ["s3:PutObject", "s3:PutObjectRetention", "s3:GetObject"], "Resource": "arn:aws:s3:::<bucket>/audit-anchors/*" },
       { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::<bucket>", "Condition": { "StringLike": { "s3:prefix": "audit-anchors/*" } } }
     ]
   }
   ```
3. **Set the env vars in Vercel** (Production, and Preview if you want it there too):

   | Variable | Value |
   | --- | --- |
   | `AUDIT_ANCHOR_S3_BUCKET` | bucket name |
   | `AUDIT_ANCHOR_S3_REGION` | e.g. `ap-south-1` |
   | `AUDIT_ANCHOR_AWS_ACCESS_KEY_ID` / `AUDIT_ANCHOR_AWS_SECRET_ACCESS_KEY` | the IAM user's key |
   | `AUDIT_ANCHOR_RETENTION_DAYS` | optional, default `2920` (8 years); confirm with compliance |
   | `AUDIT_ANCHOR_LOCK_MODE` | optional, default `COMPLIANCE` (nobody, including the AWS root user, can delete before expiry); `GOVERNANCE` allows privileged deletion |
   | `AUDIT_ANCHOR_S3_PREFIX` | optional, default `audit-anchors/<VERCEL_ENV>/`, so Preview and Production never mix |

4. **Redeploy.** The next cron tick writes `audit-anchors/production/<yyyy-MM-dd>.json`. Settings → System
   shows the last run of the "S3 backup" job.

## Webhook security

Every inbound webhook is authenticated **before** its body is parsed, and fails closed: a provider set to
live with no secret configured has all its webhooks rejected (401).

| Endpoint | Authentication |
| --- | --- |
| `/api/webhooks/freshdesk` | `X-Webhook-Secret` header (set on the Automation Rule) |
| `/api/webhooks/exotel`, `/api/internal/exotel/voice-analyze-callback` | `?secret=` on the callback URL (Exotel can't sign) |
| `/api/webhooks/clevertap` | `X-Webhook-Secret` custom header |
| `/api/webhooks/clickup` | `X-Signature` HMAC-SHA256 with the webhook's secret |
| `/api/webhooks/jira` | `X-Hub-Signature` HMAC-SHA256 with the webhook's secret |
| `/api/webhooks/messaging/whatsapp` | `X-Hub-Signature-256` HMAC-SHA256 with the Meta **App Secret** |
| `/api/webhooks/messaging/sms` | `?secret=` on the Exotel SMS callback URL |
| `/api/internal/whatsapp/*` | HMAC + timestamp (`WHATSAPP_WORKER_SECRET`) |
| `/api/internal/cron/tick` | `x-cron-secret` (`CRON_SECRET`) |

Secrets are entered in Settings → Apps & Integrations. In Production, a provider that isn't switched to
live has no webhook at all (404); the mock adapters only answer in Preview and local development.

- **Retries are de-duplicated:** each accepted delivery is recorded (`WebhookDelivery`), keyed by a hash of the
  body, so a provider retry is acknowledged without creating duplicate activities or clients. If processing
  fails, the record is released so the retry is processed.
- **Rate limits (app-level backstop):** 300/min per IP per webhook, 60/min per IP on the device sync endpoint,
  and sign-in is refused from an IP with 50 failed attempts in 15 minutes (on top of per-account lockout).
  For volumetric protection, also add Vercel Firewall rate-limit rules on `/api/webhooks/*` and `/api/auth/*`.

## Scheduler

All time-based work (SLA alerts, overdue tasks, Journey steps, KYC drop-off chasing, daily/weekly reports, WhatsApp
health) runs in `POST /api/internal/cron/tick`, which must be called **every 5 minutes**. `/api/health` returns 503
with `scheduler: stale` if it hasn't run for 15 minutes.

The Vercel Hobby plan only allows daily crons, and GitHub Actions schedules are best-effort (in practice every 3–7
hours), so the primary trigger is **cron-job.org** (free); the GitHub workflow stays as a backup. Setup:

1. Create an account at cron-job.org → **Create cronjob**.
2. URL: `https://<production domain>/api/internal/cron/tick` — schedule **every 5 minutes**.
3. Advanced → Request method **POST**; add header `x-cron-secret` = the value of `CRON_SECRET` in Vercel.
4. Save, then use **Test run**: it should answer `202 {"ok":true,"accepted":true}` within a second.
5. Turn on failure notifications for the job (Settings → notify after a few consecutive failures).

The tick replies immediately and does its work in the background (up to 5 minutes), so external schedulers never
time out. A lease lock means overlapping calls (both schedulers, retries) skip with `{"skipped": ...}` instead of
running twice. For debugging, `POST …/tick?wait=1` runs synchronously and returns every job's result.

Point an uptime monitor (Better Stack, UptimeRobot) at `/api/health` to be alerted when the database or the
scheduler stops.

## Freshdesk

Every Freshdesk ticket is linked to the client it belongs to (Support tab + one timeline entry per ticket, kept
current as its status changes). Setup:

1. **Settings → Apps & Integrations → Freshdesk:** domain, API key (ideally a dedicated integration agent) and a
   webhook shared secret; switch to **Live** and **Test connection**.
2. **Freshdesk → Admin → Workflows → Automations:** create **two** rules with the same webhook action — one on the
   **Ticket Creation** tab and one on the **Ticket Updates** tab (condition: status is changed) — differing only in
   `event`:
   - POST `https://<production domain>/api/webhooks/freshdesk`, custom header `X-Webhook-Secret: <secret>`, JSON:

```json
{
  "event": "created",
  "ticket_id": "{{ticket.id}}",
  "status": "{{ticket.status}}",
  "priority": "{{ticket.priority}}",
  "channel": "{{ticket.source}}",
  "requester_name": "{{ticket.requester.name}}",
  "requester_email": "{{ticket.requester.email}}",
  "requester_phone": "{{ticket.requester.phone}}",
  "requester_mobile": "{{ticket.requester.mobile}}",
  "subject": "{{ticket.subject}}"
}
```

   (`"event": "updated"` in the Ticket Updates rule.) The ticket description is not sent or stored — it stays in Freshdesk.
3. **History:** the scheduler pulls every ticket ever raised by each client's Freshdesk contacts (found by any format
   of their phone, or their email) — new clients, and again whenever a client's phone/email changes. About 10 clients
   per 5-minute tick; the first full backfill runs in the background. **Sync from Freshdesk** on a client's Support
   tab does it immediately.

### How contacts are matched to clients (every lead source)

All sources — Freshdesk, Exotel, WhatsApp, ad/website leads, CSV import, manual entry — use one rule
(`src/lib/clients/identity.ts`), matching on normalized keys stored with each client and joint holder:

- **Phone** in any format (`+91 98765-43210`, `09876543210`, `919876543210` all match) — checked first; **email**
  case-insensitively — second. Archived and merged clients never match.
- A match gains the detail it was missing (never overwritten), so a phone-only lead and a later email from the same
  person stay one client.
- Phone → client A but email → client B: attached to A and a "Possible duplicate" review task goes to A's manager.
- A client marked Not proceeding who returns is attached (not duplicated) and their RM is alerted.
- No match: a new lead (ticket and call channels only; Clevertap/Jira/ClickUp events only annotate known clients).
