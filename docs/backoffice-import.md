# Back-office file import

Loads client master, holdings and transaction CSV files from an operations back office into Supportify. Off by default.

## Switching it on

| Setting | Meaning |
|---|---|
| `BACKOFFICE_IMPORT_ENABLED=1` | Master switch. Off: the settings page 404s, uploads are refused and the cron job does nothing (it touches neither the database nor the file system). |
| `BACKOFFICE_IMPORT_DIR=/absolute/path` | Optional drop folder for the nightly import. Without it only Admin uploads work. |
| `BACKOFFICE_IMPORT_HOUR_UTC=21` | Hour (UTC) the nightly job runs. Default 21, which is 02:30 in India. It runs once a day. |

Admin page: `/settings/backoffice-import` (Admin role only). The nightly job is the `backoffice-import` entry of the existing cron tick.

## What it does and does not do

- Matches clients on **client code or PAN only** (the portfolio feed's rules in `src/lib/portfolio-feed`). Mobile and email only corroborate: a mobile or email that belongs to a *different* client makes the row ambiguous and it is refused.
- Holdings and transactions are written by the portfolio feed's own writer, so row validation, signed amounts, row revisions and the "never overwrite with an older revision" rule are the same as for the push feed.
- Client master rows update **existing** clients only. A client that is not found is reported, never created (creation needs routing, a stage and an owner, which a file cannot decide). Default policy fills blanks only. `overwrite` replaces name, city, state, client type and investment category; email and mobile are always only filled, never replaced.
- Idempotent: a file is identified by the SHA-256 of its bytes. An identical file that already imported is skipped. A corrected file has a new checksum and is imported; each row carries a revision, so unchanged rows stay unchanged and changed rows update. The directory is never modified.
- **Dry run** (the default for uploads) runs the whole pipeline against the real data but writes nothing, and shows what would be created, updated, left unchanged, or refused.
- Limits: 5 MB per file, 20,000 rows, 60 columns, 500 characters per value, 1,000 rows per client, 10 files per nightly run.
- Logs and audit entries hold counts, line numbers, field names and error codes only. No client names, identifiers or values.

## File contract (default column names)

CSV, UTF-8 (a BOM is fine), comma separated, first row is the header, quotes as in RFC 4180. Header matching is case-insensitive. Every column name below can be changed in the mapping (Settings page); an unmapped column means the file does not have it.

File names start with `clients`, `holdings` or `transactions` (changeable) and end in `.csv`.

**Identity columns (all three file types).** At least one of `clientCode` or `pan` is required on every row. `mobile` and `email` are optional.

**Client master**: `clientCode`, `pan`, `mobile`, `email`, `name`, `city`, `state`, `clientType`, `investmentCategory`.

**Holdings** (one row per holding per date): `clientCode`, `pan`, `mobile`, `email`, `accountNumber` (required), `productCode` (required), `productName`, `category`, `isin`, `quantity` (required, 0 or more), `avgCost`, `currentValue`, `closed` (`Y`/`N`: a sold holding is stored as 0), `asOfDate` (required), `revision`, `externalRef`.

**Transactions**: `clientCode`, `pan`, `mobile`, `email`, `externalRef` (required, unique per transaction), `accountNumber` (required), `productCode`, `type` (required), `date` (required), `settlementDate`, `quantity` (signed), `price`, `grossAmount` (required, signed), `netAmount` (signed), `brokerage`, `revision`.

Values:

- Numbers are plain decimals (`1234.50`): no thousands separators, at most 13 integer digits and 6 decimals.
- Dates are `YYYY-MM-DD` by default. The mapping can switch to `DD/MM/YYYY` or `MM/DD/YYYY` (also `-` or `.` as the separator).
- `category` is one of EQUITY, MUTUAL_FUND, PMS, INSURANCE, BOND, FIXED_DEPOSIT, NPS, AIF, OTHER. `type` is one of BUY, SELL, SIP, REDEMPTION, DIVIDEND, SWITCH_IN, SWITCH_OUT, CHARGES, OTHER. The mapping's value maps translate the back office's own labels (for example `purchase = BUY`).
- `revision` (optional, whole number): the sender's version of the row. Without it, every row of a run carries the run's own increasing number, so a later file always supersedes an earlier one.

## Per-row error report

Each run keeps up to 200 problems as `line`, `code`, and the names of the fields at fault (never the values). Codes: `NO_STRONG_ID`, `INVALID_ROW`, `DUPLICATE_KEY`, `TOO_MANY_COLUMNS`, `CUSTOMER_UNMATCHED`, `CUSTOMER_AMBIGUOUS`, `ACCOUNT_OWNED_BY_OTHER_CUSTOMER`, `REFERENCE_OWNED_BY_OTHER_ACCOUNT`, `WRITE_FAILED`. A file-level problem (empty file, missing column, over a limit) fails the run with one code and imports nothing.

## Data model

Two additive tables (migration `20261130000000_backoffice_import`): `BackOfficeImportConfig` (the stored mapping) and `BackOfficeImportRun` (one row per attempt: counts, error report, checksum, status). Neither references `Client`, so the data-privacy erasure transaction needs no change.

## Open question

What columns does the real back-office export have? Everything above is a generic contract, and the mapping exists so that the real layout can be configured without a code change.
