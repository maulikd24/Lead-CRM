/**
 * Complaint and commitment rules, pure. Complaints and commitments are managed cases built OVER the ticket, insight, call and task
 * data (linked by id, never copied): this file owns only the formal state: severity, status, owner, the SLA clock, resolution,
 * reopen, and "who promised what to whom by when" with derived overdue. Defaults below are the owner-question defaults in
 * docs/customer-memory.md (service section): change a number here, the tests state the intent.
 */

export const COMPLAINT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type ComplaintSeverityName = (typeof COMPLAINT_SEVERITIES)[number];
export const COMPLAINT_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "REOPENED", "CLOSED"] as const;
export type ComplaintStatusName = (typeof COMPLAINT_STATUSES)[number];
export const COMMITMENT_STATUSES = ["OPEN", "KEPT", "BROKEN", "CANCELLED"] as const;
export type CommitmentStatusName = (typeof COMMITMENT_STATUSES)[number];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Resolution clock by severity, in hours. A default pending the compliance owner's number. */
export const SLA_HOURS: Record<ComplaintSeverityName, number> = { CRITICAL: 24, HIGH: 48, MEDIUM: 72, LOW: 120 };
/** A complaint must be acknowledged within this many hours of being opened. */
export const ACK_HOURS = 24;
/** A resolved or closed complaint can be reopened for this many days after it was resolved. */
export const REOPEN_WINDOW_DAYS = 30;
/** "Due soon": a commitment within this many hours of its deadline. */
export const DUE_SOON_HOURS = 24;

export const slaDueAt = (from: Date, severity: ComplaintSeverityName): Date => new Date(from.getTime() + SLA_HOURS[severity] * HOUR);

export type ComplaintLike = {
  status: ComplaintStatusName;
  severity: ComplaintSeverityName;
  ownerId: string | null;
  openedAt: Date;
  acknowledgedAt: Date | null;
  slaDueAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
  reopenedCount: number;
};

export type SlaState = "ok" | "at_risk" | "breached" | "met" | "missed";

/** The clock on a complaint right now. Resolved or closed ones report whether the deadline was met. */
export function slaState(c: Pick<ComplaintLike, "status" | "openedAt" | "slaDueAt" | "resolvedAt">, now: Date): SlaState {
  if (c.status === "RESOLVED" || c.status === "CLOSED") return c.resolvedAt && c.resolvedAt.getTime() <= c.slaDueAt.getTime() ? "met" : "missed";
  if (now.getTime() > c.slaDueAt.getTime()) return "breached";
  const total = c.slaDueAt.getTime() - c.openedAt.getTime();
  const used = now.getTime() - c.openedAt.getTime();
  return total > 0 && used / total >= 0.75 ? "at_risk" : "ok";
}

export function ackState(c: Pick<ComplaintLike, "openedAt" | "acknowledgedAt">, now: Date): "done" | "pending" | "overdue" {
  if (c.acknowledgedAt) return "done";
  return now.getTime() - c.openedAt.getTime() > ACK_HOURS * HOUR ? "overdue" : "pending";
}

export type ComplaintAction =
  | { type: "acknowledge"; actorId: string }
  | { type: "start"; actorId: string }
  | { type: "assign"; actorId: string; ownerId: string }
  | { type: "set_severity"; actorId: string; severity: ComplaintSeverityName }
  | { type: "resolve"; actorId: string; resolutionCode: string; resolution: string }
  | { type: "close"; actorId: string }
  | { type: "reopen"; actorId: string; reason: string };

export type ServiceCode = "ACTOR_REQUIRED" | "BAD_STATE" | "OWNER_REQUIRED" | "RESOLUTION_REQUIRED" | "REASON_REQUIRED" | "REOPEN_WINDOW_PASSED" | "ALREADY" | "NOTE_REQUIRED";
export type ServiceResult = { ok: true; patch: Record<string, unknown> } | { ok: false; code: ServiceCode; message: string };
const no = (code: ServiceCode, message: string): ServiceResult => ({ ok: false, code, message });
const isPerson = (id: string) => !!id && id.trim() !== "" && id !== "system";
const LIVE: readonly ComplaintStatusName[] = ["OPEN", "IN_PROGRESS", "REOPENED"];

export function complaintTransition(c: ComplaintLike, action: ComplaintAction, now: Date): ServiceResult {
  if (!isPerson(action.actorId)) return no("ACTOR_REQUIRED", "A named person must do this.");
  switch (action.type) {
    case "acknowledge":
      if (c.acknowledgedAt) return no("ALREADY", "Already acknowledged.");
      if (!LIVE.includes(c.status)) return no("BAD_STATE", "This complaint is not open.");
      return { ok: true, patch: { acknowledgedAt: now } };
    case "start":
      if (c.status !== "OPEN" && c.status !== "REOPENED") return no("BAD_STATE", "Only an open or reopened complaint can be started.");
      if (!c.ownerId) return no("OWNER_REQUIRED", "Give the complaint an owner first.");
      return { ok: true, patch: { status: "IN_PROGRESS", ...(c.acknowledgedAt ? {} : { acknowledgedAt: now }) } };
    case "assign":
      if (!LIVE.includes(c.status)) return no("BAD_STATE", "This complaint is not open.");
      if (!action.ownerId?.trim()) return no("OWNER_REQUIRED", "Choose an owner.");
      return { ok: true, patch: { ownerId: action.ownerId } };
    case "set_severity": {
      if (!LIVE.includes(c.status)) return no("BAD_STATE", "This complaint is not open.");
      // The clock is re-based on when the complaint was opened (or last reopened), so raising severity shortens it, but a deadline is never set in the past.
      const base = c.openedAt;
      const due = slaDueAt(base, action.severity);
      return { ok: true, patch: { severity: action.severity, slaDueAt: due.getTime() < now.getTime() ? now : due } };
    }
    case "resolve":
      if (!LIVE.includes(c.status)) return no("BAD_STATE", "Only an open complaint can be resolved.");
      if (!action.resolutionCode?.trim() || !action.resolution?.trim()) return no("RESOLUTION_REQUIRED", "Give the resolution code and say what was done.");
      return { ok: true, patch: { status: "RESOLVED", resolvedAt: now, resolutionCode: action.resolutionCode.trim(), resolution: action.resolution.trim() } };
    case "close":
      if (c.status !== "RESOLVED") return no("BAD_STATE", "Only a resolved complaint can be closed.");
      return { ok: true, patch: { status: "CLOSED", closedAt: now } };
    case "reopen": {
      if (c.status !== "RESOLVED" && c.status !== "CLOSED") return no("BAD_STATE", "Only a resolved or closed complaint can be reopened.");
      if (!action.reason?.trim()) return no("REASON_REQUIRED", "Say why it is being reopened.");
      const since = c.resolvedAt ?? c.closedAt;
      if (since && now.getTime() - since.getTime() > REOPEN_WINDOW_DAYS * DAY) return no("REOPEN_WINDOW_PASSED", `Complaints can be reopened for ${REOPEN_WINDOW_DAYS} days after resolution. Register a new one.`);
      return { ok: true, patch: { status: "REOPENED", reopenedCount: c.reopenedCount + 1, lastReopenedAt: now, resolvedAt: null, closedAt: null, slaDueAt: slaDueAt(now, c.severity) } };
    }
  }
}

// ---- commitments ----------------------------------------------------------------------------------------------------------------------------
export type CommitmentLike = { status: CommitmentStatusName; dueAt: Date; keptAt: Date | null };
export type CommitmentState = "open" | "due_soon" | "overdue" | "kept" | "kept_late" | "broken" | "cancelled";

/** Overdue is derived, never stored: still OPEN and past its due date. */
export const isOverdueCommitment = (c: Pick<CommitmentLike, "status" | "dueAt">, now: Date): boolean => c.status === "OPEN" && c.dueAt.getTime() < now.getTime();

export function commitmentState(c: CommitmentLike, now: Date): CommitmentState {
  if (c.status === "KEPT") return c.keptAt && c.keptAt.getTime() > c.dueAt.getTime() ? "kept_late" : "kept";
  if (c.status === "BROKEN") return "broken";
  if (c.status === "CANCELLED") return "cancelled";
  if (isOverdueCommitment(c, now)) return "overdue";
  return c.dueAt.getTime() - now.getTime() <= DUE_SOON_HOURS * HOUR ? "due_soon" : "open";
}

export type CommitmentAction = { type: "keep"; actorId: string } | { type: "break"; actorId: string; note: string } | { type: "cancel"; actorId: string; note: string };

export function commitmentTransition(c: CommitmentLike, action: CommitmentAction, now: Date): ServiceResult {
  if (!isPerson(action.actorId)) return no("ACTOR_REQUIRED", "A named person must do this.");
  switch (action.type) {
    case "keep":
      if (c.status !== "OPEN" && c.status !== "BROKEN") return no("BAD_STATE", "This commitment is already settled.");
      return { ok: true, patch: { status: "KEPT", keptAt: now } };
    case "break":
      if (c.status !== "OPEN") return no("BAD_STATE", "Only an open commitment can be marked broken.");
      if (!action.note?.trim()) return no("NOTE_REQUIRED", "Say what happened.");
      return { ok: true, patch: { status: "BROKEN", brokenAt: now, outcomeNote: action.note.trim() } };
    case "cancel":
      if (c.status !== "OPEN") return no("BAD_STATE", "Only an open commitment can be cancelled.");
      if (!action.note?.trim()) return no("NOTE_REQUIRED", "Say why it is cancelled.");
      return { ok: true, patch: { status: "CANCELLED", cancelledAt: now, outcomeNote: action.note.trim() } };
  }
}
