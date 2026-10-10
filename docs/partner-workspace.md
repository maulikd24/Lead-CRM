# Partner workspace

> **Status: target contract, unverified.** The endpoints and field names below are proposed. They have not been checked against any running service. Validate them with `scripts/partner-contract-check.ts` before relying on any number on these pages. Until an administrator records a successful check ("Mark contract verified" in Settings), every live page shows the banner "Live connection, contract not yet verified".

Audience: administrators and the developer of the referral API. The workspace is a read-only view of a referral programme (affiliates, the people they refer, payouts), shown inside the CRM. The referral API stays the system of record; the CRM stores nothing about affiliates.

## 1. Switching it on

| Item | Value |
|---|---|
| Feature flag | `PARTNER_WORKSPACE_ENABLED=1` (server env). Anything else, or unset, means off: no menu entry, no command-palette entry, and every `/partners` URL returns 404. |
| Roles | `ADMIN` and `FINANCE`. Other roles are sent to their own home page. |
| Connection | Settings, Apps & Integrations, "Referral API (Partner workspace)". Fields: base URL (https), a view-only service token and an optional path prefix. Credentials are encrypted at rest like every other integration. |
| Mode | **Mock**: sample data generated locally, no network, the page title says "Sample data" and a strong banner says nothing is real. **Live**: calls the configured API. Live with missing or invalid details shows "Not connected: ask an administrator to connect the referral API in Settings." |
| Production | In a production runtime, a missing connection or mock mode shows "Not connected", never sample data, unless `PARTNER_ALLOW_SAMPLE=1` is set (for demos). |

Phase A has no writes of any kind: the client contains only GET calls and the pages have no buttons that change anything.

## 2. Visibility

These roles see the whole programme, not only their own team. Team scoping is not possible until a link between CRM users and affiliates exists (a `PartnerLink` concept, not built). Each page says so in its header. Team managers do not have access in this phase.

## 3. Pages

The workspace is a tabbed workspace (see `docs/workspace-pattern.md`): a fixed header, the section tabs, one section at a time and a sticky rail. The rail holds the six programme totals and the data status (sample data, contract verified or not, not connected); on an affiliate's page it holds that affiliate's totals, KYC and status.

| Page | URL | Shows |
|---|---|---|
| Overview | `/partners` | Affiliates, pending (eligibility and agreement together), approved, referred users, active users, earnings last month, monthly chart, top affiliates |
| Affiliates | `/partners/affiliates` | Search by name or code, KYC filter chips, pagination, badges, referral code with copy button |
| Affiliate detail | `/partners/affiliates/<id>` | Profile, KYC, code, earnings and payout summary, activity, first referred users |
| Referred users | `/partners/referred-users` | Stage filter chips, search by affiliate name, pagination |
| Payouts | `/partners/payouts` | Programme totals by status (only if the service supplies them), status filter, read-only list |
| Contract check | `/partners/contract` | Read-only: connection state, contract version, whether a passing check is on record, what to do next, the check command and what it covers. Recording the mark stays in Settings |

The meaning of each tile (what counts as pending, approved or active) is the CRM's assumption and must be confirmed with the referral API's developer.

The search term is part of the page URL, so it appears in browser history and server access logs. This is accepted for Phase A; do not paste personal identifiers into the search box.

## 4. What is never shown, and what is never invented

- PAN and bank details are not declared in the response schemas, so they cannot reach a page even if the service sends them. The contract check fails if such keys are present at all.
- Mobile numbers show the last four digits (the last two if the number is shorter than ten digits).
- A missing required field is never shown as zero: the page shows "The partner service returned data in an unexpected shape" instead. Optional values that are absent show a dash.
- If a list has no total, pages say "total unknown" and keep "Next" while full pages come back. Payout totals are shown only when the service sends programme-wide figures.
- Error screens never include server text, URLs, tokens or response bodies. Unrecognised status values show as "Unknown".

## 5. What the workspace needs from the referral API

All calls are `GET`, JSON, `Authorization: Bearer <token>`. Paths are relative to the configured base URL (plus the optional path prefix). Responses are `{ "data": ... }`; an optional numeric `code` in the response is treated as success when it is in a 2xx range, and any other code as a failure.

Lists take `limit` (1 to 100, default 25), `offset` (default 0) and `q`, and answer `{ items, total, limit, offset }`. `total` is strongly recommended.

| Path | Query | Required data (anchors in bold) |
|---|---|---|
| `/reports/summary` | none | **`referrers.total`, `referees.total`, `earnings.lastMonth`, `monthly[]`, `topReferrers[]`**; optional `referrers.{active,pending,suspended,terminated}`, `referees.active`, `earnings.{lastMonthLabel,total}`, `monthly[].referees` |
| `/referrers` | `limit, offset, q, status, kycStatus` | items with **`id, fullName, status, earningsTotal, refereeCount`**; optional `referrerType, kycStatus, referralCode, mobile, clientCode, enrolledAt, activatedAt` |
| `/referrers/{id}` | none | the same fields plus optional `suspensionReason, withdrawalHold, agreementGraceUntil, wallet{available,onHold}, payouts{requested,paid,paidTotal,lastPaidAt}, activity[{at,action,label}]`. Ids must match `[A-Za-z0-9_-]{1,64}` |
| `/referees` | `limit, offset, q, referrerId, funnelStatus` | items with **`id, funnelStatus`**; optional `displayName (already masked), referrerId, referrerName, attributionStatus, signupChannel, kycStatus, clientCode, signedUpAt, accountOpenedAt, lastBrokerageDate` |
| `/withdrawals` | `limit, offset, status, referrerId` | items with **`id, status, amount`**; optional `withdrawalRef, referrerId, referrerName, requestType, tdsAmount, netAmount, requestedAt, decidedAt, paidAt`; optional `summary.byStatus.<status>{count,amount}` |

Money is a number or a decimal string. Ids are strings or numbers. Unknown extra fields are ignored. The `kycStatus` filter accepts the group keys `verified`, `pending`, `needs_info` and `rejected`; the `funnelStatus` and payout `status` filters take the service's own values.

Please keep PAN and bank details out of these responses altogether, and return the mobile number masked if you can.

## 6. Checking the contract

```
PARTNER_API_BASE=https://host/base PARTNER_API_TOKEN=<view-only token> \
  npx tsx scripts/partner-contract-check.ts
# optional: PARTNER_API_PREFIX=/some/prefix
```

The token comes from the environment, never an argument. The script sends only GET requests, runs each real response through the workspace's schemas, and prints a table plus a JSON result. It reports separately: missing required fields (fail), unknown extra keys (info), unrecognised status values (warn, counts only), PAN-like or bank-like keys (fail), cross-endpoint number checks (summary totals against list totals, payout summary against per-status totals, earnings total against the sum of referrers, latest month against last month), pagination behaviour (echo, last page, offset beyond the end) and that a request without a token is refused. It never prints values from the responses. When it passes, an administrator records it with "Mark contract verified" in Settings; that stores the date and the contract version. Saving new connection details, or a code change that bumps the contract version, clears the mark and the banner returns.

## 7. Access to request from the referral API owner

1. Base URL for a sandbox and, later, production, over https.
2. A least-privilege service credential for the read endpoints above only (view permissions, no create, edit or approve), one per environment, expiring and revocable.
3. Egress IP allow-listing for the CRM servers (no CORS needed: calls are server to server).
4. A documented rate limit per credential and `429` with `Retry-After`.
5. A sandbox with synthetic data covering every status and enough rows to test pagination.
6. Signed webhooks for status changes (or an `updatedSince` filter) once write flows are planned.
7. A machine-readable contract (OpenAPI) per environment and an additive-only change policy within a version.

## 8. Behaviour of the client

- 8 second limit per call, covering the response body as well as the headers; bodies over 2 MB are refused. No automatic retry.
- 401, 403, 404, 429 and 5xx, network failure, timeout and a malformed response each map to a distinct, plain-language message.
- The base URL is entered by an administrator and must be https (plain http for localhost only outside production) with no embedded credentials. Redirects are refused. No SSRF guard (private address ranges) is built, so only trusted administrators may edit it.
- Tokens and response bodies are never logged.

## 9. Later phases (not built)

Writes (status changes, payout approval, rate changes) will be added only with maker-checker approval, an audit trail in the CRM and idempotency keys, after the read-only phase has run alongside the existing admin tool and the totals match.
