# Partner workspace

The Partner workspace shows the partner programme inside the CRM: partners and their network, the people they refer, commissions, payouts and statements. It has two data sources, chosen with `PARTNER_SOURCE`. The earlier external referral-API adapter, its Settings card, its contract-check screen and the mark-verified action were retired: `PARTNER_SOURCE=external` is no longer a source and reads the native one.

| `PARTNER_SOURCE` | What it reads | Who may open it |
|---|---|---|
| unset or `native` (default) | This CRM's own Earnings Engine tables. No external key, no network. | Admin and Finance (everything), a partner user (their own sub-tree), a team manager (the partners the existing hierarchy rules give them) |
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
- There is no external contract to verify: the old contract-check tab, banner and Settings action are gone and `/partners/contract` is a 404.
- Attribution of leads reads the customer table's JSON and free-text fields with an exact, case-insensitive match; at very large volumes an expression index on `leadAttribution->>'partnerCode'` would help. Not added yet (no migration).
