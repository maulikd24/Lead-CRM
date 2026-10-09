# Portfolio feed: push contract (version 1)

Audience: the engineer who builds the sender in the back-office system. All examples use synthetic data.

The feed lets the back office keep Supportify's portfolio data current: holdings snapshots and transactions for customers that already exist in Supportify. It feeds the Customer 360 page (asset-class ring, AUM, key dates) and the intelligence engines (concentration, idle cash, activation).

It is off by default. Nothing is accepted until an admin sets `PORTFOLIO_FEED_ENABLED=1` and `PORTFOLIO_FEED_SECRET` on the server.

## 1. Endpoint

```
POST /api/ingest/portfolio
Content-Type: application/json
x-timestamp: <Unix time in whole seconds>
x-signature: <hex HMAC-SHA256 of "<x-timestamp>.<raw request body>", key = PORTFOLIO_FEED_SECRET>
```

The signature covers the timestamp and the body together, joined by a dot. A `sha256=` prefix on the signature is accepted. Sign the exact bytes you send. A correctly signed request whose timestamp is more than 5 minutes away from the server clock (either direction) is refused with `401`, so a captured request cannot be replayed later. Keep your clock on NTP and use a fresh timestamp on every attempt, including retries.

Node example:

```js
import crypto from "node:crypto";
const raw = JSON.stringify(batch);
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = crypto.createHmac("sha256", process.env.PORTFOLIO_FEED_SECRET).update(`${timestamp}.${raw}`, "utf8").digest("hex");
await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-timestamp": timestamp, "x-signature": signature }, body: raw });
```

curl example:

```sh
TS=$(date +%s); SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$PORTFOLIO_FEED_SECRET" | awk '{print $NF}')
curl -X POST "$URL" -H "content-type: application/json" -H "x-timestamp: $TS" -H "x-signature: $SIG" --data-binary "$BODY"
```

## 2. Request body

```json
{
  "version": 1,
  "batchId": "2026-10-09T02:00-run-0412",
  "customers": [
    {
      "customer": { "clientCode": "CL-00123", "pan": "ABCDE1234F", "mobile": "+91 90000 00001", "email": "asha.example@example.test" },
      "holdings": [
        {
          "accountNumber": "ACC-100045",
          "productCode": "MF-SYN-001",
          "productName": "Synthetic Growth Fund",
          "category": "MUTUAL_FUND",
          "isin": "INF000A00001",
          "quantity": "100.25",
          "avgCost": 2400.5,
          "currentValue": 250000,
          "asOfDate": "2026-10-08",
          "revision": 1,
          "externalRef": "ACC-100045-MF-SYN-001"
        }
      ],
      "transactions": [
        {
          "externalRef": "TXN-9000001",
          "accountNumber": "ACC-100045",
          "productCode": "MF-SYN-001",
          "type": "SIP",
          "date": "2026-10-05T09:00:00+05:30",
          "settlementDate": "2026-10-07",
          "quantity": 10,
          "price": 2500,
          "grossAmount": 25000,
          "netAmount": 24990,
          "brokerage": 10,
          "revision": 1
        }
      ]
    }
  ]
}
```

### 2.1 Envelope

| Field | Type | Rules |
|---|---|---|
| `version` | integer | Must be `1`. A future breaking change ships as `2`; additive changes keep `1` (unknown fields are ignored). |
| `batchId` | string | 1 to 100 characters of `A-Z a-z 0-9 . _ : @ / -`. Identifies the batch in the audit log. It is not used for deduplication (rows are idempotent on their own keys, section 5). |
| `customers` | array | 1 to 100 entries. |

### 2.2 `customer` (who the rows belong to)

**`clientCode` or `pan` is required.** Only one of them can authorise a write. Mobile and email are optional corroboration and can never identify a customer on their own: a customer sent with only a mobile and/or email is reported as `unmatched` (`NO_STRONG_ID`) and nothing is written.

| Field | Type | Rules |
|---|---|---|
| `clientCode` | string | The Supportify customer code (for example `CL-00123`). Recommended: the back office stores this code against each of its customers (no new column is added on the Supportify side), so it is the shared id between the two systems. Letters, digits and `-`. |
| `pan` | string | Normalised (trimmed, upper-cased) and format-checked (`AAAAA9999A`). Use this if the back office cannot store the code. |
| `mobile` | string | Optional corroboration. Compared on the last 10 digits. |
| `email` | string | Optional corroboration. Compared case-insensitively. |

An identifier that is present but malformed makes the customer `invalid` (`INVALID_IDENTIFIER`): it is never silently dropped in favour of another one. Customers are never created by the feed. See section 4 for how matching works.

### 2.3 `holdings[]` (a snapshot of one holding on one day)

| Field | Type | Required | Rules |
|---|---|---|---|
| `accountNumber` | string | yes | The trading/demat account number. Created on first sight for the matched customer and then belongs to that customer for good. |
| `productCode` | string | yes | Your instrument code. Created on first sight. |
| `productName` | string | no | Defaults to `productCode`. Only used when the product is created. |
| `category` | enum | no | `EQUITY`, `MUTUAL_FUND`, `PMS`, `INSURANCE`, `BOND`, `FIXED_DEPOSIT`, `NPS`, `AIF`, `OTHER`. Defaults to `OTHER`. Drives the asset-class ring, so send it. |
| `isin` | string | no | 12-character ISIN. Ignored if another product already holds it. |
| `quantity` | decimal | yes (unless `closed`) | 0 or more. |
| `avgCost`, `currentValue` | decimal | no | 0 or more, in INR. AUM is the sum of `currentValue` over the latest snapshot of each holding. |
| `closed` | boolean | no | Send `true` for a holding that has been sold. It is stored as quantity 0 and value 0 on that `asOfDate` and the Customer 360 page hides zero-quantity holdings. (Sending `quantity: 0` does the same.) Without this, a sold holding would stay in the portfolio forever. |
| `asOfDate` | date | yes | The snapshot day (the UTC calendar day is used). ISO 8601 only: `2026-10-08` or a timestamp with `Z` or an offset. Not before 2000-01-01 and not more than 24 hours in the future. One row per holding per day; a new day adds a new row, which is what gives the AUM trend. |
| `revision` | integer | yes | The sender's monotonic version of this row, 0 to 2,000,000,000 (see section 5). |
| `externalRef` | string | no | Your unique key for the holding. Defaults to `<accountNumber>-<productCode>`. |

Decimals are numbers or numeric strings with at most 13 integer digits and at most 6 decimal places (no exponents). Prefer strings for money: they are stored exactly, with no floating-point rounding.

### 2.4 `transactions[]`

| Field | Type | Required | Rules |
|---|---|---|---|
| `externalRef` | string | yes | Your unique transaction id. The idempotency key. |
| `accountNumber` | string | yes | As for holdings. |
| `productCode` | string | no | |
| `type` | enum | yes | `BUY`, `SELL`, `SIP`, `REDEMPTION`, `DIVIDEND`, `SWITCH_IN`, `SWITCH_OUT`, `CHARGES`, `OTHER`. |
| `date` | date | yes | ISO 8601 as above, between 2000-01-01 and 24 hours ahead. |
| `settlementDate` | date | no | ISO 8601, not before 2000-01-01. |
| `quantity`, `grossAmount`, `netAmount` | decimal | `grossAmount` yes | Signed: the schema stores them as plain decimals, so a reversal may be negative if that is how your system models it. |
| `price`, `brokerage` | decimal | no | 0 or more. |
| `revision` | integer | yes | Monotonic version of this transaction (see section 5). |

## 3. Limits

| Limit | Value |
|---|---|
| Request body | 2,000,000 bytes |
| Customers per batch | 100 |
| Holdings plus transactions per customer | 1,000 |
| Holdings plus transactions per batch | 5,000 |
| Requests per IP | 120 per minute |

Split larger loads into several batches. Order does not matter, because of the revision rule in section 5.

## 4. Customer matching

Matching reads existing customers only (archived and merged customers are excluded) and is strict, because financial data must never land on the wrong customer:

- `clientCode` or `pan` is required. Without one: `unmatched` with `code: NO_STRONG_ID`.
- A `clientCode` or `pan` that matches nobody: `unmatched`. A matching mobile or email never rescues it (a typo must not send data to someone else).
- `clientCode` and `pan` pointing at different customers, or one matching several: `ambiguous`.
- `mobile` and `email` only corroborate. If they are sent and match customers, the customer found by `clientCode`/`pan` must be among them; if they match only a different customer the result is `ambiguous`. A number that matches nobody (a new number) does not block the write. A number shared by several customers (a family) is fine as long as the identified customer is one of them.
- `unmatched`, `ambiguous` and `invalid` customers are reported and nothing is written for them.

## 5. Idempotency, ordering and corrections

You may resend any batch. Every row has a natural key:

| Row | Key |
|---|---|
| Position | `portfolio_feed` + `externalRef` + `asOfDate` |
| Transaction | `portfolio_feed` + `externalRef` |
| Account | `accountNumber` |
| Product | `productCode` |

**Versioning.** Each holding and transaction carries a `revision`: an integer you increase every time you change that row (a counter, or a version from your system). The server applies an update to an existing row only when the incoming `revision` is strictly greater than the stored one:

- same row, same `revision`, same values: `unchanged` (no write);
- greater `revision`: updated in place (or `unchanged` if the values are identical);
- lower `revision`, or the same `revision` with different values: `stale`. Nothing is written. A late retry of an old batch therefore can never undo a correction.

Because of this rule the order of batches and of rows does not matter, and a replay of a whole batch returns the same totals with everything `unchanged` (or `stale` for rows corrected since), with status `200`.

**Duplicate keys inside one request** are refused: if the same position key (`externalRef` + `asOfDate`) or the same transaction `externalRef` appears more than once in a batch, in one customer or across customers, every occurrence is reported as `DUPLICATE_KEY` and none is written. The same applies to rows on an `accountNumber` that two customer entries in the batch both claim.

A row that collides with another customer's data is refused: an `accountNumber` that already belongs to a different customer gives `ACCOUNT_OWNED_BY_OTHER_CUSTOMER`; a position or transaction key that already exists under a different account gives `REFERENCE_OWNED_BY_OTHER_ACCOUNT`.

If a request fails with `429` or `5xx`, or times out, resend the whole batch with a fresh timestamp.

## 6. Responses

The body never contains personal data, identifiers or submitted values. Customers and rows are referred to by their zero-based position in your request.

`200` (everything accepted; `stale` rows do not count as problems) or `207` (something was reported: an unmatched, ambiguous or invalid customer, or a failed row):

```json
{
  "version": 1,
  "batchId": "2026-10-09T02:00-run-0412",
  "counts": {
    "customers": { "received": 2, "matched": 1, "unmatched": 1, "ambiguous": 0, "invalid": 0 },
    "holdings": { "created": 2, "updated": 0, "unchanged": 0, "stale": 0, "failed": 1 },
    "transactions": { "created": 1, "updated": 0, "unchanged": 0, "stale": 0, "failed": 0 }
  },
  "results": [
    {
      "index": 0,
      "status": "matched",
      "holdings": { "created": 2, "updated": 0, "unchanged": 0, "stale": 0, "failed": 1 },
      "transactions": { "created": 1, "updated": 0, "unchanged": 0, "stale": 0, "failed": 0 },
      "errors": [{ "kind": "holding", "index": 2, "code": "INVALID_ROW" }]
    },
    { "index": 1, "status": "unmatched" }
  ]
}
```

`results[].status` is `matched`, `unmatched`, `ambiguous` or `invalid`. An `unmatched` customer may carry `code: NO_STRONG_ID`. An `invalid` customer carries `code`: `INVALID_ENTRY` (not an object), `INVALID_IDENTIFIER`, `TOO_MANY_ROWS`.

Row error codes (`errors[].code`): `INVALID_ROW` (failed validation; the row was skipped), `DUPLICATE_KEY`, `ACCOUNT_OWNED_BY_OTHER_CUSTOMER`, `REFERENCE_OWNED_BY_OTHER_ACCOUNT`, `WRITE_FAILED` (temporary; resending the batch retries it).

### Error status codes

| Status | Meaning |
|---|---|
| 400 | The body is not valid JSON. |
| 401 | Signature or timestamp missing or wrong, or the timestamp is more than 5 minutes off. Checked before the body is parsed. |
| 404 | The feed is not enabled on this server. |
| 413 | Body larger than 2,000,000 bytes. |
| 422 | The envelope is invalid (wrong `version`, bad `batchId`, no customers, over a limit). `issues` lists `path` and `code` only. |
| 429 | Rate limit. Honour `Retry-After`. |
| 500 | Generic failure. Resend the batch. |

## 7. Security and privacy

- Authenticate every request with the HMAC signature over timestamp and body. The comparison is constant time and happens before any parsing. The secret is held only in the server environment.
- Send over HTTPS only.
- The server stores only the validated fields above. Unknown fields are dropped. The request body is never logged, and neither are values or identifiers; logs carry error class names only.
- Each batch writes one audit entry in the user-event log (`DATA_UPDATE`, entity `PortfolioFeed`, the `batchId` and counts). It holds counts, never identifiers or values.
- Rotate the secret by changing `PORTFOLIO_FEED_SECRET` on the server and the sender together.

## 8. Pull model later

The pull alternative is prepared but not enabled. `src/lib/portfolio-feed/back-office-client.ts` defines a `BackOfficeClient` interface and an HTTP client skeleton (injected `fetch`, base URL in the integration settings, token in the encrypted credentials). A pull job would call it per customer and hand the resulting entry to the same ingest code, so the Customer 360 page does not change. The back-office endpoints it calls are placeholders until the contract is agreed.
