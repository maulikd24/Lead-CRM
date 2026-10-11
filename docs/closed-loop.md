# Closed-loop conversions

Tell the ad platforms (Meta Conversions API, Google Ads offline conversions) which customers completed KYC or funded, as hashed identifiers only, so they can learn which ads work. It ships dark: nothing is queued, sent, shown or reachable unless `CLOSED_LOOP_CONVERSIONS_ENABLED=1`, and no real destination can be switched on without a saved credential, an approved region and a second Admin's approval. **No real send is tested or wired in this repository: the Meta and Google adapters are tested only with an injected fake `fetch`.**

## What leaves, and only when

A conversion event (KYC complete, first funding, optionally an assets band) is sent to a destination only if ALL of these hold at send time, not just when it was queued:

1. **Consent.** The customer has a current `ADS_MEASUREMENT` grant (explicit opt-in; withdrawn, expired and absent all deny). The send gate is always strict: it ignores `CONSENT_RECORD_ONLY_PURPOSES`, because record-only is for watching a rollout and must never let an identifier leave (the flag validator also refuses `ADS_MEASUREMENT` in the record-only list when this module is on). Consent is judged at the event's own time when queuing, and again now when sending.
2. **Identifiers.** At least one hashed email or phone or a click id exists. Raw email, phone, name and PAN never reach the outbox or a destination.
3. **Region.** The destination's data region is on its approved-regions list (empty until the owner confirms where the data may go).
4. **Kill switch.** Neither `CLOSED_LOOP_KILL_SWITCH=1` nor the Admin toggle is on. Marketing or Admin can turn it on; only Admin turns it off.
5. **Age.** The platform accepts events only up to its own age limit; older ones are skipped, not sent.

`ConversionOutbox` is one row per event per destination, unique on `(destination, dedupId)`; the dedup id depends only on customer and event type, so every path can run as often as it likes and nothing is queued or sent twice (the platform also deduplicates on it). A row is claimed with one conditional update, so overlapping runs cannot both send it. Retries back off (5 min to 12 h), then the row goes DEAD; an Admin or Marketing user can retry a failed row.

## Where it plugs into the foundation

| Concern | How |
| --- | --- |
| **Access** | Area `marketing-attribution` in the central registry (`src/lib/access/policy.ts`): view for ADMIN and MARKETING (retry, kill switch on), manage for ADMIN (destinations, regions, values, bands, kill switch off, wording). Pages and actions call `requireMarketing("marketing-attribution", ...)`; no private role list. Nav item `/closed-loop` carries its area and is gated by the `closed-loop` nav flag. Customer 360's consent tab shows a **reasons-only** explainer to every role that sees that tab: no spend, campaign cost or identifier. |
| **Outcomes** | The Consent coverage tab reads funded customers by campaign ONLY through `CampaignOutcomeProvider` (as the registered `closed-loop` consumer, last 90 days; leads, KYC, funded, confidence; no spend, cost or revenue). The module has no `funded` count of its own. |
| **Events** | The outbox is fed from the canonical customer events by the consumer `closed-loop-intake` (`account.kyc.verified`, `account.funded`; `customer.consent.withdrawn` cancels unsent rows) AND by the sweep, which stays as the safety net (an event written after its domain commit can be lost). Both run the same producer, so they cannot disagree (equivalence tests, in memory and on a real database). Send results are emitted as `campaign.conversion.sent` (consent context, destination, kind, match flag) and `campaign.conversion.failed` (code only), keyed on the outbox row. |
| **Approvals** | Two native kinds in the canonical approval service, both four-eyes Admin decisions applied by the generic registry: `closed-loop-destination` (switch a destination on, widen its regions, start sending a value) and `consent-policy-change` (the ad measurement notice wording and version). A change that only does less (switch off, narrower, no value) applies at once. Decided in the Approvals inbox. |
| **Jobs** | `closed-loop-conversions` in the job registry, run by the cron tick through `runJob` (flag `CLOSED_LOOP_CONVERSIONS_ENABLED`; not offered for hand re-run because it sends to a third party). |
| **Control plane** | Failures lists failed or dead conversions per destination (counts only, nothing is lost, link to the Outbox); Integrations shows a row per destination fed by the job. |
| **Erasure** | `ConversionOutbox` is in the relationship registry (erase order 43) and both erasure paths; the DB-dump test proves the hashed email is gone from every table, and the registry-vs-original equivalence test seeds an outbox row. |
| **Withdrawal** | The consent ledger store cancels a customer's unsent rows on any `ADS_MEASUREMENT` withdrawal (screen, WhatsApp, import), on top of the send-time check. |
| **Identity hashing** | One module (`hashing.ts`) holds the platform-specific normalisation and SHA-256 (the platforms match on exactly these); the dedup id is the only other digest. Any stand-in for a person on a screen is `pseudonymize` from the access module; this module has none (a test pins it). |

## The workspace (`/closed-loop`)

Tabs on the workspace primitives: **Overview** (sent, waiting, failed, not sent, agreed; kill switch; approvals waiting), **Outbox** (filter by state; a short code per event, never the customer; retry a failed row), **Destinations** (credentials typed by an Admin and stored encrypted, never shown back; region and approved regions; send first-funding value; assets bands), **Consent coverage** (who has agreed, why events were not sent, funded customers by campaign from the shared provider, the notice wording and a form to propose a change).

## Flags

`CLOSED_LOOP_CONVERSIONS_ENABLED` (default off), `CLOSED_LOOP_KILL_SWITCH`, `CLOSED_LOOP_DEMO` (a no-network fake destination; refused in production), `CLOSED_LOOP_LOOKBACK_DAYS`, `CLOSED_LOOP_MAX_PER_RUN`, `CONSENT_ADS_MEASUREMENT_NOTICE` and `..._VERSION`, `CLOSEDLOOP_DB_TEST`. See `docs/feature-flags.md` (generated).

## Tests

Unit: hashing rules, event detection, gate, drain, producer, adapters (fake fetch), intake consumer, approvals, outcomes view, conformance pins. Real database (`CLOSEDLOOP_DB_TEST=1`, registered in `ci/db-suites.json`): `closedloop.db.test.ts` and `events-approvals.db.test.ts` (dual path equivalence, withdrawal through the ledger, results as events, the two approvals end to end). Screens: layout-budget routes and `scripts/layout-budget/seed-closedloop.ts`, `e2e/axe-closedloop.spec.ts`.

## Before a real send (owner decisions)

Compliance signs off the notice wording; the owner confirms each destination's data region; Meta and Google credentials are entered by an Admin in the app (never in chat or the environment); verify the platforms' current normalisation rules before the first live event; use the platform's test-event code first.
