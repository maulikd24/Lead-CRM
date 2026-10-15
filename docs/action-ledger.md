# Action Ledger: why did the platform do this?

A **read model**. There is no ledger table and no history table: an entry is assembled on read from the records that already exist, and the source record stays authoritative (every entry and every step links back to it). Spec: Addendum 1 (Action Ledger entry), Wave 1 convention (correlation_id and causation_id), Wave 2 (the reader).

- Reader: `getActionLedger(subject, options)` in `src/lib/ledger/read.ts`. Pure assembly: `assemble.ts`. Heuristics: `heuristics.ts`. Loaders: `load.ts`. Role scoping: `scope.ts`.
- Flags (both default off): `NEXT_PUBLIC_ACTION_LEDGER` (the Why tab on Customer 360 and the read API), `NEXT_PUBLIC_ACTION_LEDGER_INVESTIGATE` (the Admin page; needs the first and the control plane).
- Migration `20270530000000_action_ledger_indexes`: two indexes (`Task(clientId, createdAt)`, `AgentRun(subjectType, subjectId, createdAt)`). No table, no column, no foreign key; a test pins that. The relationship (FK) registry is unaffected: nothing new references Client.

## What an entry answers

action, trigger, decision (engine version, result, what was held back, the consent check), evidence references, initiated by, executed by, AI involvement (agent, version, the autonomy level in force from the registry and any stored row, approval policy, model runs), approved by (or "not required" with the reason), result, follow-on, and a link back to each source record. Kinds: message, draft, decision, task, approval, consent, service (complaints), stage, campaign. Entries are ids, enums, times, staff names and short labels written by our own code: never a message body, a draft body, a conversation text, a phone, an email or a PAN.

## How records are joined, in order of trust

1. **Certain, same action:** an event's `metadata.ref` (or `decisionId`, `recommendationId`), `causation_id` between events, a shared SPECIFIC `correlation_id`, a foreign key (draft to decision via `nbaDecisionId`, draft to message via `messageId`, a task whose `source` is `nba:<decision id>`), the canonical approval's audit row (`entity: "Approval"`) and its write-through copy. **The customer-wide flow id is never a join key:** every producer stamps it on every event of that customer, so joining on it would glue a customer's whole history into one blob (a test and a mutation check pin this).
2. **Certain, follows:** a task that names its complaint (`source: complaint:<id>` or `Complaint.taskId`): two entries, linked, not merged.
3. **Inferred (labelled):** customer plus a time window, in four places, each with a fixed score (a rank, not a probability) and a plain-words reason:

| Heuristic | Window | Score | Effect |
| --- | --- | --- | --- |
| model run to the draft it produced (the draft stores no run id) | run within 10 min before the draft | 0.7 | supporting: labelled on its step, does not lower the entry |
| resolved complaint to a later task (the task names nothing) | task within 24 h after resolution | 0.5 | follow-on of the complaint, trigger of the task: the TASK entry is `inferred` |
| recommendation to an RM message (the message names nothing) | message within 48 h, same channel | 0.4 | the MESSAGE entry is `inferred` |
| stage change to its audit row | same person, within 2 min | 0.6 | supporting |

An entry is `inferred` when its own trigger rests on a heuristic. The fix for each is to write the id at the source (store the run's correlation id on the draft, the complaint id on the follow-up task, the decision id on the message); until then the reader says "inferred", never "certain". Tasks with a known origin (`nba:`, `journey:`, `kyc-step:` ...) are never guessed.

## Role scoping (no rule of its own: it reuses the central ones)

| Viewer | Customer ledger | Decision records inside it | Approvals | Campaign and investigate |
| --- | --- | --- | --- | --- |
| RM | own customers (Customer 360 rule; another RM's customer is "not found", identical to a missing one) | only with `NBA_RM_VISIBLE` (`canSeeDecision`); otherwise left out entirely, and the page says so | kinds the RM requests or approves | no |
| MANAGER | their team (and unassigned leads) | yes | kinds they request or approve | no |
| ADMIN | all | yes | all | investigate by correlation id, customer, agent run or approval |
| MARKETING | none (`forbidden`) | none | marketing kinds only | campaign view: autopilot chains and aggregated counts; a customer is a keyed pseudonym (`P-` plus ten hex characters), no customer record is opened |

Areas in the registry: `action-ledger` (desk), `action-ledger-campaigns` (marketing), `action-ledger-investigate` (admin only, 404 for everyone else on the API). Three API routes and one page each have a policy entry; three loader surfaces are declared.

## Screens

- **Why tab** on Customer 360 (after Timeline): kind filters with counts (instant, local), a row per action (certain or inferred, AI or not, who approved, the result), each opening to the answers and the chain Trigger, Decision, Approval, Execution, Result, Follow-on. On a phone three rows show and "View all" opens the shared bottom sheet. "Show older actions" pages through the read API. Native `<details>`, no animation.
- **Investigate an action** (`/settings/control-plane/investigate`, ADMIN only): one tab per search (correlation id, customer, agent run, approval), a plain GET form, the chains found and how the answer was built (statements issued, rows read).
- **API:** `GET /api/action-ledger?clientId=&kind=&limit=&before=`, `/api/action-ledger/campaigns`, `/api/action-ledger/investigate?by=&q=`. No cache; strict parsing.

## Cost

Per page: at most 20 bounded statements (12 + 6 + 2: events, decisions with feedback and outcomes, drafts, outbound messages, tasks, consents, complaints with their events and stage changes; then runs by correlation id and by subject, approvals by customer and by correlation id, audit rows, the inbound messages the outcomes name; then staff names and stored autonomy levels). Each is bounded by `take` (limit x 2 + 20, capped at 300) and uses an index: `CustomerEvent(clientId, occurredAt)` and `(correlationId)`, `DecisionRecord(clientId, createdAt)`, `AgentProposal(clientId, createdAt)`, `Message(clientId, createdAt)`, `Task(clientId, createdAt)` and `AgentRun(subjectType, subjectId, createdAt)` (new), `Complaint(clientId, status)`, `ConsentRecord(clientId, ...)`, `StageHistory(clientId, changedAt)`, `ApprovalRequest(entity, entityId)` and `(correlationId)`, `AgentRun(correlationId)`, `AuditLog(entity, entityId)`. The real-database suite pins the statement count (a customer with 400 tasks costs the same as one with a few) and asserts the planner picks the new indexes.

## Not done (on purpose)

- Writing the missing ids at the source (the three fixes above). Each is an additive column or a convention change on a legacy path and needs the owner's go.
- Autopilot is not on this train: its approvals show through the generic `ApprovalRequest` and the `campaign.autopilot.*` events, joined on correlation id; the Autopilot branch's own tables are not read.
- `complaint.*` events are not emitted from the formal `Complaint` model yet, so complaint entries come from the `Complaint` rows (and the `complaint.raised` event for the conversation path).
- No materialised or cached ledger: measure on the 777k-row rehearsal database before deciding one is needed.
