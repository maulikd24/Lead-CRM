# Partner workspace

The Partner workspace shows the partner programme inside the CRM: partners and their network, the people they refer, commissions, payouts and statements. It reads this CRM's own Earnings Engine tables. It is read-only; the only things it writes are audit entries, referral touches (from lead intake), statement queries, and the finance settings described below.

`PARTNER_SOURCE` chooses the data: unset or `native` (default) reads this CRM; `sample` serves made-up data for development only (never in production unless `PARTNER_ALLOW_SAMPLE=1`; admin and finance only). The earlier external referral-API adapter, its Settings card, contract check and mark-verified action were retired: `PARTNER_SOURCE=external` is no longer a source and reads the native one.

Everything stays behind `PARTNER_WORKSPACE_ENABLED=1` (off by default: no menu entry, every `/partners` and `/settings/partner-finance` URL is a 404, and the server actions refuse).

## Who can open what

| Role | Workspace (`/partners`) | Partner finance settings (`/settings/partner-finance`) |
|---|---|---|
| Admin, Finance | Everything | Yes (propose rule changes, approve other people's proposals, edit letterhead, link and query assignee) |
| Partner, Affiliate, Distributor | Their own profile and everyone below them in the roll-up | No |
| Team manager | Exactly the partners the existing hierarchy rules give them | No |
| Manager, RM, Dealer | Bounced | No |

The menu entry "Partner workspace" appears for all six roles that may open it, through the same flag mechanism as every other flagged entry (`src/lib/nav-flags.ts`); "Partner finance" appears for Admin and Finance. A partner whose profile is missing, or a team manager with no assigned partners, sees an empty workspace, never everything.

## Pages

| Tab | URL | Shows |
|---|---|---|
| Overview | `/partners` | Earnings to date, accruals this month, pending payouts, referred people, earnings by month, tier mix, empanelment mix, top partners; "N payout runs awaiting approval" when draft runs exist |
| Affiliates | `/partners/affiliates` | Partners with tier, empanelment, bank state (last four digits only), referred count, earnings; a partner's page adds plan, sub-partners, totals, recent payouts |
| Network | `/partners/network` | The roll-up (`PartnerProfile.parentPartnerProfileId`) as an indented tree: own commission, override earnings (once override rules exist) and the branch total (commission only) |
| Referred | `/partners/referred-users` | Clients and leads attributed to partners (see "Attribution") |
| Commissions | `/partners/commissions` | Every accrual with "How was this worked out?"; an Adjustments view |
| Payouts | `/partners/payouts` | Payout runs, per-partner payouts with the hold rule that applies |
| Statements | `/partners/statements` | By payout run, calendar month, financial year, or open accruals; one statement per partner, with CSV and print |

A partner user and a team manager also reach it from Partner Home and the Management Console. Partner Home's earnings widget now reads through the same data layer, so a draft run is counted and never listed.

## Visibility: who sees which lines

The scope has two layers: `ids` (whose counts and totals are visible) and `detailIds` (whose customer-level lines are visible).

| Viewer | Own partner | Sub-partners | Team manager's partners |
|---|---|---|---|
| Admin, Finance | Everything | Everything | Everything |
| Partner, Affiliate, Distributor | Lines, customer codes, statements, tax | Counts and exact totals only: no customer code, no accrual line, no tax, no statement line | n/a |
| Team manager | n/a | n/a | Counts and exact totals only |

- A sub-partner's statement opens as **totals only**: the exact accruals and adjustments, no line, no tax. CSV and print say so.
- An **override** accrual is a share of a sub-partner's commission, so it never carries that sub-partner's customer or revenue, and a customer-code search can never reach it (it would reveal which customers sit under a sub-partner). Only Admin and Finance see the sub-partner's own figure behind an override.
- A page, statement or export outside the caller's scope answers "not found", the same as one that does not exist. Every query is narrowed in the data layer (`scope.ts`, `queries.ts`, `statement-queries.ts`), not only in the page.
- PAN, GSTIN and full bank details are never selected. A partner row carries the name, partner code and, for the bank, a verified flag and the last four digits. Tax rules use only whether a PAN or GSTIN is on file (a boolean).

### Draft payout runs

Partners and team managers never see a payout run while it is a draft, nor its statement. They see how many draft runs include their partners: "N payout runs awaiting approval. You see a run once it is submitted for approval." (Overview, Payouts, Partner Home). A run in `PENDING_APPROVAL` or later is visible.

## Attribution

A person is attributed to a partner in this order:

1. **Client**: a trading account whose `sourcingPartnerId` is the partner (the link commission is paid on).
2. **Lead**: a customer record with no sourced account yet that carries a live **referral touch**, or whose free-text `referralSource` equals the partner's code.

A person with a sourced account is shown once, under that account's partner. Deleted and merged-away records never appear.

### Referral links and codes

A partner's code (their `partnerCode`) and link are shown on Partner Home. The link is the public form address Finance sets in Settings with `?ref=<code>` added. The code travels:

- into the **web lead form** as `ref`, `partnerCode` or `partner_code` (`/api/leads/web`; your form must pass the `ref` query parameter through), and
- into the **app signup webhook** as `referralCode`.

Rules (`src/lib/partners/referral/`):

- **First touch wins.** The first valid code recorded for a person stays; a later code from another partner is ignored and audited. The same partner again is a silent no-op (retries are idempotent).
- **Lapse window**, set in Settings (default 90 days, 1 to 730). After it passes without an account being sourced, the touch no longer counts and a new touch may replace it.
- **Tampering and unknown codes are ignored safely**: a code must be 3 to 40 letters, digits or hyphens; anything else is ignored and the raw text is never stored. An unknown code, or a partner who is not active, is ignored. Every decision (recorded, kept first, replaced after a lapse, ignored) is written to `PartnerAttributionEvent`, an append-only trail without the raw text.
- Attribution never fails or delays a lead.
- Erasing a person removes their touch and their trail rows.

## Statements

A statement lists accruals and adjustments in its period, then tax, then what is payable.

| Statement | `run=` value | Lines | Basis for tax |
|---|---|---|---|
| Payout run | the run id | the run's payout lines and adjustments | the payout net; earlier non-draft runs of the same financial year are the prior base |
| Open accruals | `open` | accruals not yet in a run | none (an estimate) |
| Calendar month | `m-2026-09` | every accrual dated in the month (IST) and the month's adjustments | earnings; earlier months of the financial year are the prior base |
| Financial year | `fy-2026-27` | April to March (IST) | earnings of the whole year |
| Financial year to date | `fyc-2026-27` | month by month with a running total; no lines | earnings, month by month; the months add up to the tax on the year's total, to the paisa |

Maths: exact integer arithmetic (BigInt in 1e-8 rupee units, the same as the engine's statement maths), no floating point; rounding to paise once, half away from zero; each line is shown rounded and any difference is an explicit Rounding line. Net before tax = accruals + signed adjustments; a negative net is shown, not hidden. The working is checked against the stored payout row and any disagreement is flagged. Accrual statuses ACCRUED, ADJUSTED and INCLUDED_IN_PAYOUT count; REVERSED does not. Months and financial years are India dates; a run's end is exclusive.

### Tax (configured by Finance, none by default)

Rules live in the database and are edited in Settings, Partner finance, Tax rules. **There is no default rate, section or threshold anywhere in the code: until a rule is added and approved nothing is deducted, and the statement, CSV and print version say "No tax rules are configured. Nothing is deducted."**

A rule has: kind (TDS or GST), a label printed as typed, a rate (percent, up to four decimals), for TDS an optional threshold per financial year in rupees, the partner types it covers (none ticked means all), PAN status (any, present, absent) for TDS, GST registration (any, registered, unregistered) and a GST treatment for GST, and effective dates (India dates, end exclusive).

- **TDS** is worked out on the financial year's running total: once it passes the threshold, tax applies to the whole running total, and each statement carries the difference from the one before (a clawback that drops the total back under the threshold gives the tax back). With no threshold, tax is the rate on the running total.
- **GST** treatments: *reverse charge* and *self-invoice* are shown as lines but do not change the payable (the firm pays); *partner invoices* adds the GST to the payable.
- The rule used is the most specific one that matches the partner and the date (read as of the end of the period). Two equally specific matches are a **conflict**: nothing is deducted for that tax until Finance resolves it, and the statement says so. Saving two rules that would collide is refused.
- Each tax line shows the exact rule in words, the rounding rule, and: "Tax rules are configured by Finance. Confirm with your tax adviser."
- **Four-eyes.** A change (add, replace, end) is proposed by one Admin or Finance user and approved by a different one, through the existing approval workflow (`PARTNER_TAX_RULE_CHANGE`). The author and approver are stored on the rule and every proposal, approval and end is audited. History is never edited: a replacement ends the old rule where the new one starts, and a replacement or end date cannot be in the past. A change is re-checked against today's rules just before approval.
- Statements are computed live from the rules in force for their period. Adding a rule effective in the past therefore changes how a past period's statement reads: it is audited, and Finance should treat it as a restatement.

### Overrides (optional, none by default)

An override rule pays a percentage of a sub-partner's commission accrual to the partner `level` steps above them in the roll-up (level 1 is the direct parent, up to 5), with an optional cap per accrual and effective dates. One rule per level at a time; no default rate; the same four-eyes path (`PARTNER_OVERRIDE_RULE_CHANGE`).

Override accruals are ordinary `CommissionAccrual` rows with extra nullable columns (`overrideRuleId`, `sourceAccrualId`, `overrideKey`): `commissionRuleId` stays null, the accrual date is the source accrual's date, the amount is rounded once to paise, and a unique `overrideKey` makes the generator idempotent. The engine's own accrual rules are untouched. A terminated ancestor earns nothing; a suspended one accrues and is held at payout. The generator runs after every accrual recompute (and on request in Settings); with no rule it reads one small table and stops. An open override follows a changed source accrual; one already in a payout is frozen.

The Network tab shows override earnings once they exist. "Own" and the branch total are commission only, so nothing is counted twice.

### Raise a query

A partner can raise a query on a statement line they may see. It becomes an ordinary Task for Finance (`source` `partner-query:<id>`), assigned to the person chosen in Settings, else the first active Finance user, else the first active Admin, with a `PartnerStatementQuery` record and an audit entry. One open query per person and line. A `Task` belongs to a customer record, so the task is filed on the line's customer, or one of the partner's own customers when the line has none (an override line, say); if the partner has none the query cannot be filed and the screen says to contact Finance. The task is created directly, not through the stage engine, so it never becomes a customer's "next action" for their RM.

## Hold rules

Approving a payout run is **blocked** while any partner with a non-zero payout in it is suspended or terminated, or has no verified bank account. An Admin may approve anyway by typing a reason (at least 10 characters), which is audited (`payout_run_hold_overridden`, with the partners and reasons it covered). Finance cannot override. The Payouts tab shows what blocks each payout. The check runs in the approval service before the approval is recorded, so a blocked approval leaves the request pending.

## Export, audit and retention

CSV and print are plain links (never prefetched). Each is authorised exactly like the page and **writes an audit entry before any data leaves** (`partner_statement_exported`, entity `PartnerProfile`: the format, the period key, line and adjustment counts, the caller's role and whether the viewer had full detail or totals only; no names, amounts, customer codes or bank digits). If the audit write fails, nothing is exported. CSV cells that a spreadsheet could read as a formula are neutralised. The print version is a standalone page that prints on A4 or saves as a PDF.

The **letterhead** (up to six lines) and **registration text** printed on exports are set in Settings, Partner finance, Statements, and stored in the database, not in the repository.

**Retention.** Audit rows are append-only and hash-chained like every other audit entry, and are kept for the life of the audit log (the log has no expiry job; its daily anchors use the configured retention). `PartnerAttributionEvent` rows hold ids, a validated code and a decision, no personal data, and are deleted with the person on erasure; they may be pruned by age if volume requires (nothing reads them). Statement queries are kept as tasks and records for the life of the task history.

## Settings (Settings, Partner finance)

Tax rules, Overrides, Statements (letterhead and registration), Referrals (form link, lapse window, who receives queries), and To approve (pending rule changes). Setting changes are validated, stored in `PartnerWorkspaceSetting` and audited with the old and new value.

## Scale

Measured on a synthetic volume database (5,000 partners, 300,000 accruals, 50,000 payout lines, about 295,000 override accruals added by the generator, 10,000 referral touches), local Postgres, the admin view:

| Read | Before | After |
|---|---|---|
| Overview summary | 590 ms | 95 ms (246 ms with the override accruals added) |
| Referred list | 862 ms | 84 ms |
| Network | 267 ms | 187 ms |
| Commissions | 65 ms | 23 ms (55 ms with overrides) |
| Statements by month or year | 40 to 45 ms | 21 to 61 ms |

What changed: one migration of additive indexes (`20270131000000_partner_workspace_indexes`: sourced accounts by partner and client, accruals by date, payout lines by accrual, payouts by partner, adjustments by partner and date, and two expression indexes for the free-text referral source); the per-person account pick sorts with the `C` collation (a locale-aware sort of text ids was most of the cost); counts no longer join what a count does not need; the summary reads the accrual table once; the referred list cuts its page before the display joins; search resolves customer and partner codes to ids first. Every list is paged (25 rows, at most 100); a statement refuses to load more than 20,000 lines rather than show a partial total; the network tree is capped at 5,000 partners.

`src/lib/partners/native/perf.db.test.ts` holds per-query time budgets (about twice the measured time) and fails if a key read exceeds its budget. It needs a volume database and is skipped by default: seed one with a script of your own (the repository holds none), then `PARTNER_PERF_DB_TEST=1 DATABASE_URL=<local volume db> npx vitest run src/lib/partners/native/perf.db.test.ts`. `PARTNER_PERF_SCALE=0.05` shrinks every budget so you can see it fail.

Known costs: a customer-code search (substring) scans the customer table (about 0.35 to 0.5 s at 30,000 customers and 600,000 accruals); the first generation of override accruals is a batch job (about 100 s for 295,000 sources, 14 s when nothing changed).

## Operations

- Flag: `PARTNER_WORKSPACE_ENABLED=1`. Optional: `PARTNER_SOURCE=sample` (development), `PARTNER_ALLOW_SAMPLE=1`.
- Migrations: `20270130000000_partner_finance_foundations` (tables and three nullable accrual columns) and `20270131000000_partner_workspace_indexes`. Both are additive. The foundation migration adds a RESTRICT foreign key from `PartnerReferralTouch` to `Client`; the data-privacy erasure transaction deletes touches and trail rows before the client.
- Tests: the real-database suites (`queries.db.test.ts`, `visibility.db.test.ts`, the override generator, referral touch and statement query tests, and the erasure test) need a freshly migrated scratch database and are skipped unless `PARTNER_NATIVE_DB_TEST=1` (or `ERASURE_DB_TEST=1`) is set with a local `DATABASE_URL`. Run them one file at a time (they share the database).

## Not modelled

Invoice numbers and GSTIN printing; payment instructions (the system never moves money); a carried-forward negative net; a threshold that applies only to the excess over it (a rule applies to the whole running total once passed); per-line override reversals (nothing sets REVERSED today; a reversal is a negative accrual).
