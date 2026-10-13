/**
 * Quality and control detectors (bible section 04). Pure: they take records that are already stored and a clock, and return
 * the findings they would raise. No database, no AI, no network. The writer in finding-store.ts keeps what these return.
 *
 * Rules that hold for every detector:
 * - A commitment that was only suggested by a conversation (confirmedAt null) is never flagged. It counts once a person accepts it,
 *   the same rule the commitment model states.
 * - Summaries describe the condition and the numbers only. They never copy the commitment text, the complaint title or a transcript.
 * - Each finding carries a dedupeKey of "<source>:<record id>:<category>", so re-running a detector yields the same key.
 */

export type FindingSource = "WHATSAPP" | "CALL" | "SUPPORT" | "RM_COMMUNICATION" | "COMPLAINT" | "COMPLIANCE" | "COMMITMENT" | "MANUAL";
export type FindingCategory =
  | "INCORRECT_COMMUNICATION"
  | "POOR_CONVERSATION"
  | "MISSED_FOLLOW_UP"
  | "MISSED_OPPORTUNITY"
  | "CUSTOMER_DISSATISFACTION"
  | "COMMITMENT_NOT_COMPLETED"
  | "POTENTIAL_COMPLIANCE_ISSUE";
export type FindingSeverity = "LOW" | "MEDIUM" | "HIGH";

export type CommitmentRecord = {
  id: string;
  clientId: string;
  ownerId: string | null;
  status: "OPEN" | "KEPT" | "BROKEN" | "CANCELLED";
  dueAt: Date;
  keptAt: Date | null;
  /** Null while the commitment is only suggested by a conversation. */
  confirmedAt: Date | null;
};

export type ComplaintRecord = {
  id: string;
  clientId: string;
  ownerId: string | null;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "REOPENED" | "CLOSED";
  slaDueAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
};

export type FindingDraft = {
  dedupeKey: string;
  clientId: string;
  subjectUserId: string | null;
  source: FindingSource;
  category: FindingCategory;
  severity: FindingSeverity;
  summary: string;
  evidenceRef: string;
  detectedAt: Date;
};

const DAY_MS = 86_400_000;

const dayCount = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/**
 * Missed follow-up: a confirmed commitment that is still OPEN (no resolution recorded) and past its due time.
 * Severity grows with how long it has been overdue: 7 days or more is HIGH, one day or more is MEDIUM, otherwise LOW.
 */
export function detectMissedFollowUps(commitments: readonly CommitmentRecord[], now: Date): FindingDraft[] {
  const out: FindingDraft[] = [];
  for (const c of commitments) {
    if (c.status !== "OPEN" || c.confirmedAt === null) continue;
    const overdueMs = now.getTime() - c.dueAt.getTime();
    if (overdueMs <= 0) continue;
    const days = Math.floor(overdueMs / DAY_MS);
    const severity: FindingSeverity = days >= 7 ? "HIGH" : days >= 1 ? "MEDIUM" : "LOW";
    out.push({
      dedupeKey: `COMMITMENT:${c.id}:MISSED_FOLLOW_UP`,
      clientId: c.clientId,
      subjectUserId: c.ownerId,
      source: "COMMITMENT",
      category: "MISSED_FOLLOW_UP",
      severity,
      summary: `Commitment still open and past due by ${dayCount(days)}.`,
      evidenceRef: `commitment:${c.id}`,
      detectedAt: now,
    });
  }
  return out;
}

/**
 * Complaint open beyond its SLA: the complaint has no resolution and no close, and its SLA due time has passed.
 * Severity follows the complaint's own severity (CRITICAL and HIGH map to HIGH).
 */
export function detectComplaintSlaBreaches(complaints: readonly ComplaintRecord[], now: Date): FindingDraft[] {
  const out: FindingDraft[] = [];
  for (const k of complaints) {
    if (k.status === "RESOLVED" || k.status === "CLOSED") continue;
    if (k.resolvedAt !== null || k.closedAt !== null) continue;
    if (k.slaDueAt.getTime() >= now.getTime()) continue;
    const days = Math.floor((now.getTime() - k.slaDueAt.getTime()) / DAY_MS);
    const severity: FindingSeverity = k.severity === "CRITICAL" || k.severity === "HIGH" ? "HIGH" : k.severity === "MEDIUM" ? "MEDIUM" : "LOW";
    out.push({
      dedupeKey: `COMPLAINT:${k.id}:CUSTOMER_DISSATISFACTION`,
      clientId: k.clientId,
      subjectUserId: k.ownerId,
      source: "COMPLAINT",
      category: "CUSTOMER_DISSATISFACTION",
      severity,
      summary: `Complaint still open ${days > 0 ? dayCount(days) : "less than a day"} past its SLA.`,
      evidenceRef: `complaint:${k.id}`,
      detectedAt: now,
    });
  }
  return out;
}

/**
 * Commitment completed late: a confirmed commitment marked KEPT after its due time. Severity is LOW; it is kept for the
 * record and for management reporting, not as an alarm.
 */
export function detectLateCommitments(commitments: readonly CommitmentRecord[], now: Date): FindingDraft[] {
  const out: FindingDraft[] = [];
  for (const c of commitments) {
    if (c.status !== "KEPT" || c.confirmedAt === null || c.keptAt === null) continue;
    if (c.keptAt.getTime() <= c.dueAt.getTime()) continue;
    out.push({
      dedupeKey: `COMMITMENT:${c.id}:COMMITMENT_NOT_COMPLETED`,
      clientId: c.clientId,
      subjectUserId: c.ownerId,
      source: "COMMITMENT",
      category: "COMMITMENT_NOT_COMPLETED",
      severity: "LOW",
      summary: "Commitment was kept, but after its due time.",
      evidenceRef: `commitment:${c.id}`,
      detectedAt: now,
    });
  }
  return out;
}

/** All three detectors over one batch of stored records, with duplicate keys removed (first one wins), sorted by key. */
export function detectFindings(input: { commitments: readonly CommitmentRecord[]; complaints: readonly ComplaintRecord[] }, now: Date): FindingDraft[] {
  const all = [
    ...detectMissedFollowUps(input.commitments, now),
    ...detectLateCommitments(input.commitments, now),
    ...detectComplaintSlaBreaches(input.complaints, now),
  ];
  return uniqueByKey(all).sort((a, b) => (a.dedupeKey < b.dedupeKey ? -1 : a.dedupeKey > b.dedupeKey ? 1 : 0));
}

/** Keeps the first draft for each dedupeKey. Used before writing, so one batch cannot store the same finding twice. */
export function uniqueByKey(drafts: readonly FindingDraft[]): FindingDraft[] {
  const seen = new Set<string>();
  const out: FindingDraft[] = [];
  for (const d of drafts) {
    if (seen.has(d.dedupeKey)) continue;
    seen.add(d.dedupeKey);
    out.push(d);
  }
  return out;
}
