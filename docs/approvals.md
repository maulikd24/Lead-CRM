# Approvals: one service, one inbox, every legacy path left authoritative

Status: built behind flags, all off by default. Code: `src/lib/policy/approvals/canonical/` (contract, definitions, service, adapters, wiring), screen `src/app/(dashboard)/approvals/`, list route `src/app/api/approvals/route.ts`.

Principle: there is ONE approval service (`src/lib/policy/approvals`, ADR-3). It does not replace the eight places where approvals already happen. Each of them keeps its own table, its own rules and its own tests, and is exposed through an **adapter**. The adapter reads the legacy record into a canonical view (read-through) and, when a person decides in the inbox, calls the **existing legacy function unchanged** (so every compare-and-set, four-eyes rule and audit write keeps working). Nothing is approved automatically.

## 1. Every approval path today

"Approver rule" is what the legacy code enforces; "four-eyes" means the person who made it may not approve it.

| # | Path | Record and states | Who asks | Who may approve (legacy rule) | Four-eyes | Expiry | Audit today | Side effect on approve |
|---|------|-------------------|----------|-------------------------------|-----------|--------|-------------|------------------------|
| 1 | **Agent drafts** (`wa_nudger`, `outcomes_review`) | `AgentProposal`: DRAFT, APPROVED, SENT, REJECTED, EXPIRED, BLOCKED | An agent (no human) | Admin, or the RM the customer is assigned to. Managers are view-only (`agents/decide.ts`) | none (the author is an agent) | row `expiresAt`; refused and set EXPIRED, also checked inside the claim | decider id and time on the row; guardrail verdict in `blockedReason` | Claim DRAFT to APPROVED atomically with the expiry check, queue the WhatsApp message, then SENT. A failed send releases the claim. Exactly one send under a race. |
| 2 | **Social posts** | `SocialPost.status`: DRAFT, NEEDS_REVIEW, APPROVED, SCHEDULED; `SocialPostEvent` rows | Admin or Marketing | Admin or Marketing (`canAccessMarketing`) | yes for staff posts; an AI draft has no human author, so its requester may approve | none | `SocialPostEvent` per step, `approvedById/At` | Compliance re-checked at the gate, reviewer must tick "I have read it"; approval is only a recorded intent: nothing is ever published |
| 3 | **Referral reward statements** | `RewardStatement`: PREPARED, APPROVED, PAID | Admin or Finance (prepares) | Admin or Finance | yes (preparer cannot approve) | none | `RewardLedgerEntry` rows (APPROVED, PAID_MARKED) in the same transaction | One compare-and-set PREPARED to APPROVED that writes the ledger rows; refused if a line changed since preparing. "Paid" is a separate step that only records a bank reference. No reject: prepare again |
| 4 | **Partner payout runs** | `PayoutRun.status` DRAFT, PENDING_APPROVAL, APPROVED, FINALIZED, plus an `ApprovalRequest` (`PAYOUT_ADJUSTMENT`) | Admin or Finance | Admin only | yes (maker is not checker) | none (column exists, unused) | `ApprovalRequest` (requester, decider, time, note, `appliedAt`) | Hold rules run first (suspended partner, unverified bank; Admin may override with a typed reason); claim PENDING to APPROVED, then apply the run |
| 5 | **Commission adjustments** | `ApprovalRequest` `COMMISSION_ADJUSTMENT` | Admin or Finance | Admin | yes | none | as above | Creates the adjustment row and updates the payout totals |
| 6 | **Partner tax and override rules** | `ApprovalRequest` `PARTNER_TAX_RULE_CHANGE`, `PARTNER_OVERRIDE_RULE_CHANGE` | Admin or Finance | Admin or Finance | yes (service and store both check) | none | as above | Pre-check re-validates against today's rules; apply writes the rule |
| 7 | **Stage corrections** | `ApprovalRequest` `STAGE_OVERRIDE` | Manager | Admin | yes | none | as above | `correctStage()` |
| 7b | **Customer number changes** | `ApprovalRequest` `CLIENT_MOBILE_CHANGE` | RM or Manager (asks from the client page) | Admin | yes | none | as above | Apply writes the new number and a masked audit row. The inbox shows the customer and the old and new number masked, never the raw number |
| 8 | **Erasure requests** | `ErasureRequest` (PENDING, APPROVED, COMPLETED) + `ApprovalRequest` `ERASURE_REQUEST` (one thing, two records) | Admin or Finance | Admin | yes | none | as above | Approval only marks the request APPROVED; deleting the data is a separate Admin action |
| 9 | **Duplicate-customer merges** | `MergeSuggestion`: OPEN, MERGED, DISMISSED | A job (suggestions) | Admin, Manager, or an RM who owns BOTH customers (a pair with only one of theirs is "restricted": they can only ask a manager) | none | none | `AuditLog` merge/dismiss rows in the same transaction | MERGE is irreversible: needs a chosen survivor and an explicit confirmation, rate limited. DISMISS is a compare-and-set |
| 10 | **AI-pilot sign-off** | `AiPilotSignoff` (immutable rows; revoke sets `revokedAt`) | A job (people listed for the pilot) | Admin | **four-eyes since Wave 1** (a compliance reviewer, then a different Admin; before, one Admin signed alone) | none | `AuditLog` (`pilot_signoff_recorded`) | Records who, when and the exact wording version; a new wording needs a new sign-off |
| 11 | **Autopilot** (sibling branch, not on the train) | `AutopilotRecommendation` + `AutopilotDecision` | A job | Admin, Marketing (branch) | none | none | `AuditLog` | Ad changes (blocked from applying in the branch today) |
| 12 | **New lead first message** (campaign attribution, Wave 3) | `AgentProposal` with agent `lead_first_message` (the same rows as agent drafts) | A job (the lead push), a fixed template, never a model | Admin, or the RM the lead is assigned to | none | consent (marketing messages, WhatsApp) and the outbound guardrails, rechecked at send | `AuditLog` (`agent.proposal.decide`) | One message to the customer, sent by the unchanged compare-and-set in `agents/decide.ts` |
| 13 | **Creative variants** (sibling branch, not on the train) | not on the train | | | | | | |

Facts found while reading, relevant to the next steps:
- `ErasureRequest` is registered as an `ApprovalRequest` definition AND has its own status: two records for one decision. The adapter reads the `ApprovalRequest` (the thing that is decided).
- `ApprovalRequest.expiresAt` existed but nothing enforced it. It is now enforced (section 4).
- `ApprovalRequest.requestedById` is required, so a request made by a job or an agent cannot be written to it without naming a user (see write-through, section 5).
- The Agents page, the Finance console, Approval workflows (Settings) and Partner finance each list a slice of these. They keep working and are untouched.

## 2. The canonical contract

One shape for every kind (`canonical/contract.ts`, `definitions.ts`).

**Definition** (one per kind): `kind`, `label`, `group` (customer, marketing, finance, admin), `subjectType`, `requesterRoles` (or "system"), `approverRoles`, `fourEyes`, `expiry` (none, row, or a TTL), `requiredEvidence` (keys the view must carry before an approval is offered in place), `preconditions` (consent or named policy), `autonomy` (level and the three facts the ceilings depend on), `autoApprove: "never"` (a literal type: an auto-approval cannot be declared), `supports` (approve, reject), `approveNeeds` (a tick or a choice), `inlineApprove`, `adapter` (native, read-through or seam), `writeThroughFlag`.

**Canonical states** (`state.ts`): `requested`, `approved`, `rejected`, `expired`, `executed`, `failed`, `cancelled`. Legal moves: requested to approved, rejected, expired, cancelled; approved to executed or failed; failed back to approved (a released claim can be retried). A request past its expiry reads as `expired` without rewriting a decision already made.

**View** (`CanonicalApproval`): `ref` (`kind:id`), `subject` (type, id, label, link), `state` and the legacy state word, `summary`, `requestedBy`, `requestedAt`, `approver`, `decidedAt`, **`decisionReason`**, `expiresAt`, `evidence` (label and plain value, no contact detail), **`correlationId`** and **`causationId`**, `autonomy`, `fourEyesAuthorId`, `clientId` (for the consent precondition).

**Correlation.** Until a request carries ids of its own, the chain is anchored on the record: `approval:<kind>:<id>`. New generic requests may pass `correlationId`, `causationId`, `autonomyLevel`, `expiresAt` (additive, optional, nullable columns: migration `20270435000000_approval_canonical_fields`).

**Decision flow** (`service.ts`, pure, tested without a database), in order: only a signed-in person (an `agent:` or `system` id is refused) > the kind exists and has an adapter > the role may approve this kind > the item is visible to this person (an invisible item looks exactly like a missing one) > expired? the expiry is recorded the way the legacy path records it and nothing runs > already decided > reject/approve supported > four-eyes > a reject needs a reason > for an approval: evidence present, done in place (an irreversible approval opens the item instead), ticks done, consent precondition > **call the legacy path through the adapter** > write one audit row (`entity: Approval`, who, reason, kind, state, correlation, causation, autonomy) > optional write-through record. A failure in the legacy path is returned untouched and writes nothing.

**Autonomy ladder** (`autonomy.ts`), owner-confirmed ceilings enforced when the registry loads and again by tests: a customer-facing action is L3 (draft) or L4 (execute after a human approves) only; an ad spend change is L4 at most; L5 is only for internal, reversible, non-customer, non-spend actions, and no approval definition is L5 (an approval exists because a human decides). Agent drafts are L4, social posts L3 (nothing executes), Autopilot actions L4 with `adSpend`.

**No auto-approval.** There is no code path that approves without a person; `autoApprove` can only be `"never"`.

## 3. Adapters

| Kind | Legacy path it calls | Approve | Reject | Notes |
|------|----------------------|---------|--------|-------|
| `agent-proposal` | `approveProposal` / `rejectProposal` (`agents/decide.ts`) | in place | in place | The claim, expiry-in-claim, send and release are the legacy code. Preconditions: consent for WhatsApp marketing messages when enforcement is on (stricter than the legacy approve, never looser) |
| `social-post` | social service `transition("approve" / "request_changes")` | in place, with the reader's tick | request changes, with the note | Visible to Admin and Marketing only |
| `planner-plan` | planner `transitionPlan("approve" / "request_changes")` (checklist re-run at the gate: promise guardrails, live destination, tested links, routing owner, consent purpose, approved copy, registered creator, product claims cite the registry) | in place, with the reader's tick | request changes, with the note | Admin and Marketing only; four-eyes (the drafter cannot approve); write-through flag `APPROVALS_WT_PLANNER_PLAN` |
| `referral-statement` | `approveStatement` | in place | not supported (legacy has none) | Visible to Admin and Finance, and only while the referral programme is on |
| `merge-suggestion` | `decideMerge` / `decideDismiss` | not in place: opens the pair (irreversible; needs a survivor and a confirmation) | dismiss, in place | An RM sees only pairs they own both sides of |
| `ai-pilot-signoff` | `recordSignoff` | in place, with the acknowledgement; two signatures by two different people, only the second unlocks the pilot | not supported (revoking is a separate act) | The handle is the wording version, so an old wording can never be signed |
| `payout-run`, `commission-adjustment`, `erasure-request`, `partner-tax-rule`, `partner-override-rule`, `stage-override`, `client-mobile-change` | `decideApproval` (generic service) | in place | in place | Native: the record already is an `ApprovalRequest`. The roles in the canonical definitions are pinned to the generic registry by `native-pin.test.ts` |
| `lead-push-draft` | `approveProposal` / `rejectProposal` (the same code as `agent-proposal`) | in place | in place | Same rows as `agent-proposal`, listed under its own kind (no row is listed under both). Admin and the assigned RM only; Marketing and managers never see it. Write-through flag `APPROVALS_WT_LEAD_PUSH_DRAFT` |
| `ad-creative` | creative service `transition("approve" / "request_changes")` (compliance re-run on the saved text, compare-and-set) | in place, with the reader's tick | request changes, with the note | A read-through adapter over `CreativeVariant`, Admin and Marketing only. Four eyes follow the approval setting (default on; an AI draft has no author). Write-through flag `APPROVALS_WT_AD_CREATIVE` |
| `director-report` | `decideShare` (a report link: approve opens it, decline revokes it with a reason), `approveDigest` / `discardDigest` (the weekly digest draft) | in place, with the reader's tick | decline or discard, with a reason | Two legacy rows under one kind, told apart by the id prefix (`share:`, `digest:`). A link opens nothing until approved. Four eyes for links follow the approval setting (default off). Write-through flag `APPROVALS_WT_DIRECTOR_REPORT` |
| `autopilot-action` | `AutopilotRecommendation` (+ `AutopilotDecision`) | `lib/autopilot/decisions.ts` (compare-and-set on the row; apply is a second explicit human act with its own database claim) | ADMIN, MARKETING | **Wave 3 adapter** (`adapters/autopilot-action.ts`): L4 ad spend, four-eyes optional per Settings (the author of a rule cannot approve what it proposed), expiry on the row, flag `APPROVALS_WT_AUTOPILOT_ACTION`. Approving never touches an ad account |

**The seam for a sibling-branch adapter.** Implement `ApprovalAdapter` (`listAwaiting`, `listRequestedBy`, `get`, `decide`, optional `expire`), calling that branch's own decide function unchanged, add it to `prismaAdapters()` in `canonical/wiring.ts`, and flip the definition from `seam` to `read-through` with a write-through flag. The branch's decision tables stay authoritative. The segregation, evidence and four-eyes rules come from the definition.

**Equivalence proof.** Per adapter, a unit test runs the same scenario on two identical in-memory worlds, one through the legacy function and one through the canonical service, and compares the stored result: approve, reject, self-approval refused, expiry, the double-approve race, and for agent drafts the order `claim (atomic with the expiry check)`, `send`, `SENT`. `equivalence.db.test.ts` does the same on the real stores in a real database (agent drafts, social posts, referral statements, merge suggestions, AI pilot, payout runs, erasure), and checks scoping by role and write-through on and off. Switch: `APPROVALS_DB_TEST=1` (listed in `ci/db-suites.json`).

## 4. Expiry

Legacy agent drafts already expire. For the generic `ApprovalRequest`, `decideApproval` now refuses a request past its `expiresAt`, marks it `EXPIRED` with a compare-and-set, and applies nothing. A request with no expiry (all of them today) behaves exactly as before. No definition forces a TTL: adding one is a per-kind owner decision.

## 5. Write-through (default off, one switch per adapter)

Read-through is always on once the inbox is on: the view is derived from the legacy row. **Write-through** is optional and per adapter over a legacy table: `APPROVALS_WT_AGENT_PROPOSAL`, `_LEAD_PUSH_DRAFT`, `_SOCIAL_POST`, `_REFERRAL_STATEMENT`, `_MERGE_SUGGESTION`, `_AI_PILOT_SIGNOFF`. With a switch on, a decision made through the canonical service ALSO writes one **decided** `ApprovalRequest` row (never pending, so no queue shows it and `decideApproval` refuses it) carrying approver, time, the reason, correlation and causation ids and the autonomy level. The legacy row is never changed by it, and a failure to write it never changes the decision's outcome. Native kinds have no write-through flag: their record already is the canonical one.

Limits, stated plainly: decisions made on the legacy screens (for example the Agents page) are not mirrored; and because `requestedById` is required, a request made by a job or an agent records the decider there, with `payload.requester = "system"` saying so. The legacy row remains the source for who really asked.

## 6. Access

- Central registry (`src/lib/access/policy.ts`): area `approvals` (group "self"; view and manage for Manager, RM, Finance, Marketing; Admin as always). `surfaces.ts` declares the page `/approvals`, the API route `/api/approvals` and the action file. The default-deny coverage test, the generated matrix test and the e2e access matrix cover them.
- Per kind, `definitions.ts`: **an approver sees only the kinds they may approve**; someone who may request but not approve a kind sees only their own requests (Finance's payout runs, a Manager's stage corrections); **MARKETING sees only marketing kinds** and no marketing kind is visible to any other role (a test pins both); roles with no approval role (Dealer, Partner, Affiliate, Distributor, Team manager) see nothing. An RM sees only drafts for their own customers and only duplicate pairs they own both sides of.
- Item-level scope comes from the legacy path's own rule, applied again by the adapter, and the service answers "not found" for anything the person may not see.

## 7. The inbox

`/approvals` (and `GET /api/approvals?tab=awaiting|mine&kind=`). A workspace (shared primitives, master-detail, density rules, motion 300 ms or less, once, off under reduced motion): a header with three figures, tabs "Awaiting you" and (for anyone who can ask for something) "Your requests", a one-line kind filter, a list and the detail beside it. The detail shows the evidence, who asked and when, expiry, the autonomy statement, the reason when decided, and the controls: Approve (in place when it is reversible, otherwise a link to the item), Reject with a required reason, the reader's tick where the kind needs one, and a link to the subject. Keys: A approve, R reason, O open, Up and Down move. Empty state included.

## 8. Flags

| Flag | Default | Does |
|------|---------|------|
| `APPROVALS_INBOX_ENABLED` | off | The inbox page, its nav item, its action and the list route |
| `APPROVALS_WT_AGENT_PROPOSAL`, `APPROVALS_WT_LEAD_PUSH_DRAFT`, `APPROVALS_WT_SOCIAL_POST`, `APPROVALS_WT_REFERRAL_STATEMENT`, `APPROVALS_WT_MERGE_SUGGESTION`, `APPROVALS_WT_AI_PILOT_SIGNOFF` | off | Per-adapter write-through record (section 5) |
| `APPROVALS_DB_TEST` | off | Runs the real-database approvals suite (never against a non-local database) |

Registered in `src/lib/flags/registry.ts`; `docs/feature-flags.md` and the profile files are regenerated with `npm run flags:docs`; `npm run flags:check` passes.

## 9. Not done on purpose

- No auto-approval of anything, customer-facing or not. No bulk approve.
- No rewrite of any legacy path, no table merge, no new approvals table.
- Creative adapter (its branch is not on the train): definition only. The lead-push draft adapter and the Autopilot action adapter exist (Wave 3).
- Legacy screens do not call the canonical service, so their decisions are not mirrored; the inbox is an additional door, not the only one.
- Merge and the AI-pilot sign-off keep their own screens for the irreversible or wording-sensitive step; the inbox links there.
- The inbox has no push notification or digest yet (telemetry: pending count and longest wait are shown on the screen; no metric is emitted).

## 10. Questions for the owner

1. ~~AI-pilot sign-off has no four-eyes~~ DONE in the Wave 1 integration (a permission TIGHTENING, see section 11): two signatures, a compliance reviewer and a different Admin. Open: there is no compliance role in the Role enum, so the compliance signature is an Admin account attesting the review. Add a role (or a named reviewer list) if the first signer must be a compliance person specifically.
2. Should `requestedById` on `ApprovalRequest` become nullable (a later, owner-approved, still non-destructive migration) so system-requested approvals can be recorded without naming the decider?
3. Which kinds should get a default expiry (for example a payout run or a stage correction)? None has one today.
4. ~~The lead-push draft kind is registered as a marketing approval~~ CHANGED in Wave 3: it is a customer message, so the approvers are Admin and the assigned RM (the same people who could already approve it in Agent drafts), not Marketing. This is a narrowing of the provisional seam definition and no new capability for anyone. Confirm.

## 11. AI-pilot sign-off is four-eyes (Wave 1 integration, a permission tightening)

Before: one Admin ticking the box recorded the sign-off and unlocked the reply assistant pilot. Now the CURRENT wording needs two signatures from two different people, and only the second unlocks the pilot (`signoffProgress` in `src/lib/agents/pilot.ts`, enforced in `recordSignoff`, `agents/pilot-service.ts`):

1. **Compliance reviewer**: the first signature ("Compliance has reviewed this wording"). Audit `pilot_signoff_recorded` with `capacity: "compliance"`, `complete: false`. There is no compliance role yet, so this is an Admin account that attests the review.
2. **A different Admin**: the countersignature (`capacity: "admin"`, `complete: true`). The person who made the first signature is refused (`A different Admin must countersign`; in the inbox it is a self-approval refusal because the canonical definition is `fourEyes: true` and the item carries the first signer as `fourEyesAuthorId`).

No schema change: each signature is its own immutable `AiPilotSignoff` row; the first row of the current wording is the compliance signature, the first row by a different person after it is the countersignature. A row recorded under the old rule (one Admin alone) counts as the compliance signature, so an environment that was already unlocked by one Admin locks again until a different Admin countersigns (intended: that is the tightening). Withdrawing the sign-off withdraws both rows. Signatures on an older wording never count. The Settings page shows "1 of 2" and a Countersign button after the first signature; the canonical inbox item stays `requested` until both are in.

Tests (RED first): `pilot.test.ts`, `pilot-service.test.ts`, `adapters/ai-pilot-signoff.test.ts`, `definitions.test.ts`, `actions.test.ts`, `pilot-view.test.tsx`, plus the real-database `pilot-wiring.db.test.ts` and `equivalence.db.test.ts`. Mutation checks killed: guard against the same Admin removed, countersign not required, definition set back to `fourEyes: false`, `fourEyesAuthorId` dropped.

## 12. Closed-loop kinds (Wave 3)

Two native kinds (the record IS an `ApprovalRequest`), both ADMIN requester and ADMIN approver, four-eyes, L4, no auto-approval, pinned to the generic registry by `native-pin.test.ts`:

- `closed-loop-destination` (`CLOSED_LOOP_DESTINATION`): switching an ad destination on, widening its approved regions or starting to send a value. The precheck proves the destination really is set up; the apply writes the destination's settings only (never the credentials), is idempotent and audited with the approver. Anything that only does less (switch off, narrower, no value) is applied at once and asks nobody.
- `consent-policy-change` (`CONSENT_POLICY_CHANGE`): the customer-facing ad measurement wording and its version (customer-facing, so L4). On approval it becomes the notice new consent records quote; consent already on file keeps the version it was given under.

Open question for the owner: with a single Admin neither can ever be approved (four-eyes). See `docs/closed-loop.md`.
