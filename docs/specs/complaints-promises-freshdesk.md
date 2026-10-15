# Complaints and promises, driven by Freshdesk (spec)

Status: spec only. Written 14 Oct 2026 from the demo feedback line "Complaints & Promises - needs to set up the logic via Freshdesk".
Nothing in this file is built yet except the read-only screens named in section 1. No numbers below are final: each default is marked and needs a named owner (open questions, section 7).

## 1. What exists today

- `/service` ("Complaints and promises", flag `service-state`) lists open complaints and overdue promises from the `Complaint` and `Commitment` tables. Rules are in `src/lib/service/rules.ts`: resolve in 24 / 48 / 72 / 120 hours for critical / high / medium / low, acknowledge within 24 hours, reopen for 30 days. These are defaults pending the compliance owner (see `docs/customer-memory.md`, section 2).
- `/support` ("Support SLA", flag `support-sla`) lists Freshdesk hand-offs with first-response and resolution clocks. The clock maths is `src/lib/integrations/freshdesk/sla.ts` (business hours Mon to Fri 09:30 to 18:30 IST, no holiday calendar). Hand-offs arrive through `POST /api/webhooks/freshdesk` (`docs/integrations/freshdesk-handoff.md`).
- The two are not connected. A complaint is registered by a person inside the app; a Freshdesk ticket never becomes one. That gap is what the feedback asks us to close.

## 2. Principle

Freshdesk is the system of record for the ticket (status, priority, who is working it, when it was resolved). The app is the system of record for the formal case on top (severity, owner, SLA clock, resolution note, reopen history, promises). The app never copies the ticket; it stores the Freshdesk ticket id and reads the rest. Nothing is ever sent to a customer or written back to Freshdesk by this logic.

## 3. Mapping: Freshdesk to a complaint

A ticket becomes a complaint **candidate** (never a complaint automatically) when any of these is true on the webhook payload:

| Signal | Source field | Note |
|---|---|---|
| The ticket carries the tag `complaint` | Freshdesk tags | Support agents add the tag. This is the cleanest trigger. |
| Ticket type equals `Complaint` | Freshdesk ticket type | Only if the helpdesk already uses the type. Open question Q1. |
| Priority is `urgent` and the AI summary mentions dissatisfaction | AI agent summary | Candidate only. A person decides. |

A candidate appears in a read-only list on `/service` ("Possible complaints from Freshdesk") with the ticket link, customer, priority, tags and the age. A person with the `service-state` manage right presses "Register as complaint", which uses the existing registration path (it creates the Task for the owner and the audit entry). No candidate is promoted without that click.

Severity default from Freshdesk priority (a default, owner to confirm, Q2): urgent = CRITICAL, high = HIGH, medium = MEDIUM, low = LOW.

## 4. Mapping: Freshdesk status to complaint status

| Freshdesk status | Complaint status | Rule |
|---|---|---|
| Open, Pending | OPEN or IN_PROGRESS | IN_PROGRESS once an owner has started it in the app. |
| Resolved | RESOLVED | Sets `resolvedAt` to the ticket's resolved time. The app does not close it itself. |
| Closed | CLOSED | Only after a person confirms in the app. |
| Reopened (status moves back from Resolved) | REOPENED | Inside the reopen window; the clock restarts (existing rule). Outside it, a new candidate. |

The webhook updates only fields the ticket owns (status, priority, resolved time). It never edits the owner, severity or resolution note, which stay with the app. A status change from Freshdesk is recorded as a `ComplaintEvent` with source `freshdesk` so the history shows who moved what.

## 5. The SLA clock

Two clocks exist today and they disagree on purpose: Freshdesk's support clock (first response, resolution, business hours) and the complaint resolution clock (24 / 48 / 72 / 120 hours, wall clock). Decision needed (Q3): one clock or two.

Recommended: keep both, show both, never add them together.

- Support clock = how fast the helpdesk responds. Shown on `/support`.
- Complaint clock = the commitment to the customer for the formal case. Shown on `/service`.
- A complaint that came from a ticket shows the ticket's own SLA badge once, inside its row, next to the complaint deadline. No badge is repeated elsewhere on the page (see the duplicate audit in `reports/fb-nav-report.md`).

## 6. Promises (commitments)

A promise is "who promised what to whom by when". Freshdesk can only suggest one:

- A reply on a ticket that contains a date ("by Friday", "within 2 days") can be offered as a **suggested** promise, with the sentence quoted as evidence. This follows the existing rule: a suggestion is not counted as late until a person accepts it, and a promise with no stated date is not created.
- Accepting creates the `Commitment` with the ticket id, the owner and the due date, and a Task for the owner.
- A promise is KEPT or BROKEN by a person. Overdue is derived, never stored (existing rule).

## 7. Safe read-only slice (what can ship first)

1. Candidates list on `/service`: reads `ActivityLog`/hand-off rows already stored for Freshdesk tickets and the tag or type signal above. Read only, scoped exactly like the existing queue (an RM sees own customers, a manager their team, an admin everyone). No new write path, no new permission, no new migration if the tag is already in the stored payload (to verify).
2. The existing `/support` and `/service` pages stay as they are.

Not in the first slice: registering from a candidate, status sync, suggested promises, any write back to Freshdesk.

## 8. Edge cases

- Duplicate tickets for one customer: one candidate per ticket id; registration is blocked when a complaint already holds that ticket id.
- A merged customer: the candidate follows the surviving customer (the existing merge rules apply).
- A ticket deleted in Freshdesk: the candidate disappears; a registered complaint stays, flagged "ticket no longer in Freshdesk".
- Webhook replays: idempotent on ticket id and event time.
- Customer not matched to a client: shown as "unmatched", not registrable until matched.

## 9. Access and safety

- Default deny. The candidate list reuses area `service-state` (view). Registering reuses its manage right. No role is broadened.
- No customer-facing message is produced or sent. No Freshdesk write.
- Synthetic data only in tests.

## 10. Open questions for the owner

- Q1. Does the helpdesk use the tag `complaint` or the ticket type `Complaint`, or neither? What is the agreed way for an agent to mark a complaint?
- Q2. Confirm the severity mapping from Freshdesk priority, and the 24 / 48 / 72 / 120 hour resolution times (they are defaults, not a compliance-approved number).
- Q3. One SLA clock or two (recommended: two, shown separately).
- Q4. Who owns a new complaint by default: the customer's RM, or a named support lead?
- Q5. Who may press "Register as complaint": RMs for their own customers, or managers only?
- Q6. Does compliance need a regulator-facing complaint register (SEBI/SCORES numbering) fed from this? That changes what must be stored.

## 11. Tests to write when it is built

Pure mapping tests (tag, type, priority to candidate and severity), status mapping, replay idempotency, scope tests (an RM never sees another RM's candidate), and a check that no outbound message or Freshdesk write is reachable from this code.
