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
| 8 | **Erasure requests** | `ErasureRequest` (PENDING, APPROVED, COMPLETED) + `ApprovalRequest` `ERASURE_REQUEST` (one thing, two records) | Admin or Finance | Admin | yes | none | as above | Approval only marks the request APPROVED; deleting the data is a separate Admin action |
| 9 | **Duplicate-customer merges** | `MergeSuggestion`: OPEN, MERGED, DISMISSED | A job (suggestions) | Admin, Manager, or an RM who owns BOTH customers (a pair with only one of theirs is "restricted": they can only ask a manager) | none | none | `AuditLog` merge/dismiss rows in the same transaction | MERGE is irreversible: needs a chosen survivor and an explicit confirmation, rate limited. DISMISS is a compare-and-set |
| 10 | **AI-pilot sign-off** | `AiPilotSignoff` (immutable rows; revoke sets `revokedAt`) | A job (people listed for the pilot) | Admin | none (one Admin may sign alone) | none | `AuditLog` (`pilot_signoff_recorded`) | Records who, when and the exact wording version; a new wording needs a new sign-off |
| 11 | **Autopilot** (sibling branch, not on the train) | `AutopilotRecommendation` + `AutopilotDecision` | A job | Admin, Marketing (branch) | none | none | `AuditLog` | Ad changes (blocked from applying in the branch today) |
| 12 | **Creative variants, lead-push drafts** (sibling branches) | not on the train | | | | | | |

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
| `referral-statement` | `approveStatement` | in place | not supported (legacy has none) | Visible to Admin and Finance, and only while the referral programme is on |
| `merge-suggestion` | `decideMerge` / `decideDismiss` | not in place: opens the pair (irreversible; needs a survivor and a confirmation) | dismiss, in place | An RM sees only pairs they own both sides of |
| `ai-pilot-signoff` | `recordSignoff` | in place, with the acknowledgement | not supported (revoking is a separate act) | The handle is the wording version, so an old wording can never be signed |
| `payout-run`, `commission-adjustment`, `erasure-request`, `partner-tax-rule`, `partner-override-rule`, `stage-override` | `decideApproval` (generic service) | in place | in place | Native: the record already is an `ApprovalRequest`. The roles in the canonical definitions are pinned to the generic registry by `native-pin.test.ts` |
| `autopilot-action`, `ad-creative`, `lead-push-draft` | none yet | | | **Seam only**: the definition exists (with the ad-spend ceiling) so the adapter is one file when the branch lands |

**The seam for a sibling-branch adapter.** Implement `ApprovalAdapter` (`listAwaiting`, `listRequestedBy`, `get`, `decide`, optional `expire`), calling that branch's own decide function unchanged, add it to `prismaAdapters()` in `canonical/wiring.ts`, and flip the definition from `seam` to `read-through` with a write-through flag. The branch's decision tables stay authoritative. The segregation, evidence and four-eyes rules come from the definition.

**Equivalence proof.** Per adapter, a unit test runs the same scenario on two identical in-memory worlds, one through the legacy function and one through the canonical service, and compares the stored result: approve, reject, self-approval refused, expiry, the double-approve race, and for agent drafts the order `claim (atomic with the expiry check)`, `send`, `SENT`. `equivalence.db.test.ts` does the same on the real stores in a real database (agent drafts, social posts, referral statements, merge suggestions, AI pilot, payout runs, erasure), and checks scoping by role and write-through on and off. Switch: `APPROVALS_DB_TEST=1` (listed in `ci/db-suites.json`).

## 4. Expiry

Legacy agent drafts already expire. For the generic `ApprovalRequest`, `decideApproval` now refuses a request past its `expiresAt`, marks it `EXPIRED` with a compare-and-set, and applies nothing. A request with no expiry (all of them today) behaves exactly as before. No definition forces a TTL: adding one is a per-kind owner decision.

## 5. Write-through (default off, one switch per adapter)

Read-through is always on once the inbox is on: the view is derived from the legacy row. **Write-through** is optional and per adapter over a legacy table: `APPROVALS_WT_AGENT_PROPOSAL`, `_SOCIAL_POST`, `_REFERRAL_STATEMENT`, `_MERGE_SUGGESTION`, `_AI_PILOT_SIGNOFF`. With a switch on, a decision made through the canonical service ALSO writes one **decided** `ApprovalRequest` row (never pending, so no queue shows it and `decideApproval` refuses it) carrying approver, time, the reason, correlation and causation ids and the autonomy level. The legacy row is never changed by it, and a failure to write it never changes the decision's outcome. Native kinds have no write-through flag: their record already is the canonical one.

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
| `APPROVALS_WT_AGENT_PROPOSAL`, `APPROVALS_WT_SOCIAL_POST`, `APPROVALS_WT_REFERRAL_STATEMENT`, `APPROVALS_WT_MERGE_SUGGESTION`, `APPROVALS_WT_AI_PILOT_SIGNOFF` | off | Per-adapter write-through record (section 5) |
| `APPROVALS_DB_TEST` | off | Runs the real-database approvals suite (never against a non-local database) |

Registered in `src/lib/flags/registry.ts`; `docs/feature-flags.md` and the profile files are regenerated with `npm run flags:docs`; `npm run flags:check` passes.

## 9. Not done on purpose

- No auto-approval of anything, customer-facing or not. No bulk approve.
- No rewrite of any legacy path, no table merge, no new approvals table.
- Autopilot, creative and lead-push adapters (their branches are not on the train): definitions only.
- Legacy screens do not call the canonical service, so their decisions are not mirrored; the inbox is an additional door, not the only one.
- Merge and the AI-pilot sign-off keep their own screens for the irreversible or wording-sensitive step; the inbox links there.
- The inbox has no push notification or digest yet (telemetry: pending count and longest wait are shown on the screen; no metric is emitted).

## 10. Questions for the owner

1. AI-pilot sign-off has no four-eyes today: one Admin signs alone. Should it need a second person? (The definition says `fourEyes: false` to match the legacy behaviour.)
2. Should `requestedById` on `ApprovalRequest` become nullable (a later, owner-approved, still non-destructive migration) so system-requested approvals can be recorded without naming the decider?
3. Which kinds should get a default expiry (for example a payout run or a stage correction)? None has one today.
4. The lead-push draft kind is registered as a marketing approval at L4 on a provisional reading of its branch; confirm when that branch is reviewed.
