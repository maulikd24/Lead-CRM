import type { CustomerPath } from "./schema-scan";

/**
 * THE relationship registry: every table that reaches the customer (Client), directly, by a plain id column or through another
 * table, and for each one HOW IT IS MERGED, HOW IT IS ERASED, HOW IT APPEARS IN THE TIMELINE and WHAT CLASS OF DATA IT HOLDS.
 *
 * Why it exists: merge and erasure used to enumerate tables by hand, and a missed table is a data-protection leak. Now a test (registry.test.ts)
 * reads prisma/schema.prisma and FAILS when a table with a customer link is missing here, when a declared path no longer matches the schema, or
 * when an erase order puts a parent before its child. The merge and erasure code can be driven from this list (behind flags; the old code stays
 * until equivalence is proven), and the timeline reader and the data-health checks read it too.
 *
 * This file DESCRIBES today's behaviour. It does not change it: a table the merge does not move today says `stay` (a known gap, surfaced by data
 * health), never a rule nobody implemented.
 */

export type DataClass = "INTERNAL" | "PERSONAL" | "SENSITIVE_PERSONAL";

export type MergeRule =
  /** updateMany: every row of the duplicate is re-pointed to the survivor. `onlyIfAny`: only when at least one row matches it (joint holders move only when the duplicate has a live one). */
  | { kind: "reparent"; onlyIfAny?: Record<string, unknown> }
  /** Unique per customer: moves only when the survivor has none; otherwise a conflict (named) is reported and the row stays on the archived record. */
  | { kind: "reparent_if_absent"; conflict: string }
  /** Unique per customer/holder/step: moves only when the survivor has no row of this table at all; otherwise a conflict is reported. */
  | { kind: "reparent_if_survivor_has_none"; conflict: string }
  /** Has its own logic in clients/merge.ts (same in both paths): `app_signup_ledger` re-points the signup ledger when app id linking is on; `household_consent` re-points both the subject and the grantee side of a household consent. */
  | { kind: "handler"; handler: "app_signup_ledger" | "household_consent" }
  /** Not moved by the merge today: stays on the archived duplicate. A known gap, reported by the data-health check. */
  | { kind: "stay"; note: string }
  /** Travels with its parent row. */
  | { kind: "follows_parent"; parent: string }
  /** Plain-id event or work-item tables: not moved. */
  | { kind: "not_applicable"; note: string };

export type EraseRule =
  /** deleteMany, in ascending `order`, inside the erasure transaction (before the customer row goes). */
  | { kind: "delete"; order: number }
  /** Refuses the erasure while rows exist (financial and regulatory trails: archive instead). `message` is the exact text shown. */
  | { kind: "block"; order: number; message: string }
  /** Blocks on rows whose status is not `NOT_INVESTED`, deletes the rest. */
  | { kind: "block_then_delete"; blockOrder: number; deleteOrder: number; message: string }
  /** Reduced to a tombstone by privacy/erase-client-traces.ts (the replay-blocking key stays, the person's data goes). */
  | { kind: "tombstone"; handler: "eraseClientTraces" }
  /** Handled by a named helper: events keep only id, type and times; their metadata, consent snapshot and actor are nulled. */
  | { kind: "handler"; handler: "eraseEventTraces"; order: number }
  /** Removed with its parent (database cascade or the parent's own delete). */
  | { kind: "cascade"; parent: string }
  /** Cannot exist when the parent is erasable (the parent blocks the erasure), or is kept because it holds no personal data. */
  | { kind: "via_parent"; parent: string; why: string };

export type TimelineSource =
  | "activity" | "message" | "task" | "ticket" | "consent" | "stage" | "transaction" | "outcome" | "agent" | "journey" | "insight" | "milestone" | "goal" | "referral" | "event";

export type TimelineRule =
  | { source: TimelineSource; note?: string }
  /** Folded into another source's items (a call is shown through its Activity row). */
  | { foldedInto: TimelineSource }
  /** Not a customer-facing fact (internal bookkeeping, reference data, a ledger that is not a history). */
  | { none: string };

export type RelationshipEntry = {
  model: string;
  kind: "direct_fk" | "plain_id" | "indirect";
  paths: CustomerPath[];
  /** Further routes to the customer that only erasure follows (a referral reaches the customer both as the referred person and through the referrer). */
  extraErasePaths?: CustomerPath[];
  merge: MergeRule;
  erase: EraseRule;
  timeline: TimelineRule;
  dataClass: DataClass;
};

const col = (column = "clientId", via: string[] = []): CustomerPath => ({ via, column });
const direct = (model: string, merge: MergeRule, erase: EraseRule, timeline: TimelineRule, dataClass: DataClass, extra: Partial<RelationshipEntry> = {}): RelationshipEntry => ({ model, kind: "direct_fk", paths: [col()], merge, erase, timeline, dataClass, ...extra });
const plain = (model: string, merge: MergeRule, erase: EraseRule, timeline: TimelineRule, dataClass: DataClass, extra: Partial<RelationshipEntry> = {}): RelationshipEntry => ({ model, kind: "plain_id", paths: [col()], merge, erase, timeline, dataClass, ...extra });
const via = (model: string, path: CustomerPath, merge: MergeRule, erase: EraseRule, timeline: TimelineRule, dataClass: DataClass): RelationshipEntry => ({ model, kind: "indirect", paths: [path], merge, erase, timeline, dataClass });

const REPARENT: MergeRule = { kind: "reparent" };
const GAP = (note: string): MergeRule => ({ kind: "stay", note });
const NOT_MOVED = "a known gap: not moved by the merge today";
const del = (order: number): EraseRule => ({ kind: "delete", order });

export const RELATIONSHIPS: readonly RelationshipEntry[] = [
  // ---- the customer's own conversation and history ------------------------------------------------------------------------------------
  direct("Activity", REPARENT, del(35), { source: "activity" }, "PERSONAL"),
  direct("Message", REPARENT, del(28), { source: "message" }, "PERSONAL"),
  direct("DeviceCall", REPARENT, del(34), { foldedInto: "activity" }, "PERSONAL"),
  direct("Task", REPARENT, del(33), { source: "task" }, "PERSONAL"),
  direct("SupportTicket", REPARENT, del(31), { source: "ticket" }, "PERSONAL"),
  direct("StageHistory", REPARENT, del(36), { source: "stage" }, "INTERNAL"),
  direct("Exception", REPARENT, del(37), { none: "operational exception queue, not a customer-facing fact" }, "INTERNAL"),
  direct("Document", REPARENT, del(29), { none: "documents are listed on their own tab" }, "SENSITIVE_PERSONAL"),
  direct("ConversationReview", GAP(NOT_MOVED), del(17), { foldedInto: "activity" }, "SENSITIVE_PERSONAL"),
  direct("ConversationInsight", GAP(NOT_MOVED), del(18), { source: "insight", note: "complaints and commitments" }, "SENSITIVE_PERSONAL"),
  direct("InteractionOutcome", GAP(NOT_MOVED), del(19), { source: "outcome" }, "PERSONAL"),
  direct("AgentProposal", GAP(NOT_MOVED), del(3), { source: "agent" }, "PERSONAL"),
  direct("JourneyRun", GAP(NOT_MOVED), del(2), { source: "journey" }, "INTERNAL"),
  via("JourneyRunStep", col("clientId", ["run"]), { kind: "follows_parent", parent: "JourneyRun" }, del(1), { none: "step detail of a journey run" }, "INTERNAL"),

  // ---- identity, consent and the person's own choices ---------------------------------------------------------------------------------
  direct("ConsentRecord", GAP("Consent is a ledger about one record of the person; it stays with the record it was captured on."), del(8), { source: "consent" }, "PERSONAL"),
  direct("CustomerGoal", GAP(NOT_MOVED), del(9), { source: "goal" }, "SENSITIVE_PERSONAL"),
  direct("CustomerReview", GAP(NOT_MOVED), del(10), { source: "goal" }, "SENSITIVE_PERSONAL"),
  direct("SuggestionDismissal", GAP(NOT_MOVED), del(11), { none: "a dismissed suggestion, not a fact about the customer" }, "INTERNAL"),
  direct("OutcomeEvent", GAP(NOT_MOVED), del(12), { source: "outcome" }, "PERSONAL"),
  // Campaign attribution: the speed-to-lead clock, the campaign context and the lead's own typed answers. Erased with the customer; the Journey tab shows the clock, so it is not a timeline source of its own.
  direct("LeadPush", GAP(NOT_MOVED), del(42), { none: "speed-to-lead bookkeeping (campaign context and the lead's answers); the Journey tab reads it" }, "PERSONAL"),
  direct("MergeSuggestion", GAP("Open suggestions about the archived customer are closed by the merge review itself."), del(5), { none: "duplicate review queue" }, "PERSONAL", { paths: [col("clientAId"), col("clientBId")] }),
  direct("CleverTapSync", GAP(NOT_MOVED), del(4), { none: "vendor sync bookkeeping" }, "INTERNAL"),
  direct("SegmentMembership", GAP(NOT_MOVED), del(22), { none: "derived segment membership" }, "INTERNAL"),
  direct("AssetClassAcceptance", GAP(NOT_MOVED), del(23), { none: "derived profile" }, "INTERNAL"),
  direct("CustomerIntelligence", GAP("Derived; it is recomputed for the survivor on the next refresh."), del(20), { none: "derived current state (next best action), shown as intelligence, not as history" }, "SENSITIVE_PERSONAL"),
  direct("SmartAllvestProfile", GAP(NOT_MOVED), del(21), { none: "profile" }, "SENSITIVE_PERSONAL"),
  direct("WealthHealthCheckup", GAP(NOT_MOVED), del(24), { none: "profile" }, "SENSITIVE_PERSONAL"),
  direct("Opportunity", GAP(NOT_MOVED), del(27), { none: "opportunities are listed on their own tab" }, "SENSITIVE_PERSONAL"),
  via("OpportunityStageHistory", col("clientId", ["opportunity"]), { kind: "follows_parent", parent: "Opportunity" }, del(26), { none: "history of an opportunity" }, "INTERNAL"),

  // ---- onboarding pipeline ------------------------------------------------------------------------------------------------------------------
  direct("KycStep", { kind: "reparent_if_survivor_has_none", conflict: "KycStep" }, del(30), { source: "milestone", note: "KYC steps" }, "SENSITIVE_PERSONAL"),
  direct("KycRecord", { kind: "reparent_if_absent", conflict: "KycRecord" }, del(38), { source: "milestone", note: "KYC submitted and completed" }, "SENSITIVE_PERSONAL"),
  direct("FundingRecord", { kind: "reparent_if_absent", conflict: "FundingRecord" }, del(39), { source: "milestone", note: "funding date" }, "SENSITIVE_PERSONAL"),
  direct("DealerIntroduction", { kind: "reparent_if_absent", conflict: "DealerIntroduction" }, del(40), { none: "dealer hand-off record" }, "PERSONAL"),
  direct("AccountHolder", { kind: "reparent", onlyIfAny: { isDeleted: false } }, del(32), { none: "joint holders of an account" }, "SENSITIVE_PERSONAL"),

  // ---- money: never erased, always blocks ---------------------------------------------------------------------------------------------------
  direct("TradingAccount", REPARENT, { kind: "block", order: 2, message: "This client has Trading Accounts on file — use Archive instead of permanent deletion." }, { none: "accounts are listed on the portfolio tab; their transactions are on the timeline" }, "SENSITIVE_PERSONAL"),
  direct("HouseholdMember", GAP(NOT_MOVED), { kind: "block", order: 3, message: "This client belongs to a Household — use Archive instead of permanent deletion." }, { none: "household membership" }, "PERSONAL"),
  direct("RevenueEvent", REPARENT, { kind: "block", order: 4, message: "This client has Revenue Events on file — use Archive instead of permanent deletion." }, { none: "firm revenue, not a customer-facing fact" }, "INTERNAL", { paths: [col()] }),
  direct("ClientPayment", REPARENT, { kind: "block", order: 5, message: "This client has Payments on file — use Archive instead of permanent deletion." }, { none: "payments are listed on the finance tab" }, "SENSITIVE_PERSONAL"),
  direct("AdvisoryInteraction", GAP(NOT_MOVED), { kind: "block", order: 6, message: "This client has Advisory Interactions on file — use Archive instead of permanent deletion." }, { none: "advisory record" }, "SENSITIVE_PERSONAL"),
  direct("PmsAifHolding", GAP(NOT_MOVED), { kind: "block_then_delete", blockOrder: 1, deleteOrder: 25, message: "This client has PMS/AIF holdings on file — use Archive instead of permanent deletion." }, { none: "holdings are listed on the portfolio tab" }, "SENSITIVE_PERSONAL"),
  via("Position", col("clientId", ["tradingAccount"]), { kind: "follows_parent", parent: "TradingAccount" }, { kind: "via_parent", parent: "TradingAccount", why: "an account with positions blocks the erasure" }, { none: "positions are listed on the portfolio tab" }, "SENSITIVE_PERSONAL"),
  via("Transaction", col("clientId", ["tradingAccount"]), { kind: "follows_parent", parent: "TradingAccount" }, { kind: "via_parent", parent: "TradingAccount", why: "an account with transactions blocks the erasure" }, { source: "transaction" }, "SENSITIVE_PERSONAL"),
  via("ProductEntitlement", col("clientId", ["tradingAccount"]), { kind: "follows_parent", parent: "TradingAccount" }, { kind: "via_parent", parent: "TradingAccount", why: "an account blocks the erasure" }, { none: "entitlements of an account" }, "INTERNAL"),
  via("CommissionAccrual", col("clientId", ["revenueEvent"]), { kind: "follows_parent", parent: "RevenueEvent" }, { kind: "via_parent", parent: "RevenueEvent", why: "a revenue event blocks the erasure" }, { none: "partner commission" }, "INTERNAL"),
  via("PayoutLine", col("clientId", ["commissionAccrual", "revenueEvent"]), { kind: "follows_parent", parent: "CommissionAccrual" }, { kind: "via_parent", parent: "CommissionAccrual", why: "a revenue event blocks the erasure" }, { none: "partner payout" }, "INTERNAL"),

  // ---- partners and referrals -----------------------------------------------------------------------------------------------------------
  direct("PartnerReferralTouch", GAP(NOT_MOVED), del(6), { none: "first touch of a partner" }, "PERSONAL"),
  direct("Referrer", GAP(NOT_MOVED), del(16), { none: "referrer record" }, "PERSONAL"),
  direct("Referral", GAP(NOT_MOVED), del(14), { source: "referral" }, "PERSONAL", { paths: [col("referredClientId")], extraErasePaths: [col("clientId", ["referrer"])] }),
  via("ReferralCode", col("clientId", ["referrer"]), { kind: "follows_parent", parent: "Referrer" }, del(15), { none: "codes of a referrer" }, "PERSONAL"),
  via("ReferralEvent", col("referredClientId", ["referral"]), { kind: "follows_parent", parent: "Referral" }, { kind: "cascade", parent: "Referral" }, { source: "referral" }, "PERSONAL"),
  direct("ReferralDevice", GAP(NOT_MOVED), del(13), { none: "hashed device ids for fraud checks" }, "PERSONAL"),

  // ---- Wave 2: customer memory, formal complaints and commitments, household relationship consent (w2-memory) -----------------------------------
  direct("CustomerMemoryItem", REPARENT, del(42), { none: "shown on the Memory tab, not as history" }, "SENSITIVE_PERSONAL"),
  direct("Complaint", REPARENT, del(43), { none: "shown on the Service tab; the ticket or insight it came from keeps its own timeline entry" }, "PERSONAL"),
  via("ComplaintEvent", col("clientId", ["complaint"]), { kind: "follows_parent", parent: "Complaint" }, { kind: "cascade", parent: "Complaint" }, { none: "history of a complaint" }, "PERSONAL"),
  direct("Commitment", REPARENT, del(44), { none: "shown on the Service tab" }, "PERSONAL"),
  // Consent names two customers (the member who agrees and the member who may see): both sides move in a merge and both sides are erased. A null grantee means "every member", so a delete on the grantee column alone would be wrong.
  direct("HouseholdRelationshipConsent", { kind: "handler", handler: "household_consent" }, del(45), { none: "household consent ledger" }, "PERSONAL", { paths: [col("subjectClientId"), col("granteeClientId")] }),

  // ---- Wave 2: Decision Engine v2, shadow (w2-decision). A decision quotes the person in its reason and evidence, so erasure deletes it; feedback, outcomes and the disagreement row follow it. ----
  direct("DecisionRecord", GAP("Shadow decisions stay on the archived duplicate: the engine skips merged-away customers, so they are inert; erasure removes them."), del(46), { none: "shadow decisions are reviewed on /decisions and in the Evidence Drawer, not as history" }, "SENSITIVE_PERSONAL"),
  via("DecisionFeedback", col("clientId", ["decision"]), { kind: "follows_parent", parent: "DecisionRecord" }, { kind: "cascade", parent: "DecisionRecord" }, { none: "feedback on a decision" }, "PERSONAL"),
  via("DecisionOutcome", col("clientId", ["decision"]), { kind: "follows_parent", parent: "DecisionRecord" }, { kind: "cascade", parent: "DecisionRecord" }, { none: "outcome linked to a decision (correlation, not causation)" }, "PERSONAL"),
  via("DecisionDisagreement", col("clientId", ["decision"]), { kind: "follows_parent", parent: "DecisionRecord" }, { kind: "cascade", parent: "DecisionRecord" }, { none: "difference between the old and the new engine" }, "PERSONAL"),

  // ---- plain id tables (no foreign key) ---------------------------------------------------------------------------------------------------------
  plain("LeadIntake", { kind: "handler", handler: "app_signup_ledger" }, { kind: "tombstone", handler: "eraseClientTraces" }, { none: "raw inbound ledger; the customer's own lead event is shown instead" }, "PERSONAL"),
  plain("PartnerAttributionEvent", { kind: "not_applicable", note: "append-only partner trail" }, del(7), { none: "partner trail" }, "PERSONAL"),
  plain("CustomerEvent", { kind: "not_applicable", note: "facts keep the id of the record they were about; a merge is itself a fact (customer.merged)" }, { kind: "handler", handler: "eraseEventTraces", order: 41 }, { source: "event" }, "PERSONAL"),
  plain("EventEmitFailure", { kind: "not_applicable", note: "operational" }, { kind: "handler", handler: "eraseEventTraces", order: 41 }, { none: "operational failure record" }, "INTERNAL"),
  plain("DataHealthItem", { kind: "not_applicable", note: "recomputed" }, { kind: "handler", handler: "eraseEventTraces", order: 41 }, { none: "operational work item" }, "INTERNAL"),
  via("EventDeadLetter", col("clientId", ["event"]), { kind: "follows_parent", parent: "CustomerEvent" }, { kind: "via_parent", parent: "CustomerEvent", why: "holds only a consumer name, an attempt count and an error class; no personal data" }, { none: "operational" }, "INTERNAL"),
];

/**
 * Tables that hold a customer id BY VALUE (an entity id in a log, a JSON payload) rather than in a column the schema can see. They cannot be verified by
 * the schema test; each is stated here so a reader knows how erasure and merge treat them. `eraseClientTraces` and the erasure action implement the rule.
 */
export const REFERENCED_BY_VALUE: readonly { model: string; how: string; erase: "delete" | "retain_masked" | "retain"; why: string }[] = [
  { model: "Notification", how: "payload.clientId", erase: "delete", why: "payloads can name the customer" },
  { model: "AuditLog", how: "entityId", erase: "retain_masked", why: "append-only hash chain; the erasure writes only masked identifiers" },
  { model: "DataAccessLog", how: "entityId", erase: "retain", why: "who looked at what: part of the audit trail" },
  { model: "ErasureRequest", how: "subjectId", erase: "retain", why: "the record that the erasure happened" },
  { model: "ApprovalRequest", how: "entityId", erase: "retain", why: "the approval that authorised the erasure" },
];

export const relationshipFor = (model: string): RelationshipEntry | undefined => RELATIONSHIPS.find((r) => r.model === model);

/** Prisma delegate name of a model (`PmsAifHolding` -> `pmsAifHolding`). */
export const delegateOf = (model: string): string => model.charAt(0).toLowerCase() + model.slice(1);

/** Builds a Prisma `where` that selects the rows of `model` that belong to any of `clientIds`, following the declared paths (OR-ed). */
export function whereForClients(paths: readonly CustomerPath[], clientIds: readonly string[]): Record<string, unknown> {
  const one = (p: CustomerPath): Record<string, unknown> => {
    let inner: Record<string, unknown> = { [p.column]: { in: [...clientIds] } };
    for (const field of [...p.via].reverse()) inner = { [field]: inner };
    return inner;
  };
  return paths.length === 1 ? one(paths[0]) : { OR: paths.map(one) };
}

/** Every timeline source named in the registry, for the cross-check against the timeline reader. */
export function timelineSourcesNamed(): TimelineSource[] {
  const s = new Set<TimelineSource>();
  for (const r of RELATIONSHIPS) {
    if ("source" in r.timeline) s.add(r.timeline.source);
    if ("foldedInto" in r.timeline) s.add(r.timeline.foldedInto);
  }
  return [...s];
}
