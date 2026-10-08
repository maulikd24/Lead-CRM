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
