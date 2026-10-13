# Feature flags and environment variables

Everything below defaults to **off** or unset. A flag is on only for the exact value `1`. Variables named `NEXT_PUBLIC_*` are inlined at **build** time (changing one needs a rebuild); all others are read at run time.

## Screens and features

| Name | Default | What it enables |
| --- | --- | --- |
| `NEXT_PUBLIC_NAV_V2` | off | Sidebar shows the role's primary items only; the rest through Cmd+K and Settings |
| `NEXT_PUBLIC_HOME_V2` | off | "Today" home for Admin, Manager and RM |
| `NEXT_PUBLIC_MOTION` | off | Animated dashboard components and the live-counts route (static versions when off) |
| `NEXT_PUBLIC_CLEVERTAP_CARD` | off | "App and campaigns" card on the customer page (read-only) |
| `NEXT_PUBLIC_C360` | off | Customer 360 page `/clients/[id]/360` |
| `NEXT_PUBLIC_OUTCOMES` | off | Goals and outcomes tab on Customer 360, "Needs attention" on Today and the dashboard |
| `OUTCOMES_DRAFTS_ENABLED` | off | Draft check-in messages from the outcomes screens (also needs the `outcomes_review` AgentSetting row on) |
| `OUTCOMES_DISCLAIMER` | built-in text | Wording shown with every projection (must say "illustrative"; falls back to the default otherwise) |
| `NEXT_PUBLIC_CALLS_REVIEW` | off | Call recordings review `/calls` and the recording proxy |
| `NEXT_PUBLIC_CONSENT` | off | Consent ledger screens: customer panel, `/settings/consent`, admin export |
| `NEXT_PUBLIC_MERGE_REVIEW` | off | Duplicate review `/clients/duplicates` and its actions |
| `NEXT_PUBLIC_SUPPORT_SLA` | off | Support SLA view `/support` |
| `NEXT_PUBLIC_INSIGHTS` | off | `/agents/insights` |
| `NEXT_PUBLIC_MARKETING` | off | `/marketing` workspace |
| `PARTNER_WORKSPACE_ENABLED` | off | Partner workspace `/partners`, Partner finance settings, and the partner first touch recorded by the lead intake (404 and no writes when off) |
| `PARTNER_SOURCE` | unset = `native` | `native` reads this CRM; `sample` serves made-up data for development; any other value reads `native` |
| `PARTNER_ALLOW_SAMPLE` | off | Allow the sample source in production |
| `DAILY_BRIEF_ENABLED` | off | RM daily brief email at 09:00 to 09:04 IST, Monday to Saturday, once per RM per day (`src/lib/daily-brief`, run from the cron tick). Only the scheduled tick sends. `POST /api/internal/cron/daily-brief?dry=1` is a dry run; a call without `dry=1` returns 409. Per-RM opt-out: `User.dailyBriefOptOut` |
| `SENDGRID_API_KEY` / `BRIEF_FROM` | unset | SendGrid key and sender for the daily brief (for example `Allvest CRM <crm@allvest.co>`). The sender address must be on the domain authenticated in SendGrid (see below). Required to send, not for dry runs |
| `REFERRAL_PROGRAM_ENABLED` | off | Customer referral programme `/referrals`, the signup hook and the progress job |
| `REFERRAL_LINK_BASE` | unset | https address used for share links (no base, no link) |
| `DEVICE_HASH_KEY` | unset (falls back to `APP_SIGNUP_SECRET`) | Key for hashing the app's device identifier; without a key nothing is hashed |
| `BACKOFFICE_IMPORT_ENABLED` | off | Back-office importer: settings page, uploads, nightly job |
| `BACKOFFICE_IMPORT_DIR` / `BACKOFFICE_IMPORT_HOUR_UTC` | unset / 21 | Drop folder and hour of the nightly import |
| `PORTFOLIO_FEED_ENABLED` / `PORTFOLIO_FEED_SECRET` | off / unset | Portfolio ingest endpoint (404 while off or without a secret) |
| `SOCIAL_DRAFTS_ENABLED` / `SOCIAL_TIMEZONE` | off / `Asia/Kolkata` | Draft-only social posts and the zone times are shown in |
| `META_ADS_SYNC_ENABLED` / `META_ADS_SYNC_EVERY_HOURS` | off / 6 | Read-only ad-spend sync from Meta |
| `GOOGLE_ADS_REPORTING_ENABLED` / `GOOGLE_ADS_SYNC_EVERY_HOURS` | off / 6 | Read-only Google Ads reporting sync |

## Agents, AI and messaging

| Name | Default | What it enables |
| --- | --- | --- |
| `AGENT_NUDGER_ENABLED` | off | Draft-only WhatsApp nudger job (also needs the `wa_nudger` AgentSetting row on) |
| `WA_ASSIST_ENABLED` / `WA_ASSIST_AUTO` | off | Suggested replies and handover detection / auto-draft on open (also needs `wa_reply` on) |
| `WA_META_WINDOW` | off | Enforce the 24-hour customer-service window |
| `AI_PROVIDER` / `AGENT_MODEL` | `anthropic` / `claude-sonnet-5-5` | Which provider and model the agents use |
| `EVALS_REAL_PROVIDER` | off | `npm run evals` only: also run the real judge (never CI) |
| `MERGE_SUGGESTIONS_ENABLED` | off | Job that scores and stores duplicate suggestions |
| AgentSetting rows `wa_nudger`, `wa_reply`, `social_drafter`, `outcomes_review` | per Settings | Per-agent kill switches on top of the flags |

## Consent, identity and integrations

| Name | Default | What it enables |
| --- | --- | --- |
| `CONSENT_ENFORCEMENT` | off | Consent gate in the nudger, CleverTap push, ingest, reply assist, outcomes and referral drafts |
| `CONSENT_RECORD_ONLY_PURPOSES` | unset | Purposes recorded but not enforced while rolling out |
| `APP_SIGNUP_SECRET` | unset | HMAC secret for `/api/webhooks/app-signup` (404 while unset) |
| `APP_USER_ID_LINKING` | off | Match CleverTap events by app user id; merges re-point the signup ledger |
| `CLEVERTAP_PUSH_ENABLED` | off | CleverTap writes (India region only) |
| `FRESHDESK_HANDOFF_ENABLED` | off | Support hand-off ticket ingest |
| `SSO_ENABLED` / `SSO_ONLY` / `SSO_BREAK_GLASS_EMAILS` | off / off / unset | Keycloak sign-in, hiding the password form, and who may still use a password |
| `KEYCLOAK_ISSUER` / `KEYCLOAK_CLIENT_ID` / `KEYCLOAK_CLIENT_SECRET` | unset | Keycloak connection |
| `CALLS_RECORDING_HOSTS` | unset | Extra hosts the recording proxy may fetch from |

## Tests only

| Name | What it enables |
| --- | --- |
| `ERASURE_DB_TEST`, `REFERRAL_DB_TEST`, `PARTNER_NATIVE_DB_TEST`, `PARTNER_PERF_DB_TEST` | Opt-in real-database tests (refuse non-local databases). Run one file at a time: they share the database |
| `E2E_PORT` | Port of the e2e run |

## Daily brief: SendGrid sender authentication (owner steps)

The brief is sent through SendGrid, so mail from `BRIEF_FROM` must be authenticated for the domain it uses. Do these once, before turning `DAILY_BRIEF_ENABLED` on. The DNS values are not written here: SendGrid generates them for the account, so copy them from its screens.

1. In SendGrid, open **Settings, Sender Authentication**, then choose **Authenticate Your Domain**. Enter `allvest.co` and pick the DNS host that manages `allvest.co`.
2. SendGrid shows the DNS records to add. Add **every** record it lists for the domain. This includes the **DKIM** CNAME records (usually two, each with a name ending in `_domainkey`) and the **SPF** TXT record. Copy names and values exactly as displayed. Do not retype them from memory or from this file.
3. SPF: a domain may have only one SPF TXT record. If `allvest.co` already has one (for example for Google Workspace), merge SendGrid's entry into that record instead of adding a second one. Two SPF records fail authentication.
4. If SendGrid also lists a link-branding or return-path CNAME for the domain, add it as shown.
5. Back in SendGrid, click **Verify** and wait for DNS to propagate. Retry until the domain shows as verified. DNS can take a while; there is nothing to fix on the app side while it waits.
6. Create a SendGrid API key with **Restricted Access** and only the **Mail Send** permission. Put it in `SENDGRID_API_KEY`.
7. Set `BRIEF_FROM` to an address on `allvest.co`, for example `Allvest CRM <crm@allvest.co>`. The app reads it from the environment at run time (no code change).
8. Run a dry run first: `POST /api/internal/cron/daily-brief?dry=1` with the `x-cron-secret` header. It sends nothing. Then set `DAILY_BRIEF_ENABLED=1`. The brief goes out only from the 09:00 IST tick.
9. After the first send, check **Activity** in SendGrid. A message with status "delivered" confirms the setup.

If a run lists RMs under `pending` in its result, do not expect a retry. A pending row means a send may have gone out before a crash. Check those RMs' inboxes and SendGrid Activity before deciding anything.

## How the partner and referral flags combine

The partner first touch is written by the lead intake only when `PARTNER_WORKSPACE_ENABLED=1`; the referral hook runs only when `REFERRAL_PROGRAM_ENABLED=1`. A partner code is always the partner's; a customer referral that also matches is recorded and flagged for review only when the partner credit was written. See `docs/referrals.md`.
