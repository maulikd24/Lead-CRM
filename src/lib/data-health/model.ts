/**
 * Data health (Wave 1, workstream A): findings computed from the relationship registry, the customer tables and the event stream, kept as
 * work items an Admin can acknowledge. Prisma-free: the rules below are pure and unit-tested; the queries live in checks-db.ts.
 *
 * A finding names a record by id or customer code, never by a person's name, phone or email, and carries counts and codes only.
 */

export type Severity = "INFO" | "WARN" | "HIGH";
export type SubjectType = "client" | "event" | "system";

export const CHECKS = {
  orphaned_event: { title: "Event for a customer that no longer exists", severity: "WARN" as Severity, why: "A customer event points at a customer id that is gone and no erasure was recorded for it, so something deleted the customer outside the erasure path.", fix: "Find how the customer row was removed. If it was an erasure, record it; otherwise restore or re-point the events." },
  no_identity_keys: { title: "Customer with no phone or email key", severity: "WARN" as Severity, why: "Matching, deduplication and every inbound channel use the identity keys. A customer without either can never be recognised again, so the next contact creates a duplicate.", fix: "Ask the relationship manager for a phone or email and save it on the customer." },
  stale_intelligence: { title: "Intelligence is out of date", severity: "INFO" as Severity, why: "The next best action and lifecycle stage were last computed a long time ago. Treat them as stale and do not present them as current.", fix: "Check that the intelligence refresh job is running; open the customer to refresh it." },
  unassigned_lead: { title: "Lead with no relationship manager", severity: "WARN" as Severity, why: "An active lead that has been waiting without an owner will not be contacted in time.", fix: "Assign the lead to a relationship manager." },
  impossible_lifecycle: { title: "Customer in a state that should not exist", severity: "HIGH" as Severity, why: "Facts on the customer contradict each other (for example funded without an approved KYC), so every report built on them is suspect.", fix: "Open the customer, find which record is wrong and correct it." },
  rows_on_merged_client: { title: "Records still on a merged-away customer", severity: "HIGH" as Severity, why: "The merge is meant to move this kind of record to the surviving customer. Rows left behind are invisible on the survivor.", fix: "Re-point the rows to the survivor, then fix the merge path." },
  left_on_archived_duplicate: { title: "Records the merge does not move", severity: "INFO" as Severity, why: "By today's merge rules these records stay on the archived duplicate, so the surviving customer does not show them.", fix: "Decide per record type whether the merge should move it (the relationship registry holds the rule)." },
  duplicate_identity_key: { title: "Two live customers share a phone or email key", severity: "WARN" as Severity, why: "Two customer rows that look like the same person split their history between them.", fix: "Review the pair in Duplicate customers and merge or dismiss." },
  emit_failures_open: { title: "Events that could not be stored", severity: "WARN" as Severity, why: "Some domain actions succeeded but their event could not be written, so the event stream is missing facts.", fix: "Open the failure list, fix the cause and retry the emits." },
  consent_context_missing: { title: "Events without a consent snapshot", severity: "INFO" as Severity, why: "Events on a channel that needs consent were recorded without the consent snapshot, so later audits cannot show what was agreed at the time.", fix: "Pass the consent snapshot where the event is emitted." },
} as const;
export type CheckKey = keyof typeof CHECKS;

export type Finding = {
  checkKey: CheckKey;
  subjectType: SubjectType;
  subjectId: string;
  /** Set when the subject is a customer; the control plane shows the customer code and links to it. */
  clientId?: string | null;
  severity: Severity;
  title: string;
  detail?: Record<string, string | number | boolean | null>;
};

export type ExistingItem = { id: string; checkKey: string; subjectType: string; subjectId: string; status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | string };

export type ReconcilePlan = { create: Finding[]; touch: { id: string; reopen: boolean }[]; resolve: string[] };

/**
 * Turns this run's findings into database changes. Only checks that RAN are reconciled: a check whose query failed must not close its work items.
 * An acknowledged item stays acknowledged while the problem persists; a resolved item whose problem returns is reopened.
 */
export function reconcilePlan(existing: readonly ExistingItem[], found: readonly Finding[], checksRun: readonly string[]): ReconcilePlan {
  const ran = new Set(checksRun);
  const key = (c: string, t: string, s: string) => `${c}|${t}|${s}`;
  const byKey = new Map(existing.map((e) => [key(e.checkKey, e.subjectType, e.subjectId), e]));
  const seen = new Set<string>();
  const plan: ReconcilePlan = { create: [], touch: [], resolve: [] };
  for (const f of found) {
    if (!ran.has(f.checkKey)) continue;
    const k = key(f.checkKey, f.subjectType, f.subjectId);
    if (seen.has(k)) continue;
    seen.add(k);
    const e = byKey.get(k);
    if (!e) plan.create.push(f);
    else plan.touch.push({ id: e.id, reopen: e.status === "RESOLVED" });
  }
  for (const e of existing) {
    if (!ran.has(e.checkKey) || e.status === "RESOLVED") continue;
    if (!seen.has(key(e.checkKey, e.subjectType, e.subjectId))) plan.resolve.push(e.id);
  }
  return plan;
}

/** An event whose customer is gone: expected after an erasure (the fact is kept), a finding otherwise. */
export function classifyEventOrphan(e: { clientId: string | null; clientExists: boolean; erased: boolean }): "ok" | "erased" | "orphan" {
  if (!e.clientId || e.clientExists) return "ok";
  return e.erased ? "erased" : "orphan";
}

export type LifecycleFacts = {
  status: string;
  completedAt: Date | null;
  kycStatus: string | null;
  fundingStatus: string | null;
  mergedIntoId: string | null;
  /** `missing`: the survivor row is gone. (A survivor that is archived, or itself merged away later, is a legitimate state: merge chains are supported.) */
  mergeTargetState: "none" | "live" | "missing";
  /** A duplicate whose personal fields were scrubbed by an erasure of its survivor keeps its pointer by design: not a finding. */
  scrubbed?: boolean;
};
export type LifecycleViolation = "funded_without_kyc" | "status_completed_mismatch" | "merge_target_invalid";

export function lifecycleViolations(f: LifecycleFacts): LifecycleViolation[] {
  const out: LifecycleViolation[] = [];
  if ((f.fundingStatus === "FULLY_FUNDED" || f.fundingStatus === "PARTIALLY_FUNDED") && f.kycStatus !== "APPROVED") out.push("funded_without_kyc");
  if ((f.status === "COMPLETED") !== (f.completedAt !== null)) out.push("status_completed_mismatch");
  if (f.mergedIntoId && f.mergeTargetState === "missing" && !f.scrubbed) out.push("merge_target_invalid");
  return out;
}
