# Wave 2 integration: how the three workstreams fit together

Wave 2 (Decision Engine v2 in shadow, customer memory and service state with household walls, product registry and Attention Engine) was built as three branches and merged onto
the train in this order: memory, attention, decision. This page records the seams that were wired at integration. Each workstream's own design note stays authoritative for its
internals: `customer-memory.md`, `attention-engine.md`, `product-registry.md`, `decision-engine.md`. Everything is behind flags that default off.

## What was wired

| Seam | Where | What it does |
| --- | --- | --- |
| Relationship (FK) registry | `src/lib/relationships/registry.ts` | `CustomerMemoryItem`, `Complaint` (+ `ComplaintEvent`), `Commitment`, `HouseholdRelationshipConsent` and the `Decision*` tables are registered with how each is merged, erased and shown. Household consent names two customers, so it has a merge handler (`household_consent`) and two erase paths. The coverage test fails on an unregistered table. |
| Cron jobs | `lib/system/job-registry.ts`, the tick route | `memory-extraction` (flag `MEMORY_EXTRACTION_ENABLED`), `memory-expiry-sweep` (`NEXT_PUBLIC_MEMORY`), `nba-decision-retention` (`NBA_ENGINE_V2`). All go through the existing `runJob` recorder, same lease and order as before. |
| Memory events | `lib/memory/events.ts`, `lib/events/producers.ts` | `customer.memory.*` are registered and emitted through `emit()` (ids, class and state only). No-op unless `CUSTOMER_EVENTS_ENABLED=1`. |
| Memory extraction model | `lib/memory/model.ts` | One gateway call per customer batch under the purpose `memory.extract` (agent `memory_extractor`, L3 draft only). Consent, kill switches, budget, redaction and the ABSTAIN protocol are the gateway's. Output is always an unconfirmed draft. |
| Decision events | `lib/intelligence/decision/seams-live.ts` | `nba.decision.created|expired|accepted|snoozed|rejected_wrong|not_now|do_not_recommend` and `nba.outcome.linked` go through `emit()`; they mirror `DecisionRecord`. |
| Decision candidates and gate | `decision/integration.ts`, `engine.ts`, `suppression.ts` | Memory do-not-do items and product stances (authoritative only block), open formal complaints and overdue person-confirmed promises (service-recovery candidates), registry `cite()` guard (an unapproved, suspended, retired or example product cannot be recommended; a sale carries the registry ids it cites). |
| Draft to decision link | `decision/link.ts` | `AgentProposal.nbaDecisionId` is written by the nudger and the outcome drafter when there is an open recommendation. |
| Do not recommend | `seams-live.ts` | Also written as a `DO_NOT_DO` memory item, besides the `SuggestionDismissal` other screens honour. |
| Attention feed | `lib/attention/sources.ts` | Stored decisions replace the next-best-action row for that customer; formal complaints and promises replace the conversation insight they were registered from. |
| Registry approvals | `policy/approvals/canonical/adapters/product-registry-change.ts` | Kind `product-registry-change` (mirror action type `PRODUCT_REGISTRY_CHANGE`), four-eyes preserved: the canonical service refuses the author, then the registry's own `decideVersion` refuses them again. Write-through switch `APPROVALS_WT_PRODUCT_REGISTRY`. |
| Households list | `lib/households/privacy/list.ts` | The list obeys the walls (see below). |

## Choices made at integration (defaults)

- **Registry on means a sale needs something to cite.** With `NEXT_PUBLIC_PRODUCT_REGISTRY=1` the engine blocks a product recommendation for an asset class that has no citable registry product (the reason code from `cite()` is shown). With the flag off the engine behaves as before. In production, example products are never citable, so an owner must enter the real catalogue before turning the engine's output on for RMs.
- **Unmappable do-not-do.** A confirmed do-not-do note that names neither an asset class nor a suggestion rule cannot be applied by a machine: sales steps wait for a person to read it; service steps are not held.
- **Shadow decisions stay shadow.** Attention shows stored decisions to managers and admins within scope, and to an RM only with `NBA_RM_VISIBLE=1`.
- **Retention.** Unreviewed shadow decisions 180 days, reviewed ones 24 months (constants in `decision/retention.ts`).
- **Privacy fix.** The Households list no longer shows other members' names or the household-wide AUM to someone who looks after one member. It is unconditional (not behind `HOUSEHOLD_INTELLIGENCE_ENABLED`). The household detail page still applies its walls only when that flag is on: turn it on at go-live, or remove the gate.

## Seam left on purpose: Autopilot rule previews

`simulate()` (src/lib/simulate) is used today by bulk follow-up tasks on the customer list. The Autopilot rule preview was meant to be its second user, but Autopilot is not on the train.
The seam is `simulate(action, targets, now)` with a caller-supplied `SimAction` (and `simulateSequence` for journeys): when Autopilot lands, its rule preview builds a `SimAction` from the rule and calls `simulate()`; nothing in `simulate()` needs to change. Do not duplicate the eligibility or suppression rules in the Autopilot branch.
