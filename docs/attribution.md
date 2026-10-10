# Campaign attribution

Where each customer came from, what each campaign costs and brings in, and how fast new leads are reached. One flag, `NEXT_PUBLIC_ATTRIBUTION=1` (build time), off by default. With it off none of the screens, tabs, notifications or jobs below exist, and lead intake behaves exactly as before.

## 1. The model (`src/lib/attribution/model.ts`, pure)

Every touch a customer left becomes one **touch**: a Meta or Google ad, a website form, a partner code, a referral code or an organic sign-up. It is built from data that already exists:

| Evidence | Where it comes from |
| --- | --- |
| The lead's own markers (campaign, campaign id, ad, form, platform, click ids, utm) | `Client.leadAttribution` and `Client.leadSource`, written when the lead arrived |
| Later enquiries | `LeadIntake` ledger rows linked to the customer (the row that created the lead is recognised and not counted twice) |
| Partner code | `PartnerReferralTouch`: the code exists in the partner table |
| Referral code | `Referral` with outcome `ATTRIBUTED`, and its code |

Ad touches are matched to synced campaigns with the marketing module's own rules (`createCampaignResolver` in `src/lib/marketing/attribution.ts`: campaign id, then campaign name, then `utm_campaign`; a name shared by several campaigns is not guessed). The channel test (`isMetaLead`, `isGoogleLead`) is the same one the Marketing report uses, so a lead carrying both click ids is credited to neither. The customer keys that lead intake matches on (phone and email keys) are what link a re-enquiry to the customer; this module adds no matching of its own.

**First touch** is the earliest touch. Touches within a minute of each other (one sign-up carrying an ad click and a code) are ranked by evidence: a verified partner code, then a referral code, then an ad, then a form, then organic. **Last touch** is the latest touch at or before the first funding (the latest of all while the customer has not funded).

**Confidence**, on every touch, with a plain-English reason (`why`):

| Level | When |
| --- | --- |
| High | The platform's campaign id matches a synced campaign, or a partner or referral code that exists in our own tables |
| Medium | The campaign matched by name or `utm_campaign`; a campaign id the spend data does not know yet; a website form; an organic sign-up |
| Low | Only the channel is known (for example a Meta click id, or the lead source label alone). It is counted under "Meta ads, campaign not identified", never under a campaign |

Anything else is **unattributed**, with a reason: a hand-entered lead with a source label and no details, a lead with no markers, or contradictory markers. Nothing is guessed.

## 2. Journey (Customer 360, tab `journey`)

Where the customer came from (first and last touch, creative, form, confidence, the "why attributed" sentence, every touch), then each step from lead to revenue with its date and the time since the lead arrived: lead created, **first contact** (and whether it was within the SLA), each KYC step with its duration, KYC approved, first funding, first transaction and revenue to date. A step not reached yet says so; nothing is invented. Authorisation is the Customer 360 rule (`canOpen360`), checked before any tab is considered.

First contact (`first-contact.ts`) is the first time a person of ours actually reached the customer: a connected call (not missed, rejected or zero seconds), a logged contact or meeting, or an outbound message a person sent. Notes, tasks and automation do not count.

## 3. Campaign impact (Marketing, tab `impact`, Admin and Manager)

Per campaign and creative: spend, leads, cost per lead, contacted-in-SLA rate, KYC rate, funded customers, net revenue (brokerage and advisory fees, reversals subtract: the marketing module's `netRevenue`), ROAS, payback and a cohort by lead month. Counted from each customer's first touch.

- Cost per lead and return use only the leads and revenue of campaigns that have spend, so partner, referral and organic customers never dilute a campaign.
- A figure that cannot be known is a dash: a campaign with no synced spend, spend in another currency, a bucket that has no spend by nature.
- **Spend freshness** is shown, never hidden: how long ago the last successful sync was (stale after 36 hours), and how many of the days in the range have spend rows (partial). Messages say what that means for the numbers.
- Per-creative spend exists only where the platform reports per ad (Google). For Meta the CRM still counts leads, funded customers and revenue per creative.
- Compare with the previous period of the same length (`compare=1`).
- **Role visibility.** The totals include every customer. The "Customers from this campaign" list shows only customers the viewer may open (Admin: all; Manager: their own team and the unassigned pool, the same rule as the client page); the screen says how many are outside the viewer's view.

## 4. Lead push (lead intake, `src/lib/attribution/lead-push.ts`)

When a **new** lead arrives (not a re-enquiry), the assigned RM gets a `lead_push` notification (and phone push where configured) with the campaign, creative and the lead's own answers, and a speed-to-lead clock starts (`LeadPush`, one row per submission, idempotent on `source:externalId`). An unassigned lead goes to the people who assign leads (active Managers and Admins).

- The suggested first message is a **draft**: a fixed template (no model is called), checked by the outbound guardrails, held back by the consent gate (`MARKETING_COMMS`, WhatsApp) and the agent switch, and approved by a person on Agent drafts. It needs `LEAD_PUSH_DRAFTS_ENABLED=1` and the `lead_first_message` row on. Nothing is sent to the customer automatically.
- The cron tick runs the sweep (`lead-push-sweep`): a push whose customer a person has reached becomes `CONTACTED`; one still unreached after the SLA plus the grace period is **escalated** once, as a task for the RM's manager (or, with none, a manager or admin) and a `lead_sla_breach` notification.
- The SLA (5 to 1440 minutes, default 15) and the grace (0 to 1440, default 0) are set by an Admin on the Lead leakage page, SLA settings tab. Every change is audited.
- A failure anywhere in the push never fails or loses the lead.

## 5. Lead leakage (`/settings/lead-leakage`, Admin)

Leads nobody reached past their SLA, by campaign (and by RM), longest wait first, with the share of reached-or-missed leads that leaked. A lead still inside its window is not a leak. Read-only. It is computed from the same data as Campaign impact, so it also covers leads that arrived before the push existed.

## Data and erasure

Customer-level attribution stores nothing. New tables (migration `20270210000000_attribution_lead_push`, additive): `LeadPush` (has a foreign key to `Client`; holds the campaign context and the lead's answers) and `AttributionSetting`. `LeadPush` is deleted in the erasure transaction, and the real-database erasure test (`erasure-pii.db.test.ts`) seeds lead pushes and `lead_push` / `lead_sla_breach` notifications and checks no trace remains in any table.

## Flags

| Name | Effect |
| --- | --- |
| `NEXT_PUBLIC_ATTRIBUTION=1` | Everything above (Marketing must also be on for the Campaign impact tab) |
| `LEAD_PUSH_DRAFTS_ENABLED=1` | The draft first message (plus the `lead_first_message` agent row) |

Tests: pure model, journey, impact, leakage, timer, lead push and sweep (fakes); the ingest hook; page and action gates with the session harness; `src/lib/attribution/attribution.db.test.ts` (real database, `ATTRIBUTION_DB_TEST=1`, one file at a time).
