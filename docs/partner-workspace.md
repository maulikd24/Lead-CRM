# Partner workspace

The Partner workspace shows the partner programme inside the CRM: partners and their network, the people they refer, commissions, payouts and statements. It has three data sources, chosen with `PARTNER_SOURCE`:

| `PARTNER_SOURCE` | What it reads | Who may open it |
|---|---|---|
| unset or `native` (default) | This CRM's own Earnings Engine tables. No external key, no network. | Admin and Finance (everything), a partner user (their own sub-tree), a team manager (the partners the existing hierarchy rules give them) |
| `external` | The referral API, through the adapter described in part 2 of this page | Admin and Finance |
| `sample` | Made-up data, for development (never in production unless `PARTNER_ALLOW_SAMPLE=1`) | Admin and Finance |

The whole workspace stays behind `PARTNER_WORKSPACE_ENABLED=1` (off by default: no menu entry, every `/partners` URL is a 404). Everything is read-only.

## Part 1. The native source

### Pages

| Tab | URL | Shows |
|---|---|---|
| Overview | `/partners` | Earnings to date, accruals this month, pending payouts, referred people (counting up once), earnings by month (draws in), tier mix, empanelment mix, top partners |
| Affiliates | `/partners/affiliates` | Partners with tier, empanelment status, bank-verified state with the last four digits only, referred count, earnings; filters, search, paging. A partner's page (`/affiliates/<id>`) adds the commission plan, sub-partners, totals (earned, accrued but not in a run, pending payout, reconciled outside), recent payouts and the first referred people |
| Network | `/partners/network` | The commercial roll-up (`PartnerProfile.parentPartnerProfileId`) as an indented tree: each partner's own earnings and the total for their branch |
| Referred | `/partners/referred-users` | Clients and leads attributed to partners; Clients, Leads and stage filters; search by customer or partner code |
| Commissions | `/partners/commissions` | Every accrual with an expandable "How was this worked out?" (the rule, the slab, the sums, and whether the stored amount still agrees with the rule); an Adjustments view |
| Payouts | `/partners/payouts` | Payout runs, and per-partner payouts with status, empanelment, bank state and what would hold a payout |
| Statements | `/partners/statements` | One statement per partner per payout run (and an estimate for accruals not yet in a run): view on screen, export CSV, print version |

A partner user and a team manager reach it from a button on Partner Home and the Management Console; the sidebar entry is for Admin and Finance.

### How people are attributed to a partner

Two sources, in order of authority:

1. **Client**: a trading account whose `sourcingPartnerId` is the partner. This is the link the commission engine pays on.
2. **Lead**: a customer record with no sourced account yet whose `leadAttribution.partnerCode`, or free-text `referralSource`, equals the partner's code (compared without regard to case).

A person with a sourced account is shown once, under that account's partner. Deleted and merged-away records never appear. Lead attribution matching needs no new column: the lead intake already stores campaign details as `leadAttribution` (a JSON object); a lead source that sets `partnerCode` in it attributes the lead.

### Who sees what

- **Admin, Finance**: the whole programme.
- **Partner, Affiliate, Distributor**: their own profile and everyone below them in the roll-up, however deep. A partner whose profile is missing sees an empty workspace, never everything.
- **Team manager**: exactly the partners `getVisibleScope` gives them (assigned through the existing hierarchy). None assigned means an empty workspace.
- **Manager, RM, Dealer**: no access.
- Partners and team managers do not see a payout run while it is a draft (finance is still rebuilding it).
- A page, statement or export that is outside the caller's scope answers "not found", the same as one that does not exist, so it cannot be used to probe for partners. Every query is narrowed by the scope in the data layer, not only in the page.

### What is never shown

PAN, GSTIN and full bank details are never selected from the database. A partner row carries the name, partner code and, for the bank, a verified flag and the last four digits. A referred person is a shortened name ("Priya S.") and a customer code: no phone, e-mail, PAN or address. A partner's mobile number is not stored by the CRM and is not shown.

### Statements: the maths and its assumptions

- Amounts are summed **exactly** (integer arithmetic, no floating point) and rounded to paise **once**, on the total, half away from zero. Each line is shown rounded; the difference between the shown lines and the rounded total appears as an explicit **Rounding** line.
- Net payable = total accruals + adjustments (adjustments are signed; a clawback is negative). A negative net is shown as such, not hidden. Nothing is carried forward.
- The working is checked against the stored payout row. If the stored payout disagrees by even a paisa the statement says so.
- **Tax is not modelled by the earnings engine, so none is computed.** No TDS, no GST, no invoice numbering. The statement, the CSV and the print version all say that any deduction is applied outside this system. Do not read the net as a cash figure.
- Accrual statuses ACCRUED, ADJUSTED and INCLUDED_IN_PAYOUT count as earnings; REVERSED does not. (Today the engine writes only ACCRUED and INCLUDED_IN_PAYOUT; a reversal is a negative accrual.)
- Months are calendar months in India (IST, UTC+5:30). A payout run's end is exclusive, so "1 Sep to 30 Sep" means up to the end of 30 Sep.
- The roll-up total on the Network tab is for reading only. The engine pays commission to the partner whose client generated the revenue; it has no override rule for a parent partner.
- A rule typed "percent of net" is applied to the gross figure by the engine (it has no net amount to use); the explanation says so.

### Export and audit

CSV and print are plain links (never prefetched). Each opens one statement, is authorised exactly like the page, and **writes an audit entry before any data leaves** (action `partner_statement_exported`, entity `PartnerProfile`, with the format, the period, line and adjustment counts and the caller's role; no names, amounts, customer codes or bank digits). If the audit write fails, nothing is exported. CSV cells that a spreadsheet could read as a formula are neutralised. The print version is a standalone page (no app chrome) that prints on A4 or saves as a PDF from the browser.

### Connection and operations

- The native source needs no environment value besides the flag. It reads with the same database connection as the rest of the app.
- The Overview and every list are paged (25 rows) or bounded; a statement refuses to load more than 20,000 lines rather than show a partial total.
- No migration is needed: the native source reads existing tables only.
- The "contract not verified" banner, the Contract check tab and the Settings action belong to the external source only. With the native source they do not appear and `/partners/contract` is a 404.
- Attribution of leads reads the customer table's JSON and free-text fields with an exact, case-insensitive match; at very large volumes an expression index on `leadAttribution->>'partnerCode'` would help. Not added yet (no migration).

# Part 2. The external source (`PARTNER_SOURCE=external`)

Audience: administrators and the developer of the referral API. Everything below applies only when `PARTNER_SOURCE=external`. The workspace is a read-only view of a referral programme (affiliates, the people they refer, payouts), shown inside the CRM. The referral API stays the system of record; the CRM stores nothing about affiliates.

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
