# Partner workspace

Audience: administrators and the developer of the referral API. The workspace is a read-only view of a referral programme (affiliates, the people they refer, payouts), shown inside Supportify. The referral API stays the system of record; Supportify stores nothing about affiliates.

## 1. Switching it on

| Item | Value |
|---|---|
| Feature flag | `PARTNER_WORKSPACE_ENABLED=1` (server env). Anything else, or unset, means off: no menu entry, no command-palette entry, and every `/partners` URL returns 404. |
| Roles | `ADMIN`, `FINANCE`, `TEAM_MANAGER`. Other roles are sent to their own home page. |
| Connection | Settings, Apps & Integrations, "Referral API (Partner workspace)". Fields: base URL (https) and a view-only service token. Credentials are encrypted at rest like every other integration. |
| Mode | **Mock** (default): sample data generated locally, no network. **Live**: calls the configured API. Live with missing or invalid details shows "Not connected: ask an administrator to connect the referral API in Settings." |

Phase A has no writes of any kind: the client contains only GET calls and the pages have no buttons that change anything.

## 2. Pages

| Page | URL | Shows |
|---|---|---|
| Overview | `/partners` | Affiliates (total, pending approval, approved), referred users, active users, earnings last month, monthly performance chart, top affiliates |
| Affiliates | `/partners/affiliates` | Search by name or code, KYC filter chips, pagination, KYC and status badges, referral code with copy button |
| Affiliate detail | `/partners/affiliates/<id>` | Profile, KYC, code, earnings and payout summary, activity, first referred users |
| Referred users | `/partners/referred-users` | Stage filter chips, search by affiliate name, pagination |
| Payouts | `/partners/payouts` | Totals by status, status filter, read-only list |

## 3. What is never shown

- PAN and bank details are not declared in the response schemas, so they cannot reach a page even if the API sends them.
- Mobile numbers show only the last four digits.
- Error screens never include server text, URLs, tokens or response bodies.

## 4. What the workspace needs from the referral API

All calls are `GET`, JSON, `Authorization: Bearer <token>`. Base path `/api/v1/admin`. A path prefix in the configured base URL is respected.

### Envelope

```json
{ "code": 2000, "msg": "ok", "data": { }, "error": null }
```

HTTP status is authoritative. In addition: envelope code 4001 or 4010 means unauthorised, 4003 forbidden, 4004 not found, 5000 and above server error (even on HTTP 200). A missing token answered with HTTP 400 plus code 4001 is treated as unauthorised.

### Lists

`limit` (1 to 100, default 25), `offset` (default 0), `q` (free-text search). Responses: `{ "items": [...], "total": <int>, "limit": <int>, "offset": <int> }`. `total` is required for page counts; if it is absent the workspace falls back to the size of the page.

Unknown fields are ignored. Unknown status values are shown as plain text, so adding a status is not a breaking change. Money is a number or a decimal string. Ids are strings or numbers.

### Endpoints

| Path | Query | Data |
|---|---|---|
| `/reports/summary` | none | `referrers { total, active, pending, suspended, terminated }`, `referees { total, active }`, `earnings { lastMonth, lastMonthLabel, total }`, `monthly [ { period "YYYY-MM", earnings, referees } ]` (last 6 to 12 months), `topReferrers [ { id, fullName, referralCode, refereeCount, earningsTotal } ]` (up to 10) |
| `/referrers` | `limit, offset, q, status, kycStatus` | page of referrers |
| `/referrers/{id}` | none | a referrer plus `suspensionReason, withdrawalHold, agreementGraceUntil, wallet { available, onHold }, payouts { requested, paid, paidTotal, lastPaidAt }, activity [ { at, action, label } ]` |
| `/referees` | `limit, offset, q, referrerId, funnelStatus` | page of referred users |
| `/withdrawals` | `limit, offset, status, referrerId` | page of payout requests plus optional `summary { byStatus { <STATUS>: { count, amount } } }` |

Referrer fields read: `id, fullName, referrerType, status, kycStatus, referralCode, mobile, clientCode, refereeCount, earningsTotal, enrolledAt, activatedAt`.
Referred user fields read: `id, displayName (already masked), referrerId, referrerName, attributionStatus, funnelStatus, signupChannel, kycStatus, clientCode, signedUpAt, accountOpenedAt, lastBrokerageDate`.
Payout fields read: `id, withdrawalRef, referrerId, referrerName, requestType, status, amount, tdsAmount, netAmount, requestedAt, decidedAt, paidAt`.

Status vocabulary the screens colour: referrer status `ACTIVE, ELIGIBILITY_PENDING, AGREEMENT_PENDING, SUSPENDED, TERMINATED`; funnel `SIGNED_UP, KYC_IN_PROGRESS, ACCOUNT_OPENED, ACTIVE, DORMANT, REJECTED`; payout `REQUESTED, APPROVED, PAID, REJECTED, CANCELLED, FAILED`.

KYC filter groups accepted by `kycStatus`: `verified`, `pending`, `needs_info`, `rejected`. The KYC labels shown are mapped from the raw value (for example Accepted or Approved to Verified; Pending, Pending Verification and Initiated to Pending; ReKYC and Need info to needs attention; Rejected and Blocked to Rejected). Unknown values are shown as received.

Please keep PAN and bank details out of these responses altogether. Return the mobile number masked if you can.

## 5. Access to request from the referral API owner

1. Base URL for a sandbox and, later, production, over https.
2. A least-privilege service credential for the read endpoints above only (view permissions, no create, edit or approve), one per environment, expiring and revocable.
3. Egress IP allow-listing for the Supportify servers (no CORS needed: calls are server to server).
4. A documented rate limit per credential and `429` with `Retry-After`.
5. A sandbox with synthetic data covering every status and enough rows to test pagination.
6. Signed webhooks for referrer status, KYC status and payout status changes (or an `updatedSince` filter) once write flows are planned.
7. A machine-readable contract (OpenAPI) per environment and an additive-only change policy within a version.

## 6. Behaviour of the client

- Timeout 8 seconds per call; no automatic retry (the page shows a calm error and the user can refresh).
- 401, 403, 404, 429 and 5xx, network failure, timeout and a malformed response each map to a distinct, plain-language message.
- Base URL must be https (plain http only for localhost during development) and must not contain credentials. Redirects are refused.
- Tokens and response bodies are never logged.

## 7. Later phases (not built)

Writes (status changes, payout approval, rate changes) will be added only with maker-checker approval, an audit trail in Supportify and idempotency keys, after the read-only phase has run alongside the existing admin tool and the totals match.
