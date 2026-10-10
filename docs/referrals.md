# Referral programme

A native consumer referral programme inside the CRM. Everything ships dark: nothing is shown, written or reachable unless `REFERRAL_PROGRAM_ENABLED=1`. The CRM never sends a message and never moves money.

## How it works

1. **Referrer.** An existing customer (Admin: Referrals, Referrers, "Make a referrer"). They get a code: 8 characters from an alphabet without look-alikes, drawn from the OS random source, unique, revocable (with a reason), several per referrer allowed. The share link is `REFERRAL_LINK_BASE` (an https address) plus `?ref=CODE`.
2. **Attribution.** The app-signup webhook already accepts `referralCode`. After the signup is ingested, `attributeAfterIngest` credits it, idempotently per app user (the claim key is a hash of the app user id). First touch wins. Blocked: unknown or revoked code, a code that did not exist at signup time (history is never rewritten), a suspended referrer, self-referral (same customer, phone key, email key or PAN) and a person who was already a customer. A failure here never changes the webhook's response; the scheduled job re-attributes recent signups from the signup ledger.
3. **Progress.** Signed up, KYC complete, First funding. Derived from the customer's KYC record (approved) and funding record (partly or fully funded); nothing is invented, order is enforced and a recorded event is never re-timed. Refresh runs in the cron tick and from the Admin screen.
4. **Rules.** Admin-editable in the database: event, fixed amount or percent of the first funding, per-reward maximum, monthly cap per referrer, validity window, on/off. There are no rules by default, so nothing accrues. A rule switched on with no start date starts at that moment.
5. **Ledger.** Append-only (a trigger refuses UPDATE): ACCRUED, REVIEW_CLEARED, REVERSED, APPROVED, PAID_MARKED, each with an idempotency key. State is derived from the entries. Abuse checks (many sign-ups in a day, shared phone, email or PAN with the referrer or another referral, cap applied) put an accrual in Needs review; it stays off statements until an Admin or Finance person clears or reverses it.
6. **Statements.** One per referrer per month: Prepared, Approved by a different person, then Paid, which is only a marker with a bank reference.
7. **Messages.** Invitations are drafts returned as text. They need marketing consent (consent ledger, when enforcement is on), pass the agent copy guardrails, may not mention amounts or earnings, and must carry the configurable mandatory disclaimer (no default: no disclaimer, no draft).

## Roles

Admin: everything. Finance: view, refresh, prepare, approve (not the statement they prepared), mark paid, reverse, clear review. Nobody else can see or call anything.

## Data and privacy

`Referrer.clientId` is a RESTRICT foreign key to Client; the erasure transaction removes the person's referrer record, codes, referrals and events first. Ledger and statement rows keep only plain ids and amounts, so they remain as anonymous financial records. The DB-dump erasure test covers it. No analytics event is emitted and CleverTap is not written to.

## Configuration

`REFERRAL_PROGRAM_ENABLED` (off), `REFERRAL_LINK_BASE` (unset: no share link). Settings in the Rules tab: disclaimer, review threshold.
