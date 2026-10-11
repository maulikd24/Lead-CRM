# Attention Engine v1 and simulate()

Wave 2, workstream C. Flags: `NEXT_PUBLIC_ATTENTION_ENGINE` (the feed) and `NEXT_PUBLIC_SIMULATE` (the bulk preview), both default off and build-time. Code: `src/lib/attention/`, `src/lib/simulate/`.

## The feed

A ranked list of everything a person could do now, with the reason for each position. It is a **read model**: nothing is stored except a person's own dismiss or snooze. It sits on Today (and the full dashboard) as a "Needs attention" tab, behind the flag. With the flag off the existing tabs, including the outcomes "Needs attention" tab, are exactly as they were. With both flags on the older tab is relabelled "Goals at risk".

### Kinds (from Addendum 1)

customer opportunity, complaint (also compliance concern, as a sub-kind), overdue commitment, KYC blocker, hot lead, approval, failed integration, campaign anomaly, data-quality issue, agent failure, portfolio risk, task. `portfolio_risk` is defined and ranked but has no source yet (see below).

### The score, and what it is not

`score = 100 x importance x urgency x confidence x customer value x risk x time decay`, each factor in (0, 1] and raised to a weight (all 1 in v1). The table of levels and weights is one file, `constants.ts`, with a version (`attn-v1`). It is a **heuristic**, labelled "not a probability" everywhere. Nothing is learned or fitted; the values are judgement. Every item carries a `why`: the six factors with their readings, the formula and the version, shown in the detail panel.

- Importance, urgency and risk are levels 1 to 5 set by the source's mapper (`mappers.ts`), for example urgency rises with the age of a complaint or the days a task is overdue.
- Confidence is low, medium or high. An item inferred by AI and not confirmed by a person is multiplied down further: it can only ever be lowered, never lifted, and it never triggers a send.
- Customer value is a heuristic band on the customer's largest open opportunity (unknown is neutral).
- Time decay applies to kinds where staleness lowers value (opportunity, hot lead, campaign anomaly, data quality, portfolio risk). Overdue things do not decay: urgency carries them.

### Hard overrides

`critical_incident` (a CRITICAL control-plane alert), then `compliance`, then `complaint`, outrank any score, in that order; inside one tier the score decides. A complaint with the lowest possible score is above the highest-scoring task. An override item can never be dismissed and can be snoozed for 24 hours at most, with a reason, and is never pushed to "later" by capacity.

### Role scoping (default deny, enforced twice)

| Role | Sees |
| --- | --- |
| RM | own customers' items and own tasks |
| MANAGER | the team's customer items and data quality (approvals join when the one approvals inbox opens to managers) |
| ADMIN | everything, including system items: failed integrations, agent failures, critical alerts, approvals, unowned customers |
| MARKETING | campaign anomalies only, on `/marketing/needs-attention` |
| any other role | nothing |

The allowed kinds per role are one table (`ROLE_KINDS`); the sources only run for kinds the role may see, and the ranker filters again by kind and by owner. Tests drive each layer separately (the DB suite calls the sources directly). Item text never copies a conversation, ticket or message: titles are built from the kind, the customer's name and an age.

Customer-side code may not import the marketing module (the loader-segregation test enforces it), so the campaign-anomaly source is handed in by the Marketing page (`ExtraSource`). Consequence: an Admin sees campaign anomalies on the Marketing page, not on Today.

### Capacity, per RM

`openWorkload` is the person's pending plus overdue tasks. The "now" lane holds as many items as can realistically be worked before the working day ends (about 1.5 an hour from the current time, Monday to Saturday 09:00 to 18:00 IST, shorter outside hours), minus one slot per 5 open tasks, between 1 and 12. The rest is "later". At 25 or more open tasks an RM is flagged overloaded, and managers and admins see it above the list. Working hours are a constant for now (see owner questions).

### Dismiss and snooze

Snooze (1 hour to 14 days) or dismiss an item for yourself only. The item must be in your own feed at that moment, so a made-up or someone else's id does nothing. Both write an `AttentionDismissal` row and an `AuditLog` row (`attention.dismissed`, `attention.snoozed`, `attention.restored`). A snoozed item returns on its own.

### Sources and seams

Sources are read-only and capped (`sources.ts`): conversation insights (complaints, compliance concerns, overdue commitments), open exceptions (KYC blockers), high-priority leads with no contact, open opportunities, next-best-action rows, tasks, control-plane failures and alerts, pending approvals, duplicates and unowned customers, and (Marketing page) campaign anomalies from aggregate daily ad numbers. A failing source is reported in the panel and skipped.

- **Decision Engine seam**: `decisionCandidates` in `sources.ts` is the one function that reads decision candidates. It reads the next-best-action row on `CustomerIntelligence` today; when `DecisionRecord` ships, replace that function only.
- **Approvals seam**: the approvals source reads `ApprovalRequest` directly; at integration it reads the canonical approvals inbox.
- **Action Ledger**: dismissals and snoozes are audit rows keyed by item id, ready to be joined on correlation id later.

## simulate()

`simulate(action, targets, now)` is a pure dry run: who is eligible (with the channel each would get), who is suppressed and every reason, the channel split, and the estimated AI calls and cost. Reasons: do not contact, no consent for the purpose (per channel, using the same ledger decision as live sends, applied as if enforced even when the environment says it is not), open complaint (sales only), compliance concern, contacted recently, contact limit reached, no usable channel. The AI cost uses an assumed planning rate and says so.

- **First use**: bulk follow-up tasks on the customer list. Select customers, "Follow-up tasks", Preview, then Create. Create re-runs the preview on the server, makes tasks only for the eligible, assigns each to the customer's own RM, never doubles an open task, and writes an audit row. Scope: only customers the viewer may see.
- **Journeys**: `simulateSequence(steps, targets, now)` takes an ordered list of `SimAction`s and returns one result per step plus the total estimate. A journey step only has to describe itself as a `SimAction` to be previewable. Carry-over between steps ("only those who did not reply") needs outcomes and arrives with the journey builder.
- **Rules**: Autopilot-style rule previews can call `simulate` with their own `SimAction` the same way.

## Not built yet

Per-person working hours, portfolio-risk and goal-risk sources, a "restore dismissed" list in the UI (the service exists), manager-visible approvals, feedback on the ranking (was this useful), and weights tuned against outcomes (needs the Decision Engine's outcome data).
