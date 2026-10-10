# Consent and do-not-contact

A ledger of what each customer has agreed to, and a set of checks that stop automated contact when they have not. It is built for the posture the Digital Personal Data Protection Act, 2023 expects: consent is specific to a purpose, easy to withdraw, and provable. It is not legal advice; your counsel owns the wording and the policy.

Everything here is off by default. Merging it changes nothing.

| Switch | What it does | Default |
| --- | --- | --- |
| `NEXT_PUBLIC_CONSENT=1` | Shows the Consent panel on the customer page, the `/settings/consent` admin page, the CSV export and the inbox warning banner. | off |
| `CONSENT_ENFORCEMENT=1` | Makes agents, journeys, the app-signal push and the WhatsApp opt-out keyword actually check or write consent. Only the exact value `1` counts. | off |
| `CONSENT_RECORD_ONLY_PURPOSES` | Comma-separated purposes to switch to "record only" (see below). | empty |

## Purposes

| Purpose | Default mode | Covers |
| --- | --- | --- |
| Marketing messages (`MARKETING_COMMS`) | opt-in required | Promotional and onboarding nudges by message, email or push. |
| Service messages (`SERVICE_COMMS`) | allowed by default | Account, KYC and order notices. |
| AI processing of chats (`AI_PROCESSING_OF_CHATS`) | opt-in required | Letting an assistant read a conversation to suggest a reply. |
| Call recording (`CALL_RECORDING`) | opt-in required | Recording and reviewing calls. |
| Sharing with partners (`DATA_SHARING_PARTNERS`) | opt-in required | Sharing profile signals with a processor or partner. |
| Do not contact (`DO_NOT_CONTACT`) | a flag, not a purpose | "Granted" means the flag is in force; "withdrawn" means it was lifted. |

The policy lives in one small file, `src/lib/consent/policy.ts`. Compliance can change a purpose's mode there, with a normal code review.

### Modes

- **required**: allowed only with a current GRANTED record. No record means no.
- **default_allow**: allowed unless the customer has explicitly WITHDRAWN. Silence and a lapsed grant do not stop it.
- **record_only**: never blocks. The decision still reports what would have blocked, so you can watch before you enforce.

A do-not-contact flag always wins for anything that contacts the customer (marketing and service messages), even over a grant and even in record-only mode. It does not apply to processing purposes such as AI processing of chats.

## The ledger

Each row is one fact: customer, purpose, optional channel (`whatsapp`, `sms`, `email`, `call`, `push`; empty means every channel), GRANTED or WITHDRAWN, where it came from (`LEAD_FORM`, `APP`, `WHATSAPP_KEYWORD`, `RM_RECORDED`, `IMPORT`, `API`), the notice version and a hash of the notice text shown, when it was captured and by whom, an optional evidence reference (for example a message id) and an optional expiry.

It is append-only. A withdrawal is a new row; nothing is edited. The database rejects UPDATE on the table. The current state is the latest row per customer, purpose and channel. A channel-specific row and an all-channel row compete by date, newest wins; on an exact tie the withdrawal wins.

Customers who ticked the consent box on a lead form (`marketingConsentAt`) are read as marketing GRANTED from that moment. There is no data migration; the tick is read on the fly and any later ledger row overrides it. Customers with nothing on file are "not recorded".

## How enforcement works

With `CONSENT_ENFORCEMENT=1`:

- **Nudger**: candidates without any marketing consent evidence are left out of the query, then each is checked in full (do-not-contact, withdrawal, expiry). `draftNudge` also skips with the reason "no consent". Drafts still need a person to approve each one.
- **Reply assist and other agents**: call `assertConsent(clientId, purpose, channel)` from `src/lib/consent/enforce.ts`. It throws `ConsentDeniedError` when the customer has not agreed, and does nothing while enforcement is off.
- **App-signal push**: customers with no marketing consent are not sent. A customer who withdrew, or asked not to be contacted, is sent with the existing `av_sales_paused` signal set to true so campaigns suppress them. No new profile property is added.
- **Journeys**: `send_message` and `send_email` nodes are skipped with an activity note "blocked: no consent", and the journey carries on. A node is treated as marketing unless its config sets `purpose` to `SERVICE_COMMS`.
- **Manual replies**: never blocked. When the customer has withdrawn marketing consent or asked not to be contacted, the inbox shows a banner above the composer. Team members can still answer a question the customer has just asked.
- **WhatsApp opt-out keywords**: a message that is entirely a phrase such as "STOP", "unsubscribe", "band karo" or its Devanagari equivalent records a marketing WITHDRAWN row for WhatsApp and creates a follow-up task for the owning team member. It never replies. Longer messages ("stop my SIP", "do not stop") are left to a human on purpose.

If the ledger cannot be read while enforcement is on, the action is blocked (fail closed), not allowed.

## Rolling out safely

1. Deploy with both flags off. Nothing changes.
2. Set `NEXT_PUBLIC_CONSENT=1`. Review the admin page: counts, policy, recent withdrawals. Let the team record consents they already hold, with a reason each time.
3. Set `CONSENT_RECORD_ONLY_PURPOSES` to every purpose you plan to enforce, then set `CONSENT_ENFORCEMENT=1`. Opt-out keywords and do-not-contact flags are honoured from this point; nothing else is blocked.
4. Watch what would have been blocked. Fix the data (capture consent properly, import evidence) until the gap is understood.
5. Remove purposes from the record-only list one at a time, starting with marketing.
6. Keep a signed-off record of the notice text and version outside the repository.

## Retention and erasure

Consent records are evidence, so they are kept for as long as the customer relationship and your retention policy require. When a customer is erased through an approved erasure request, their ledger rows are deleted in the same transaction (the table allows DELETE for exactly this reason). If you must prove a withdrawal was honoured after erasure, keep only a hashed tombstone in the audit log; decide this with counsel.

## Export

Admins can download the ledger as CSV from the admin page. It contains the customer code, purpose, channel, status, source, notice version and timestamps. It contains no names, contact details, reasons or user ids.
