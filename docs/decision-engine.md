# Decision Engine v2 (shadow mode)

One service decides "what should happen next for this customer". It runs **in shadow**: it computes and stores a decision for each customer, compares it with the current next best action, and shows it only to the people who review it. It never sends anything and never writes outward. Nothing is deleted: every existing recommendation implementation is now a **candidate generator** behind an adapter.

Code: `src/lib/intelligence/decision/`. Spec: `DECISION_ENGINE_SPEC.md` in the architecture pack.

## Pipeline

```
candidate generators (adapters)  ->  suppression rules  ->  policy and consent gate  ->  rank (heuristic)  ->  explain
```

Pure and deterministic (`engine.ts`): no database, no clock beyond `ctx.now`, no randomness, no model. The database side is `loader.ts` (reads one customer), `shadow.ts` (runs and stores) and `hook.ts` (the single call the refresh job makes).

### Result types
- **RECOMMEND**: one action with owner, channel, timing, reason, evidence and a heuristic score.
- **NO_ACTION**: "Nothing to do right now, because ...", with the evidence. A first-class answer.
- **ABSTAIN**: the engine declines, with a reason code: `do_not_know`, `evidence_conflict`, `data_stale`, `human_review_required` (compliance concern, routed to a manager, no AI draft), `do_not_contact`.

### Candidate generators (all kept, none deleted)
| Source | Implementation it wraps |
|---|---|
| `stage_gate` | `lib/copilot/next-best-action.ts` (what the Today cards show) |
| `intelligence_nba` | `lib/intelligence/nba.ts` v1 (stored in `CustomerIntelligence`) |
| `goal_outcomes` | `lib/outcomes/rules.ts` (keeps its `(ruleKey, fingerprint)` so existing dismissals still apply) |
| `stage_next_action` | `Client.nextActionTitle/DueAt` (stage-engine next action) |
| `agent_proposal` | open `AgentProposal` drafts (owner AI Bot, still need approval) |
| `cross_sell` | `lib/copilot/cross-sell.ts` |
| `disengagement` | `lib/copilot/check-disengagement.ts` (same 5 day threshold) |

The same step proposed by two implementations (v1 and the stage gate both say "complete KYC") is merged into one candidate with combined evidence.

### Suppression rules (`suppression.ts`, `policy.ts`), evaluated before ranking
Open complaint (or one in the last 14 days) blocks everything except service recovery; do-not-contact and consent block a channel; a decline of an asset class blocks it for 30 days (PMS and AIF together); an RM-marked Low acceptance blocks; contact in the last 48 hours delays (Trigger-based, not-before time); a dismissed or snoozed item stays away (same `SuggestionDismissal` store); unreachable twice blocks contact actions and adds a "verify contact details" task; an open exception allows only its resolution; a compliance concern abstains; outside the 24 hour WhatsApp window with no approved template free text is blocked (template or call); a disabled AI agent turns the owner into a person; a confirmed "not interested" stance blocks, an AI-inferred one only ranks lower; a product-registry block stops a product; data older than the freshness policy ranks lower, and past the hard limit cannot be the basis (the engine abstains with `data_stale`). Every suppression is stored with the plain reason.

Consent uses the ledger's own decision function and policy table (`lib/consent`), applied **as if enforcement were on**: a shadow recommendation that enforcement would later block is wrong. Owners can move a purpose to record-only with `CONSENT_RECORD_ONLY_PURPOSES`, no code change.

### Scores
`ENGINE_CONFIG` in `constants.ts` is the one table, with a version. Score = tier base (75/50/20) + bounded bonuses (cap 25) minus penalties (contact within 48 hours, stale data, unconfirmed inference), capped 0 to 100. **Always labelled "heuristic, not a probability".** Confidence is a three-level label from evidence quality (confirmed fact = high, unconfirmed AI inference = low), never a percentage. AI-inferred evidence can only rank a candidate lower or turn it into a question for a person; it never triggers a pitch or a send.

## Storage
`DecisionRecord` (migration `20270520000000_decision_engine_shadow`): decision, evidence, score inputs, suppression, policy result, alternatives, engine version, correlation id (and the previous decision as causation id), the legacy opinion at the time, an input hash (an unchanged customer gets no new row; a replaced open decision expires). `DecisionFeedback`, `DecisionOutcome`, `DecisionDisagreement`, `DecisionReplayRun`. `AgentProposal.nbaDecisionId` (nullable) links a draft to the decision it executes (not written yet: see "Not done"). `DecisionRecord` has a RESTRICT foreign key to `Client`; the erasure transaction deletes it and the rest cascade.

## Feedback and outcomes
Accept (creates a Task for the RM, never sends), Done, Snooze (1 day, 3 days, 1 week), Wrong (a reason from a list), Not now (a date within 90 days), Do not recommend this product (a reason from a list and an expiry, default 180 days). Reasons are lists, never free text, so no customer wording is stored. Each action writes `DecisionFeedback`, updates the decision status, writes a `SuggestionDismissal` for snooze/wrong/not-now/do-not-recommend (so every screen that honours dismissals honours it), an `AuditLog` row, and emits `nba.decision.feedback` through the events seam. `DecisionOutcome` links later events on the same customer (contact, reply, logged outcome, KYC, funding, complaint resolved) to a decision inside a window. **Correlation is not causation** and every screen says so.

## Shadow exit criteria (`exit-criteria.ts`, report: `npm run decision:report` and `/settings/decision-shadow`)
Each is pass, fail or **insufficient data** (never pass on no data):
1. No material suppression regressions (the new engine recommending what the current engine said not to raise): 0.
2. Consent-policy agreement 100%: every recommended contact channel re-checked against the ledger by an independent second implementation (`consent-oracle.ts`) as of the decision time.
3. No serious false-positive product recommendations in sampled review: at least 25 reviewed product decisions, 0 serious (wrong fact, wrong customer, wrong product, or "customer asked").
4. Stable disagreement rate: at least 5 days, daily rate spread at most 10 points.
5. Existing evals and tests pass in the last recorded gate run (`--run-gates`).

Leaving shadow is a decision for a person; the report only shows the evidence.

## Decision replay
`npm run decision:replay` (and the Replay tab) runs the engine over historical snapshots and reports agreement, suppression by rule, abstentions, and what followed (contact, reply) per result. **Limit, printed every time:** event history is cut at the snapshot date, but stage, KYC/funding status, holdings, the manual next action and open exceptions are today's values (the database keeps no history of them). It is a rule regression test on real event history, not a time machine.

## Flags and access
| Name | Kind | What it does |
|---|---|---|
| `NBA_ENGINE_V2` | server | Compute and store decisions in the refresh job. Also needs the `nba_engine` AgentSetting row enabled (kill switch). |
| `NEXT_PUBLIC_DECISION_DRAWER` | build-time | The Evidence Drawer and the admin shadow report. (The Decision review list was removed from Insights on 14 Oct 2026.) |
| `NBA_RM_VISIBLE` | server | RMs see the drawer, and give feedback, on their OWN customers only. |

All default off. Areas: `decision-drawer` (managers and RMs; an RM only for own customers and only with `NBA_RM_VISIBLE`), `decision-review` (managers, admins), `decision-report` (admin only). Never marketing. Not found and not allowed look the same.

## Seams (`seams.ts`)
`CustomerMemorySource` and `ComplaintCommitmentSource` (customer memory and service state), `ProductRegistrySource` (the product and eligibility registry), `DecisionEventSink` (the event bus), `MemoryWriteSink` (customer memory). Each has a default that works from tables that exist today and a documented place to plug the real implementation in.

## Commands
```
npm run decision:seed      # synthetic customers for every situation (local database only)
npm run decision:shadow    # compute shadow decisions now
npm run decision:replay    # replay over historical snapshots
npm run decision:report    # exit criteria, exit code 0 only when all pass (--run-gates records tests and evals)
DECISION_DB_TEST=1 npx vitest run src/lib/intelligence/decision/decision.db.test.ts   # real-database suite
```
