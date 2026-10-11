# Customer memory, service state and household privacy walls

Wave 2, workstream B. Everything here is behind flags that default OFF, is additive (one migration, `20270480000000_w2b_memory_service_households`) and sits next to the tables it builds on: nothing is copied from `SupportTicket`, `Task`, `ConversationInsight` or the calls data; the new tables link to them by id.

## Flags

| Flag | Kind | What it turns on |
| --- | --- | --- |
| `NEXT_PUBLIC_MEMORY` | build | The **Memory** tab on Customer 360 and the consent-withdrawal hook. |
| `NEXT_PUBLIC_SERVICE_STATE` | build | The **Service** tab and header strip on Customer 360, the `/service` list and its nav item. |
| `HOUSEHOLD_INTELLIGENCE_ENABLED` | run | The household view and relationship consent on `/households/[id]`, and the wall on that page's holdings. |
| `MEMORY_EXTRACTION_ENABLED` | run | Lets "Suggest from conversations" also read insight text through the AI provider (needs consent enforcement, an AI key and the AI pilot sign-off). Without it, suggestions come from a deterministic mapping and no model is called. |

The registry (`src/lib/flags/registry.ts`) and `docs/feature-flags.md` carry the rules; `npm run flags:check` passes.

## 1. Memory items

`CustomerMemoryItem` (class, key, value, source, evidence, confidence, observed-at, fresh-until, confirmation, consent basis, data class). Classes: fact, preference, interest, objection, commitment, goal, sentiment, product stance, service context, do-not-do.

States: **UNCONFIRMED**, **CONFIRMED**, **DISPUTED**, **REJECTED**, **EXPIRED**, **SUPERSEDED**. Rules live in `src/lib/memory/rules.ts` (pure) and every one has a test and a deliberate-break check:

- **R1** An AI-derived item (`conversation_ai`, `call_ai`) is born UNCONFIRMED, confidence at most medium, and never promotes itself. Only a named person (confirm) or a system of record moves it to CONFIRMED. Sentiment is never confirmable.
- **R2** No evidence, no item. Evidence is a short redacted summary plus a source ref; the ref must resolve to a row that belongs to the *same* customer.
- **R4** Freshness windows by class (fact 365 days, preference 180, interest 60, objection 60, sentiment 30, product stance 30; commitments until due; goals, do-not-do and service context set elsewhere). Past `freshUntil` an item reads as EXPIRED everywhere, whether or not the sweep has run.
- **R5** No health, religion, caste, sexual orientation or politics, from anyone. Vulnerability only from an RM.
- **R6** Chat-derived items need `AI_PROCESSING_OF_CHATS`, call-derived `CALL_RECORDING`, checked against the consent ledger at derivation time and recorded as the item's consent basis. On withdrawal (the consent ledger append triggers it) UNCONFIRMED derived items expire; a CONFIRMED one stays only if independently supported (an RM note, a document, a goal or a ledger entry stands behind it). Reads exclude the withdrawn basis at once, before any sweep.
- **R7** Reject needs a reason and stops the AI re-deriving the same key and value for 90 days. Edit creates a SUPERSEDED chain.
- **Conflicts (the DISPUTED rule)** A new item whose value disagrees with a live item for the same key is stored as a new **DISPUTED** item beside the old one; no value is ever overwritten. An AI writer cannot dispute a CONFIRMED item (a guess must not pause a person's fact); a human writer disputes every live item it disagrees with. A person settles a dispute by confirming one, which supersedes the rest. After a customer merge, items that now disagree are disputed the same way.
- **What each state may influence (R3)** CONFIRMED can block or drive; UNCONFIRMED may only downrank, hint or become a question for a person; DISPUTED influences nothing, except a do-not-do, which keeps blocking (when in doubt, do not).

Audit: every create, confirm, reject, dispute, supersede and expire writes an `AuditLog` row with ids and states only (never the value or the evidence). `src/lib/memory/events.ts` is the seam for `customer.memory.*` events: allvest/w1-events is not on this branch, so call `setMemoryEventSink(emit)` once at integration.

### Reading it

- `getCustomerMemory(viewer, clientId)` (panel): authorised inside (registry area `customer-memory`, then the customer's record scope: an RM sees own customers, a manager the team, an admin all, MARKETING and every other role nothing).
- `getMemoryForDecisions(clientId)` (other modules): `{ authoritative, advisory, contested, doNotDo, asOf }`, no evidence, no source text. The caller has already authorised the customer.
- `assessFreshness`, `isStale`, `ageLabel` in `src/lib/freshness/stale.ts` are the one as-of / stale helper for every module.

### Extraction (draft only)

`src/lib/memory/propose.ts`: `proposalsFromInsights` maps existing conversation insights to items (deterministic, no model). `refineWithModel` asks a model to find preferences, facts, goals and do-not-do requests in insight text; every item must quote its note verbatim (checked against the exact text the model saw, which is first scrubbed of numbers, emails and PAN-shaped codes) or it is dropped. The model goes through the `MemoryModel` seam (an `LlmProvider` today, the admin-saved pilot key). **allvest/w1-ai-gateway is not on this branch: at integration replace the seam with `callModel()` (purpose `memory_extraction`).** Evals: `src/lib/agents/evals/cases/memory.ts` (invented quotes, sensitive topics, wrong provenance, vendor payload).

## 2. Complaints and commitments

`Complaint` (severity, status OPEN / IN_PROGRESS / RESOLVED / REOPENED / CLOSED, owner, SLA clock, acknowledgement, resolution, reopen count) with `ComplaintEvent` history; `Commitment` (who promised what to whom by when; status OPEN / KEPT / BROKEN / CANCELLED; overdue is derived, never stored). Both link to the ticket, insight, call review and task they came from by id. Registering one creates a Task for the owner due at the SLA deadline; resolving or keeping it closes the task.

Defaults (owner questions in the report): resolve within 24 / 48 / 72 / 120 hours for critical / high / medium / low; acknowledge within 24 hours; reopen for 30 days after resolution (the clock restarts). A commitment read from a conversation is only **suggested**: it is not counted as late until a person accepts it, and one with no stated date is not created (no invented deadline).

Reading: `getServiceState` (Customer 360 strip and tab), `getServiceQueue` (the `/service` list: open complaints, missed deadlines first, and overdue accepted promises, scoped like customers), `getServiceFacts` / `getServiceFactsMany` (counts and highest severity with an as-of, for the decision engine and the attention engine; no titles or names).

## 3. Households and privacy walls

`src/lib/households/privacy/policy.ts` is the explicit policy table. Default deny: for a member who is another RM's customer, **only that the relationship exists** is visible. Relationship type, name and code, portfolio size band, and service counts need that member's relationship-level consent (`HouseholdRelationshipConsent`, a ledger: the newest row per grantee is the current statement; a withdrawal, expiry or future date closes it). The member's memory and contact details **never** cross the wall, whatever a consent row says. Roles outside ADMIN, MANAGER and RM see nothing.

`loadHouseholdSummary` (ADMIN and MANAGER) decides every facet before it queries and only fetches data for the facets it allows; a hidden member's id, name, relationship and amounts are not in the output. Consented members show a band, never the exact amount, and are left out of the household total. `loadHouseholdContext` is what an RM sees on a customer: the relationship, how many other members, and the ones that are already theirs. `recordRelationshipConsent` needs the recorder to be able to open the *subject* member.

With `HOUSEHOLD_INTELLIGENCE_ENABLED` the existing `/households/[id]` page also stops showing other members' holdings, transactions and names to a viewer who only has one member in scope.

## Erasure and merge

Every new table with a Client foreign key is deleted in the erasure transaction (both sides of household consent) and re-pointed by the merge flow; the real-DB erasure test seeds each of them with the probe identifiers and dumps every table. `src/lib/privacy/w2b-client-tables.ts` is the seam for the FK registry until allvest/w1-events lands: `w2b-client-tables.test.ts` fails if a table with a Client foreign key appears in the migration without a row there, or a listed table is missing from the erasure or the merge code.

## Tests

Pure: `rules.test.ts`, `view.test.ts`, `propose.test.ts`, `access.test.ts`, `merge.test.ts`, `service/rules.test.ts`, `service/view.test.ts`, `households/privacy/policy.test.ts`, `summary.test.ts`, `freshness/stale.test.ts`. Real database (one file at a time, switches `MEMORY_DB_TEST`, `SERVICE_DB_TEST`, `HOUSEHOLD_DB_TEST`, `ERASURE_DB_TEST`): `memory/store.db.test.ts`, `loaders.db.test.ts`, `merge.db.test.ts`, `service/service.db.test.ts`, `households/privacy/privacy.db.test.ts`, `privacy/erasure-pii.db.test.ts`.

## Not built

See `reports/w2-memory-report.md`: no NBA integration (the read APIs are ready), no cron wiring for the extraction batch or the expiry sweep, no RM-side consent form on Customer 360, no Cmd+K search of memory.
