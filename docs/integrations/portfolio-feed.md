# Portfolio feed: push contract (version 1)

Audience: the engineer who builds the sender in the back-office system. All examples use synthetic data.

The feed lets the back office keep Supportify's portfolio data current: holdings snapshots and transactions for customers that already exist in Supportify. It feeds the Customer 360 page (asset-class ring, AUM, key dates) and the intelligence engines (concentration, idle cash, activation).

It is off by default. Nothing is accepted until an admin sets `PORTFOLIO_FEED_ENABLED=1` and `PORTFOLIO_FEED_SECRET` on the server.

## 1. Endpoint

```
POST /api/ingest/portfolio
Content-Type: application/json
x-signature: <hex HMAC-SHA256 of the raw request body, key = PORTFOLIO_FEED_SECRET>
```

A `sha256=` prefix on the signature is accepted. Sign the exact bytes you send (compute the HMAC after serialising, then send those same bytes). Do not re-serialise between signing and sending.

Node example:

```js
import crypto from "node:crypto";
const raw = JSON.stringify(batch);
const signature = crypto.createHmac("sha256", process.env.PORTFOLIO_FEED_SECRET).update(raw, "utf8").digest("hex");
await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-signature": signature }, body: raw });
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
          "brokerage": 10
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

### 2.2 `customer` (identify the customer, at least one valid identifier)

| Field | Type | Rules |
|---|---|---|
| `clientCode` | string | The Supportify customer code (for example `CL-00123`). This is the recommended identifier: it is the shared customer id between the two systems. |
| `pan` | string | Normalised (trimmed, upper-cased) and format-checked (`AAAAA9999A`). |
| `mobile` | string | Matched on the last 10 digits, so `+91 90000 00001`, `09000000001` and `9000000001` are the same number. |
| `email` | string | Matched case-insensitively. |

Customers are never created by the feed. See section 4 for how matching works.

### 2.3 `holdings[]` (a snapshot of one holding on one day)

| Field | Type | Required | Rules |
|---|---|---|---|
| `accountNumber` | string | yes | The trading/demat account number. Created on first sight for the matched customer. |
| `productCode` | string | yes | Your instrument code. Created on first sight. |
| `productName` | string | no | Defaults to `productCode`. Only used when the product is created. |
| `category` | enum | no | `EQUITY`, `MUTUAL_FUND`, `PMS`, `INSURANCE`, `BOND`, `FIXED_DEPOSIT`, `NPS`, `AIF`, `OTHER`. Defaults to `OTHER`. Drives the asset-class ring, so send it. |
| `isin` | string | no | 12-character ISIN. Ignored if another product already holds it. |
| `quantity` | number or numeric string | yes | 0 or more. |
| `avgCost` | number | no | 0 or more. |
| `currentValue` | number | no | 0 or more, in INR. AUM is the sum of `currentValue`. |
| `asOfDate` | date or timestamp | yes | The snapshot day (the UTC calendar day is used). One row per holding per day; a new day adds a new row, which is what gives the AUM trend. |
| `externalRef` | string | no | Your unique key for the holding. Defaults to `<accountNumber>-<productCode>`. |

### 2.4 `transactions[]`

| Field | Type | Required | Rules |
|---|---|---|---|
| `externalRef` | string | yes | Your unique transaction id. The idempotency key. |
| `accountNumber` | string | yes | As for holdings. |
| `productCode` | string | no | |
| `type` | enum | yes | `BUY`, `SELL`, `SIP`, `REDEMPTION`, `DIVIDEND`, `SWITCH_IN`, `SWITCH_OUT`, `CHARGES`, `OTHER`. |
| `date` | date or timestamp | yes | Not more than 24 hours in the future. |
| `settlementDate` | date or timestamp | no | |
| `quantity`, `price` | number | no | `price` 0 or more. |
| `grossAmount` | number | yes | INR. |
| `netAmount` | number | no | |
| `brokerage` | number | no | 0 or more. |

## 3. Limits

| Limit | Value |
|---|---|
| Request body | 2,000,000 bytes |
| Customers per batch | 100 |
| Holdings plus transactions per customer | 1,000 |
| Holdings plus transactions per batch | 5,000 |
| Requests per IP | 120 per minute |

Split larger loads into several batches. Order does not matter.

## 4. Customer matching

Matching reads existing customers only (archived and merged customers are excluded). The rule is strict because financial data must never land on the wrong customer:

- Every identifier you send that matches somebody must point at the same single customer. An identifier that matches nobody is ignored when another one matched (for example a changed email).
- Two identifiers that point at different customers, or one identifier that matches several customers, gives `ambiguous`: nothing is written for that customer.
- No match at all gives `unmatched`: nothing is written, and the customer is reported by position only.

## 5. Idempotency and replays

You may resend any batch, any number of times, in any order. Every row has a natural key:

| Row | Key |
|---|---|
| Position | `portfolio_feed` + `externalRef` + `asOfDate` |
| Transaction | `portfolio_feed` + `externalRef` |
| Account | `accountNumber` |
| Product | `productCode` |

A row whose values equal what is stored is reported as `unchanged` and causes no write. A row with the same key and different values updates in place (the back office can correct a figure). A replay of a whole batch therefore returns the same totals with everything `unchanged`, and the status is `200`.

A row that collides with another customer's data is refused: an `accountNumber` that already belongs to a different customer gives `ACCOUNT_OWNED_BY_OTHER_CUSTOMER`; a position or transaction key that already exists under a different account gives `REFERENCE_OWNED_BY_OTHER_ACCOUNT`.

If a request fails with `429` or `5xx`, or times out, resend the whole batch.

## 6. Responses

The body never contains personal data, identifiers or submitted values. Customers and rows are referred to by their zero-based position in your request.

`200` (everything accepted) or `207` (something was reported: an unmatched, ambiguous or invalid customer, or a failed row):

```json
{
  "version": 1,
  "batchId": "2026-10-09T02:00-run-0412",
  "counts": {
    "customers": { "received": 2, "matched": 1, "unmatched": 1, "ambiguous": 0, "invalid": 0 },
    "holdings": { "created": 2, "updated": 0, "unchanged": 0, "failed": 1 },
    "transactions": { "created": 1, "updated": 0, "unchanged": 0, "failed": 0 }
  },
  "results": [
    {
      "index": 0,
      "status": "matched",
      "holdings": { "created": 2, "updated": 0, "unchanged": 0, "failed": 1 },
      "transactions": { "created": 1, "updated": 0, "unchanged": 0, "failed": 0 },
      "errors": [{ "kind": "holding", "index": 2, "code": "INVALID_ROW" }]
    },
    { "index": 1, "status": "unmatched" }
  ]
}
```

`results[].status` is `matched`, `unmatched`, `ambiguous` or `invalid`. An `invalid` customer carries `code`: `INVALID_ENTRY` (not an object), `NO_IDENTIFIER` (no usable identifier), `TOO_MANY_ROWS`.

Row error codes (`errors[].code`): `INVALID_ROW` (failed validation; the row was skipped), `ACCOUNT_OWNED_BY_OTHER_CUSTOMER`, `REFERENCE_OWNED_BY_OTHER_ACCOUNT`, `WRITE_FAILED` (temporary; resending the batch retries it).

### Error status codes

| Status | Meaning |
|---|---|
| 400 | The body is not valid JSON. |
| 401 | Signature missing or wrong. Checked before the body is parsed. |
| 404 | The feed is not enabled on this server. |
| 413 | Body larger than 2,000,000 bytes. |
| 422 | The envelope is invalid (wrong `version`, bad `batchId`, no customers, over a limit). `issues` lists `path` and `code` only. |
| 429 | Rate limit. Honour `Retry-After`. |
| 500 | Generic failure. Resend the batch. |

## 7. Security and privacy

- Authenticate every request with the HMAC signature. The comparison is constant time and happens before any parsing. The secret is held only in the server environment.
- Send over HTTPS only.
- The server stores only the validated fields above. Unknown fields are dropped. The request body is never logged, and neither are values or identifiers; logs carry error class names only.
- Each batch writes one audit entry in the user-event log (`DATA_UPDATE`, entity `PortfolioFeed`, the `batchId` and counts). It holds counts, never identifiers or values.
- Rotate the secret by changing `PORTFOLIO_FEED_SECRET` on the server and the sender together.

## 8. Pull model later

The pull alternative is prepared but not enabled. `src/lib/portfolio-feed/back-office-client.ts` defines a `BackOfficeClient` interface and an HTTP client skeleton (injected `fetch`, base URL in the integration settings, token in the encrypted credentials). A pull job would call it per customer and hand the resulting entry to the same ingest code, so the Customer 360 page does not change. The back-office endpoints it calls are placeholders until the contract is agreed.
