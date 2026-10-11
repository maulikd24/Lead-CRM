# Customer events, the relationship registry, the canonical timeline and data health

Everything here is off by default and additive. The old behaviour is untouched until a flag is turned on, and every switch has the original code path next to it.

| Flag (exactly `1`) | What it turns on |
|---|---|
| `CUSTOMER_EVENTS_ENABLED` | Writing customer events from the main domain paths, the two cron jobs (`event-consumers`, `data-health`), and everything that reads events |
| `CUSTOMER_TIMELINE_V2` | Customer 360's timeline and the AI client summary read the canonical timeline reader |
| `RELATIONSHIP_REGISTRY_ERASURE` | Client erasure runs its steps from the relationship registry |
| `RELATIONSHIP_REGISTRY_MERGE` | Duplicate-customer merge re-points rows from the relationship registry |

## 1. The principle

`CustomerEvent` is an integration and event **fact layer**. It does not replace any domain table: `Message`, `Task`, `ConsentRecord`, `Position`, `SupportTicket`, `Activity` and the rest stay authoritative. A fact says "this happened" and carries the id of the domain row. Postgres only: no broker, no new service. The architecture is in `architecture/EVENT_TAXONOMY.md` and ADR-2.

## 2. The envelope

One row of `CustomerEvent` per fact, append only:

| Field | Meaning |
|---|---|
| `eventId` | uuid, derived from `(source, dedupeKey)`, so it is stable across retries and a cause can be named without a lookup |
| `eventType` | `domain.entity.action`, lower snake case, past tense, closed list of 13 domains (`lead`, `customer`, `account`, `transaction`, `portfolio`, `whatsapp`, `call`, `ticket`, `complaint`, `campaign`, `referral`, `nba`, `agent`) |
| `occurredAt` / `receivedAt` | when it happened in the world / when we stored it |
| `actorType`, `actorId` | `user`, `system`, `agent`, `customer`, `partner` or `integration`; an id, never a name |
| `clientId` | the customer, a plain id (deliberately not a foreign key: the fact outlives an erasure) |
| `source` | `crm.web`, `whatsapp.worker`, `portfolio.feed`, `crm.device`, `app.signup`, `freshdesk` ... |
| `correlationId` | one id for a whole customer flow (derived from the customer, so every producer agrees); a root event correlates to itself |
| `causationId` | the event that directly caused this one (`lead.assigned` and `lead.contacted` name `lead.created`) |
| `schemaVersion` | per type, starts at 1; readers handle N and N-1 through the registry's upcaster |
| `consentContext` | purpose, status, ledger id, notice version, where the event processes personal data |
| `metadata` | minimal: ids, enums and counts. zod strips any key the schema does not name, so free text cannot be stored by accident |
| `dataClass` | `PUBLIC_AGGREGATE`, `INTERNAL`, `PERSONAL`, `SENSITIVE_PERSONAL` (from the registry) |
| `dedupeKey` | derived from an internal row id; unique with `source` |
| `late`, `clockSkew` | older than 30 days at receipt (stored, flagged, triggers nothing) / source clock ahead of ours |

The typed catalogue is `src/lib/events/registry.ts` (68 types: the whole v1 taxonomy), the envelope helpers are `src/lib/events/envelope.ts`. A test fails when the taxonomy and the registry disagree and when a name breaks the rules.

## 3. emit()

- `emitEvent(input)` runs after a domain write has committed, best effort. `emitEventInTx(tx, input)` is the transactional outbox: the fact commits or rolls back with the caller's domain row.
- It **never throws into the caller**. An invalid, unregistered or unstorable event becomes a status and an `EventEmitFailure` row (personal metadata is not copied into it). Inside a caller's transaction every write is wrapped in a `SAVEPOINT`, so a database error while storing the event does not abort the domain transaction (proved on a real database with an input that Postgres rejects).
- Idempotent by `(source, dedupeKey)`: `INSERT ... ON CONFLICT DO NOTHING`; five concurrent callers store one row.
- Late events are stored in `occurredAt` order, flagged `late`, and never reach a consumer that can send.
- With the flag off it returns at once and touches nothing.
- Producers (`src/lib/events/producers.ts`) are the one place that knows how a domain fact becomes an event. Call sites are one line: `await emitLeadCreated({...})`.

## 4. What is dual-written today

| Site | Event |
|---|---|
| `createClientCore` (manual lead and every inbound path that creates one) | `lead.created`, `lead.assigned`, `campaign.lead.attributed` |
| Reassign and bulk reassign | `lead.assigned` |
| Lead intake: an existing person enquires again | `lead.deduplicated` |
| `recordRmContact` | `lead.contacted` |
| `advanceStage` | `customer.stage.changed` |
| `submitForKyc`, `completeKyc` | `account.kyc.started`, `account.kyc.verified` / `account.kyc.rejected` |
| `updateFunding` (funded status) | `account.funded` |
| `markNotProceeding` | `lead.lost` |
| Support ticket first seen (history sync, webhook, hand-off) | `ticket.created` |
| Conversation extraction and the reply assistant's handover | `complaint.raised` |
| WhatsApp worker ingest (inbound, phone-mirrored) and the outbox result (CRM message confirmed sent) | `whatsapp.message.received`, `whatsapp.message.sent`, `whatsapp.template.sent` |
| Device call sync (inside the sync's own transaction) | `call.logged` |
| Portfolio feed `createTransaction` | `transaction.recorded` (with `first`) |
| Referral claim (inside the claim transaction), referral progress | `referral.attributed`, `referral.qualified` |
| Merge (inside the merge transaction), erasure (inside the erasure transaction) | `customer.merged`, `customer.erased` |

Backlog (not wired): consent granted and withdrawn, goals and reviews, KYC steps, account opened, SIP events, positions, delivery receipts, `lead.qualified`, `lead.speed_to_contact.measured`, the NBA and agent events (they belong to the decision engine and agent registry work), campaign spend, autopilot, a backfill from `Activity`, `StageHistory`, `ConsentRecord` and `OutcomeEvent`, and a reconcile job that counts domain rows against events to show drift. WhatsApp and call events do not yet carry a `consentContext` snapshot (Data health shows a count of the events missing one).

## 5. Consumers

Cursor based, in the existing cron tick, through the control plane's job recorder (`event-consumers`, 60 second budget, idempotent so an Admin can re-run it).

- At least once: a cursor moves only past events the handler finished or that were dead-lettered. Handlers must be idempotent.
- Order is receipt order (`seq`). Events count only once they have settled (received more than 60 seconds ago), so a transaction that commits late can never be skipped by a cursor.
- A failing event stops that consumer on it (order is kept) and is retried next tick; after 5 attempts it moves to `EventDeadLetter` and the cursor goes on. Nothing is dropped silently.
- Replay is a cursor reset. A consumer that can send (`sideEffects: "outbound"`) refuses to run in replay mode and never receives a late event.
- Consumers today: `audit` (a no-op that proves the plumbing and dead-letters unreadable events) and `data-health` (opens a work item for an event whose customer is gone without an erasure record).
- Lag, dead letters and failed emits are shown on the control plane: a tile on Health and a Data health tab.

## 6. The relationship registry

`src/lib/relationships/registry.ts` lists every table that reaches the customer (56 tables: 42 with a direct foreign key, 5 with a plain id column, 9 through another table) and for each one how it is merged, erased, shown on the timeline, and what class of data it holds. It is generated into `docs/customer-relationships.md`.

`registry.test.ts` reads `prisma/schema.prisma` and fails when a table with a customer link is missing, when a declared column or path no longer matches the schema, and when an erase order puts a parent before its child. A new table with a `clientId` therefore fails the build until somebody says how it is merged and erased.

Merge and erasure can be driven from it (`RELATIONSHIP_REGISTRY_MERGE`, `RELATIONSHIP_REGISTRY_ERASURE`). The original code stays (`src/lib/privacy/erasure-legacy.ts`, the original statements in `clients/merge.ts`). Real-database equivalence tests run the same scenario both ways and compare per-table row counts, conflicts, blocker messages and a dump of every table for personal identifiers. The registry describes today's behaviour: tables the merge does not move today say `stay` (a known gap, listed on the Data health tab), not a rule nobody implemented.

Erasure of events: the facts stay (id, type, times, correlation, customer id), their metadata, consent snapshot and customer actor id are nulled and the dedupe key is replaced by a one-way hash. The erasure transaction emits `customer.erased` last.

## 7. getCustomerTimeline

`src/lib/timeline/reader.ts` is the one canonical timeline reader. It composes the domain tables (activities, messages, tasks, tickets, consent changes, stage changes, transactions, outcomes, agent drafts, journeys, complaints and commitments, KYC and funding milestones, goals and reviews, referrals) and, when events are on, the facts that no domain item already stands for. There is no replacement history table.

- Every item has a `sourceRef` (the authoritative record) and an `asOf` time; an item that replaces an older presentation of the same fact lists it in `supersedes`.
- Cursor pagination (`before`), newest first, ties by id.
- Role scoped: only roles that hold `client-360` view may read a customer timeline (Marketing never does) and the customer must be one the viewer may open; anything else is "not found". Read only: it never writes, refreshes intelligence or fires a journey.
- Equivalence: for every seeded customer, every item the old Customer 360 timeline showed is present or explicitly superseded, and everything new comes from a source the old one never read. The AI summary context differs only in its "Recent activity" line.

## 8. Data health

Computed from the registry, the customer tables and the event stream, kept as work items (`DataHealthItem`), shown on the ADMIN only Data health tab of the control plane: events for a customer that no longer exists (and was not erased), customers with no phone or email key, stale intelligence (older than 7 days), unassigned leads (older than a day), impossible lifecycle states (funded without approved KYC, completed without a completion date, a merged customer whose survivor row is gone), two live customers sharing an identity key, rows left on a merged-away customer (a merge miss) and the records the merge does not move (known gaps), events that could not be stored, and events missing a consent snapshot. Findings name a customer by code only. An acknowledged item stays acknowledged while the problem persists, resolves when it is fixed, and reopens if it returns. The sweep runs hourly.

## 9. Runbook

- Turn on: set `CUSTOMER_EVENTS_ENABLED=1`. The first tick after that starts consuming. Watch the Customer events tile on the Health tab (lag should stay under 15 minutes at the 5 minute tick; the architecture's trigger to revisit is sustained lag or more than about 20 events a second).
- A dead letter: Data health tab, Dead-lettered events, Retry. It re-runs that one event through its consumer.
- Replay a consumer: `resetCursor(name)` (`src/lib/events/consumers-db.ts`) then let the tick run. Consumers that can send refuse.
- Roll back: set the flag to anything but `1`. The tables stay; nothing reads or writes them.
- Local proof: `EVENTS_DB_TEST`, `RELATIONSHIPS_DB_TEST`, `TIMELINE_DB_TEST`, `DATAHEALTH_DB_TEST` switch on the real-database suites (each against its own `wt_` scratch database, one file at a time; `npm run ci:db-suites` runs them all on cloned databases).
