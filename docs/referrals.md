# Referral programme

A native consumer referral programme inside the CRM. Everything ships dark: nothing is shown, written or reachable unless `REFERRAL_PROGRAM_ENABLED=1`. The CRM never sends a message and never moves money.

## How it works

1. **Referrer.** An existing customer (Admin: Referrals, Referrers, "Add a referrer"). They get a code: 8 characters from an alphabet without look-alikes, drawn from the OS random source, unique, revocable (with a reason), several per referrer allowed. The share link is `REFERRAL_LINK_BASE` (an https address) plus `?ref=CODE`.
2. **Attribution.** The app-signup webhook already accepts `referralCode`. After the signup is ingested, `attributeAfterIngest` credits it, idempotently per app user (the claim key is a hash of the app user id). First touch wins. Blocked: unknown or revoked code, a code that did not exist at signup time (history is never rewritten), a suspended referrer, self-referral (same customer, phone key, email key or PAN) and a person who was already a customer. A failure here never changes the webhook's response; the scheduled job re-attributes recent signups from the signup ledger.
3. **Progress.** Signed up, KYC complete, First funding. Derived from the customer's KYC record (approved) and funding record (partly or fully funded); nothing is invented, order is enforced and a recorded event is never re-timed. Refresh runs in the cron tick and from the Admin screen. One referral that cannot be saved never holds up the others: it is counted, logged without any code or id, and retried on the next run.
4. **Rules.** Admin-editable in the database: event, fixed amount or percent of the first funding, per-reward maximum, monthly cap per referrer, validity window, clawback window, on/off. There are no rules by default, so nothing accrues. A rule switched on with no start date starts at that moment. Switching a rule on needs the disclosure wording to be signed off (see below).
5. **Ledger.** Append-only (a trigger refuses UPDATE): ACCRUED, REVIEW_CLEARED, REVERSED, APPROVED, PAID_MARKED, CLAWBACK, CLAWBACK_WAIVED, each with an idempotency key. State is derived from the entries. Abuse checks put an accrual in Needs review; it stays off statements until an Admin or Finance person clears or reverses it.
6. **Statements.** One per referrer per month: Prepared, Approved by a different person, then Paid, which is only a marker with a bank reference.
7. **Messages.** Invitations are drafts returned as text. They need marketing consent (consent ledger, when enforcement is on), pass the agent copy guardrails, may not mention amounts or earnings, and must end with the disclosure wording, which needs a compliance sign-off.

## Recommended guard rails (for the people who set the rules)

No amounts ship with the programme; these are recommendations for when rules are added:

- Pay on KYC complete or first funding, not on sign-up alone (a sign-up is cheap to fake).
- Always set a per-reward maximum and a monthly cap per referrer. A monthly cap of no more than about ten rewards keeps one referrer's exposure bounded; the monthly cap also bounds a lifetime total, so there is no separate lifetime cap.
- Always set a clawback window at least as long as it takes KYC or funding to settle (for example 30 days for KYC and 60 days for funding).
- Keep the review threshold at its default of 5 sign-ups a day until real volumes are known.
- Prefer fixed amounts until compliance confirms whether a reward may be tied to the size of a funding at all (a percentage rule exists, is off by default and needs the wording sign-off to be switched on).

## Clawbacks

A rule can have a **clawback window** (1 to 365 days after the qualifying step; blank means never). When a reward accrues, the end of its window is written on the reward and never moves, even if the rule is edited later.

If the referred person's qualifying step is reversed inside the window, the job **appends** a `CLAWBACK` entry: negative, pointing at the reward, flagged `CLAWBACK_KYC_REVOKED` or `CLAWBACK_FUNDING_REVERSED`. No row is ever edited.

- KYC reversal: the customer's KYC record exists and is no longer approved. Funding reversal: the funding record exists and is no longer partly or fully funded. The time of the reversal is the record's last change, and the window is judged by that time, not by when the job noticed. A job that was down is still caught for 7 days after a window closes.
- A reward that never reached an approved statement is simply cancelled (state "Taken back"; it leaves the statements).
- A reward already approved or paid is **recovered**: the clawback becomes a negative line on the referrer's next statement (a clawback recorded in a month waits for that month's or a later statement). If the lines add up to nothing or less, no statement is made and the balance carries forward.
- Every clawback is flagged for review. A person **confirms** it (a note) or **waives** it (a reason; a positive entry that cancels it and is final). A clawback an approved statement has already recovered can no longer be waived here. A waived clawback is not raised again for that reward.
- A reward that was clawed back still counts towards the monthly cap, so taking one back never makes room for another.
- Statements show recoveries as their own lines; approving re-checks that every line is still what was prepared, so a waiver or a new clawback in between forces a re-prepare.
- The referrer's ledger row shows the state, the clawback, the window end and the full history.

Limits: the reversal time is the KYC or funding record's last change, so an unrelated edit made after a revocation can move it later. If KYC is revoked and approved again before the job runs, nothing is seen.

## Abuse and same-device signals

All of these produce **Needs-review flags and never block a real customer**: the referral is credited and the reward accrues, then a person looks.

- Phone, email or PAN shared with the referrer or with another of the referrer's referrals; many sign-ups in a day (default above 5, editable).
- **Device.** The signup contract accepts an optional `deviceId` (visible ASCII, no spaces, 8 to 128 characters; anything else is dropped and the signup is kept). It is hashed on arrival with a server-side key (HMAC-SHA256, `DEVICE_HASH_KEY`, falling back to `APP_SIGNUP_SECRET`) and only the hash is kept: on the referral, in a small per-customer list, and in the signup ledger's normalised contract. The raw identifier is never stored or logged. With no key nothing is hashed. Changing the key means older hashes no longer match new ones. Flags: same device as the referrer, as another referral of the same referrer, or also seen under a different referrer. No device data means no device flag. Erasing a customer removes their hashes.
- **IP.** Not collected: the signup feed comes from the app's servers, so the address seen is not the customer's. Add it only if the app can pass a hashed client address.
- A partner code that arrived with the signup (see below) flags every reward from that referral.

## Partner codes and consumer referral codes

They are different things that share one signup webhook and must not clash.

| | Consumer referral code | Partner code |
| --- | --- | --- |
| Owner | An existing customer inviting a friend | A channel partner |
| Programme | This one (`/referrals`, Admin and Finance) | The partner workspace |
| Result | A referral, KYC and funding steps, a reward ledger, statements | Attribution of the customer to the partner (first touch) |
| Format | 8 characters from a 30-symbol alphabet | The partner's own code |

The app sends its code in the one `referralCode` field. **Precedence**, implemented in `src/lib/referrals/resolve.ts`:

1. A partner code is always credited to the partner, first touch. This programme never takes that away and never blocks it.
2. A code that is a partner code and not a consumer code belongs to the partner alone: no referral row is written (it would only show as a rejected, unknown code).
3. A payload that also carries a consumer referral (the same string is both, or a separate partner code arrives next to a referral code) still records the referral, flagged `PARTNER_CODE_ALSO_PRESENT`. The flag rides on every reward from it, so a person decides in Needs review whether a reward is owed on top of the partner credit.
4. Anything else is a consumer referral.

The only link between the two programmes is `src/lib/referrals/partner-probe.ts`. It answers two questions from the partner side: `partnerCodeExists(code)` (is this string a partner's code? any case, any partner status: an inactive partner's code is still a partner code) and `partnerProgrammeLive()` (is the partner workspace flag on, so a first touch is really written?). It is the only referral file allowed to import from the partner code, and only the partner flag and `src/lib/partners/referral/is-partner-code.ts`; the older external-referral view is not used at all. A test (`independence.test.ts`) fails if any other referral source file imports from the partner side, or if the seam grows other imports.

How the flags combine (`REFERRAL_PROGRAM_ENABLED` and `PARTNER_WORKSPACE_ENABLED`, both off by default). The partner's first touch is written by the lead intake, only when the partner flag is on. The referral hook runs only when the referral flag is on.

| Partner flag | Referral flag | Partner-only code | Code that is both |
| --- | --- | --- | --- |
| on | on | partner touch; no referral row | partner touch, and the referral recorded with `PARTNER_CODE_ALSO_PRESENT` |
| off | on | nothing credited; no rejected claim | plain referral, no partner flag |
| on | off | partner touch | partner touch only |
| off | off | nothing | nothing |

`src/app/api/webhooks/app-signup/route.precedence.db.test.ts` drives all of this through the real route with a real database.

## Disclosure wording and compliance sign-off

The wording that ends every invitation is configurable (Rules, Disclosure and settings) and has a safe built-in default (no amounts, no promise, a market-risk reminder). It can only be **used** after a compliance sign-off is recorded for the exact wording in force:

- The sign-off names the approver and is bound to a hash of the text: change one character and it no longer matches.
- Whoever last edited custom wording cannot record its sign-off (another Admin does).
- Until the wording in force is signed off, no invitation can be drafted and no reward rule can be switched on.
- It is an attestation kept here. It does not replace the firm's own approval process.

## Roles

Admin: everything. Finance: view, refresh, prepare, approve (not the statement they prepared), mark paid, reverse, clear review, confirm or waive clawbacks. Nobody else can see or call anything.

## Data and privacy

`Referrer.clientId` is a RESTRICT foreign key to Client; the erasure transaction removes the person's referrer record, codes, referrals, devices and events first. Ledger and statement rows keep only plain ids and amounts, so they remain as anonymous financial records. The DB-dump erasure test covers it (including a device hash probe). No analytics event is emitted and CleverTap is not written to.

## Configuration

`REFERRAL_PROGRAM_ENABLED` (off), `REFERRAL_LINK_BASE` (unset: no share link), `DEVICE_HASH_KEY` (optional; falls back to the signup secret). Settings in the Rules tab: disclosure wording and its sign-off, review threshold.

## Layout

Phone: a swipeable facts strip, top-5 lists with "View all" in a bottom sheet, a detail opens in a sheet, one action bar within thumb reach. Laptop (1280 by 720 and up): the page never scrolls; lists with a detail are two panes that scroll inside themselves. Motion is 300 ms or less, plays once and is off under reduced motion.

## Testing

Unit and service tests run with `npm test`. The opt-in real-database tests need a throwaway local Postgres and must run one file at a time (they share one database):

```
REFERRAL_DB_TEST=1 ERASURE_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> \
  npx vitest run --no-file-parallelism src/lib/referrals/*.db.test.ts \
  src/app/api/webhooks/app-signup/route.referral.db.test.ts src/lib/privacy/erasure-pii.db.test.ts
```
