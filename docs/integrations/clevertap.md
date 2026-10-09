# CleverTap integration runbook

Audience: Admins and operations. Read sections 1 to 4 before you switch anything on.
Where this document says "to be confirmed", the behaviour depends on CleverTap or on the app and has not been verified.

## 1. What CleverTap is for

CleverTap holds app behaviour and campaign data for your customers. Supportify connects to it so that:

- app and campaign activity shows up on the customer timeline,
- Supportify's own customer signals (lifecycle stage, KYC, next best action, asset-class acceptance) can reach CleverTap for segmentation,
- an RM can see a customer's app profile on the client page.

### Data flows

| Direction | What | Where it appears | Notes |
|---|---|---|---|
| CleverTap to Supportify | Webhook events (`identity`, `evtName`, `evtData`) | A MESSAGE activity on the customer timeline, e.g. "App event: KYC completed" | Only existing customers. An event for an unknown email or phone is dropped; CleverTap never creates a lead. |
| Supportify to CleverTap | Allowlisted `av_` signals (section 1.1) | CleverTap user profile properties | Only when every condition in section 2.1 is met. |
| CleverTap to Supportify (read) | Profile lookup | "App and campaigns" card on the client page | Read-only. Allowed in any region. |

### Inbound events: what is kept

- The event name (control characters removed, 120 characters at most) and the line "App event: <name>".
- A few properties, and only these keys (case and separators ignored): `campaign`, `campaign_name`, `campaign_id`, `channel`, `platform`, `source`, `step`, `status`, `screen`, `product`, `category`. Everything else in `evtData` is discarded.
- Text values are cleaned: PAN-shaped text and runs of 9 or more digits become `[redacted]`. Numbers of 9 or more digits are dropped. At most 15 properties, 300 characters each, about 1,500 characters in total.
- The raw `identity` is never stored. It is used only to find the customer.
- The customer is matched by email or phone. The identity is used if it looks like an email or a phone number; otherwise the event's own `Email`, `Phone` or `mobile` field is used. If neither is usable, the event is ignored. Phones are matched by exact number, then by the last 10 digits.
- What the webhook route answers: a body that is not valid JSON gets 400 "Malformed body"; a wrong or missing secret gets 401; a repeated identical body is acknowledged as a duplicate and not processed again; more than 300 calls per minute from one IP are rejected (rate limit). Inside a valid body, a missing identity, a missing event name or wrong types produce no event and no error. Events that cannot be matched to an existing customer are skipped.
- Each accepted event also fires the generic "webhook received" journey trigger for that customer.

### 1.1 Outbound `av_` properties (the complete list)

Nothing else is sent. No PAN, balances, portfolio values, notes or chat text. The upload is built from named fields only.

| Property | Value | Meaning |
|---|---|---|
| `av_lifecycle_stage` | text | Customer's lifecycle stage from Supportify's intelligence engine. |
| `av_kyc_approved` | true / false | KYC approved. |
| `av_funded` | true / false | True when the lifecycle stage is Funded, Activated or Active. |
| `av_sales_paused` | true / false | True while the customer has an open complaint, or after a recent call or chat that was scored negative. Marketing should not send sales messages (see section 4.3). |
| `av_nba_programme` | text | Next best action programme. Omitted when there is none. |
| `av_priority` | text | Next best action priority. Omitted when there is none. |
| `av_accept_<asset_class>` | `high`, `medium` or `low` | Asset-class acceptance. One property per asset class, with the name lower-cased, each run of non-alphanumeric characters collapsed to one `_`, and leading or trailing `_` trimmed. Entries with an invalid level or an empty name are skipped. |

The CleverTap identity is the customer's email, or the mobile number if there is no email. A customer with neither is never pushed.

### 1.2 The "App and campaigns" card

- Shown on the client page, above the tabs, only when `NEXT_PUBLIC_CLEVERTAP_CARD=1` (section 2.2).
- Shows platforms, last seen (from the "App Launched" event), whether a push token is registered, and any `av_` properties on the profile.
- Never writes. Works in any region, and does not need the push flag.
- Empty states: "CleverTap is not connected" (not live, disabled, or no credentials), "CleverTap rejected the request" (a 4xx answer), "CleverTap is busy" (429), "Couldn't reach CleverTap" (5xx, network error or timeout), "No app profile found for this customer".

## 2. Safety model

### 2.1 When anything is written to CleverTap

One master switch controls every write. No customer data is sent to CleverTap unless ALL of these are true:

1. `CLEVERTAP_PUSH_ENABLED=1` in the server environment (only the exact value `1`).
2. The Clevertap integration is in `live` mode (and, for the scheduled push, enabled; saving credentials enables it).
3. Account ID and passcode are saved.
4. The saved region is `in1` (spaces and upper case are tolerated).

Details:

- A blank region means CleverTap's default region, which is Europe. If your account is on a non-India region, writes stay blocked until CleverTap enables the India data centre for it. Confirm the region with CleverTap.
- Reads and inbound webhooks work in any region, because that data already lives in CleverTap, and they do not need the flag.
- Two code paths write, and both check the same flag and the same region rule: the scheduled batch push (section 2.3) and the journey action "Sync Clevertap Profile". The journey action answers "CleverTap writes are switched off" or the India error and sends nothing when a condition is missing.
- Exception: "Test connection" uploads an empty list (`d: []`, no customer data) so credentials can be checked before the region is switched. It relies on CleverTap rejecting bad credentials; treat a success as indicative, not proof of the project.

### 2.2 Modes and flags

| Setting | Where | Default | Effect |
|---|---|---|---|
| Mode `mock` | Settings, Apps & Integrations, "Use live credentials" switch off | mock | No network. A built-in simulator answers. Inbound webhooks are accepted without any secret check, except on a deployment where `VERCEL_ENV` is `production`, where they are refused. On any other host (staging, self-hosted, a dev box) a mock integration accepts unauthenticated webhooks and stores the event's properties unfiltered. |
| Mode `live` | Same switch on | | Real CleverTap calls: test connection, webhook secret check, the card, and (only with `in1` and the flag below) writes. |
| `CLEVERTAP_PUSH_ENABLED` | Server environment | Off. Only the value `1` turns it on. | Master switch for every write: the scheduled push and the journey action. |
| `NEXT_PUBLIC_CLEVERTAP_CARD` | Build-time environment | Off. Only the value `1` turns it on. | Shows the card. Because it is set at build time, changing it needs a rebuild and redeploy. |

The mode switch in Settings has only mock and live. The pusher also knows a `dry_run` mode, but nothing in the product sets it, and it sends nothing.

Live mode alone does not allow writes. A live integration without the flag, or with a blank or `eu1` region, only reads.

### 2.3 When the push job runs

The job runs inside the scheduled tick (`/api/internal/cron/tick`). It does nothing, and calls no customer query, unless all the conditions in section 2.1 are true and the integration record is enabled.

If any condition is missing, the tick reports all zeros for `clevertapPush`.

How a run works:

- Up to 25 customers per tick. Only ACTIVE customers who are not deleted or merged and have an email or mobile number.
- Customers never checked come first (oldest first), then the least recently checked, so all customers are visited in turn.
- Customers are sent one at a time, never in parallel. Each request has a 10 second timeout.
- HTTP 429 ("too many concurrent requests") stops the whole batch. The remaining customers are tried at the next tick. The customer that hit 429 is not marked as checked.
- Any other failure (4xx, 5xx, timeout, network error) is recorded for that customer and the batch continues. A failure never marks the customer as pushed.
- One customer's problem cannot stop the others.
- Signals are computed with the read-only intelligence functions. The push writes nothing to the customer record and fires no journeys.

Idempotency: a hash of the `av_` properties is stored after each successful push. If the next run computes the same hash, nothing is sent ("unchanged").

What is stored in the `CleverTapSync` table (one row per customer):

| Column | Meaning |
|---|---|
| `lastHash` | Hash of the last successfully pushed signals. Empty text means never pushed. |
| `lastPushedAt` | Defaults to the time the row was created, so a row created by a failure or a check also shows a time. Do not read it as proof of a push. Use a non-empty `lastHash` as the indicator that the customer has been pushed. |
| `lastError` | Last failure message, at most 500 characters, such as "CleverTap responded 401". The response body is never stored. |
| `lastCheckedAt` | When the customer was last looked at (for rotation). |

The table holds no credentials and no customer data. Erasing a customer under the data-privacy tool removes their row here; it does not remove their profile in CleverTap.

## 3. TEST project or PRODUCTION project

A CleverTap account can hold several projects. Check which one you are connected to before you save anything.

1. Sign in to the CleverTap dashboard and look at the project name at the top left.
2. A test project is typically named `TEST <name>`. A name without `TEST` is typically the production project. (Naming rule: to be confirmed with CleverTap.)
3. Open Settings and then Project in the dashboard (menu path: to be confirmed) and read the Account ID. It must equal the Account ID you enter in Supportify.
4. If you cannot tell, confirm which CleverTap project you are connecting to with the people who own the CleverTap account before connecting.

Rule: connect Supportify to the TEST project first. Never connect a developer machine, a laptop or a local copy of Supportify to the production project. Credentials entered in one environment belong to that environment only.

## 4. Setup for an Admin

### 4.1 Before you switch anything on

All of these must be true before section 4.2 step 7 (writes):

- [ ] CleverTap has enabled the India (`in1`) data centre for the account, and the migration impact on existing profiles and campaigns is understood.
- [ ] The TEST project was verified first (section 3).
- [ ] Compliance has signed off on sending the `av_` properties listed in section 1.1.
- [ ] The DPDP notice and consent wording cover sharing these signals with CleverTap.
- [ ] Marketing has agreed how `av_sales_paused` is used (section 4.3).

### 4.2 Steps

1. Open Settings, Apps & Integrations. The Clevertap card is under Business Tools. The credential fields appear only while the "Use live credentials" switch is on, so turn it on. (Live mode sends nothing to CleverTap while `CLEVERTAP_PUSH_ENABLED` is not 1 or the region is not `in1`.)
2. Enter Account ID, Passcode, Region and Webhook Shared Secret, then Save Credentials. They are stored AES-256-GCM encrypted. Never paste them into chat, email or tickets. Save replaces the whole set, so enter all four fields every time. The field is labelled "Region (optional)". Before India is enabled, use the account's real region (for example `eu1`) or leave it blank. Only `in1` allows writes.
3. In the CleverTap dashboard, open Settings, then Webhooks, or add a webhook channel to a campaign. Set the URL to `https://<supportify-host>/api/webhooks/clevertap`. Add a custom header `X-Webhook-Secret` with the same value as the Webhook Shared Secret. CleverTap does not sign webhooks, so this header is the only check; Supportify rejects the call with 401 if it is missing or wrong.
4. Keep the integration on live once the webhook is configured. In mock mode the webhook is not authenticated (section 2.2).
5. Click Test Connection. It sends an empty upload with no customer data. A failure means the credentials or region were rejected. It does not prove which project you are connected to (section 3).
6. Check the client page card and the timeline. Send one test event from the TEST project and confirm it appears on a test customer.
7. Only when section 4.1 is complete and the region is `in1`: set `CLEVERTAP_PUSH_ENABLED=1` in the server environment and restart or redeploy. The mode must be live. From the next tick, up to 25 customers per tick are pushed, and the journey action may write.
8. To show the card, set `NEXT_PUBLIC_CLEVERTAP_CARD=1` and rebuild.

### Stopping writes (kill switch), fastest first

1. Unset `CLEVERTAP_PUSH_ENABLED` (or set it to anything other than `1`). This stops ALL writes, the scheduled push and the journey action. It is an environment change, so it needs a restart or redeploy to take effect.
2. Switch the Clevertap integration to Mock in Settings. This takes effect immediately and stops writes and live reads. Webhooks then become unauthenticated outside production (section 2.2), so switch back to live after the flag is unset.
3. Clear the region (or set it to a non-`in1` value) by saving the credentials again.

### 4.3 Do-not-contact and `av_sales_paused`

`av_sales_paused` is `true` while a customer has an open service issue. The value is also true after a recent call or chat scored negative. Supportify only publishes the value. It does not stop any CleverTap message. Marketing must build a segment or campaign filter in CleverTap that excludes profiles where `av_sales_paused` is true from sales campaigns, and agree the wording with compliance. Until that filter exists, the flag has no effect.

## 5. Identity and how the card finds a profile

Supportify uses the customer's email, or else the mobile number, as the CleverTap identity when it pushes. The card tries, in order, and stops at the first profile it finds:

1. `identity=` the same value the push uses (email, else mobile as stored).
2. `email=` the customer's email.
3. `identity=` the mobile in `+91XXXXXXXXXX` form.

Duplicates are skipped. Notes:

- CleverTap's profile endpoint accepts one of `email`, `identity` or `objectId`. There is no phone parameter.
- A profile that does not exist is an HTTP 200 with a null record, not a 404. The card shows "No app profile found". A record that is present but empty (`{}`) would show as found, with no platforms or properties.
- A customer with both email and mobile can cost up to three requests; the card gives up after 6 seconds in total.
- Which identity your app SDK sets on CleverTap profiles (for example a user id, email or phone) must be confirmed. It decides whether the lookup and the push line up with the app's own profiles.
- The pusher sets no `Email` property on the profile. Whether a profile keyed on an email identity is found by `email=` is to be confirmed.

## 6. Known limitations and follow-ups

- The change hash covers the `av_` properties only, not the identity. If a customer's email changes, nothing is re-pushed until a signal changes.
- Erasing a customer removes only the Supportify ledger row. The CleverTap profile must be deleted in CleverTap separately.
- If loading a customer or computing its hash throws, the customer is counted as failed in the tick result but nothing is written to `lastError`.
- On the card, a 4xx answer to the first lookup ends the lookup, so later lookup attempts are not tried.
- HTTP 200 can still carry `unprocessed` records. The push does not read the response body, so such a customer is recorded as pushed.
- A customer that CleverTap permanently rejects (some 4xx) is retried each time the rotation comes round, because a failure is not a push.
- The journey action "Sync Clevertap Profile" is separate from the signal push. It uploads Name, Email, Phone and clientStatus (not the `av_` allowlist) and, when the customer has no email or mobile, uses the internal client id as the identity. It is behind the same switch (section 2.1).
- Inbound properties are limited to an allowlist of keys. Digit runs separated by spaces (for example "1234 5678 9012") are not redacted when they sit under an allowed key.
- The card sits above the client tabs, not inside the Overview tab.
- The card's lookup and the pusher's identity depend on the identity your app sets (section 5).
- The Get User Details response shape was taken from CleverTap's published documentation, not from a captured real response. Treat it as to be confirmed against the TEST project.
- Nothing has been run against a real CleverTap project. All behaviour above is verified by tests with fakes and by the code, not by live traffic.
