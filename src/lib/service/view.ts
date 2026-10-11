import { ageLabel } from "@/lib/freshness/stale";

import { ackState, commitmentState, isOverdueCommitment, slaState, type CommitmentState, type ComplaintSeverityName, type ComplaintStatusName, type CommitmentStatusName, type SlaState } from "./rules";

export type ComplaintRow = {
  id: string; clientId: string; title: string; severity: ComplaintSeverityName; status: ComplaintStatusName; ownerId: string | null; openedAt: Date; acknowledgedAt: Date | null;
  slaDueAt: Date; resolvedAt: Date | null; closedAt: Date | null; reopenedCount: number; taskId: string | null; supportTicketId: string | null; insightId: string | null; reviewId: string | null; updatedAt: Date;
};
export type CommitmentRow = {
  id: string; clientId: string; text: string; dueAt: Date; status: CommitmentStatusName; promisedByType: string; promisedById: string | null; promisedToType: string; ownerId: string | null;
  confirmedAt: Date | null; keptAt: Date | null; taskId: string | null; insightId: string | null;
};

const LIVE: readonly ComplaintStatusName[] = ["OPEN", "IN_PROGRESS", "REOPENED"];
const SEVERITY_RANK: Record<ComplaintSeverityName, number> = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };

export type ComplaintView = {
  id: string; clientId: string; title: string; severity: ComplaintSeverityName; status: ComplaintStatusName; ownerId: string | null;
  slaState: SlaState; ackState: "done" | "pending" | "overdue"; reopened: boolean; reopenedCount: number; openedAgo: string; slaDueAt: string; hasTask: boolean;
};
export type CommitmentView = { id: string; clientId: string; text: string; dueAt: string; state: CommitmentState; promisedByType: string; ownerId: string | null; overdueBy: string | null; suggested: boolean; hasTask: boolean };

const complaintView = (c: ComplaintRow, now: Date): ComplaintView => ({
  id: c.id, clientId: c.clientId, title: c.title, severity: c.severity, status: c.status, ownerId: c.ownerId, slaState: slaState(c, now), ackState: ackState(c, now),
  reopened: c.reopenedCount > 0, reopenedCount: c.reopenedCount, openedAgo: ageLabel(c.openedAt, now), slaDueAt: c.slaDueAt.toISOString(), hasTask: !!c.taskId,
});
const commitmentView = (m: CommitmentRow, now: Date): CommitmentView => ({
  id: m.id, clientId: m.clientId, text: m.text, dueAt: m.dueAt.toISOString(), state: commitmentState(m, now), promisedByType: m.promisedByType, ownerId: m.ownerId,
  overdueBy: m.confirmedAt && isOverdueCommitment(m, now) ? ageLabel(m.dueAt, now).replace(" ago", "") : null, suggested: !m.confirmedAt, hasTask: !!m.taskId,
});

export type ServiceStrip = {
  empty: boolean;
  headline: string;
  tone: "calm" | "watch" | "critical";
  openComplaints: number; breached: number; overdueCommitments: number; openCommitments: number; suggestedCommitments: number;
  complaints: ComplaintView[]; commitments: CommitmentView[];
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The small Service strip on Customer 360: what is open, what is late, in one line, with the cases behind it. */
export function buildServiceStrip(complaints: readonly ComplaintRow[], commitments: readonly CommitmentRow[], now: Date): ServiceStrip {
  const live = complaints.filter((c) => LIVE.includes(c.status));
  const confirmedOpen = commitments.filter((m) => m.status === "OPEN" && m.confirmedAt);
  const overdue = confirmedOpen.filter((m) => isOverdueCommitment(m, now));
  const suggested = commitments.filter((m) => m.status === "OPEN" && !m.confirmedAt);
  const breached = live.filter((c) => slaState(c, now) === "breached").length;
  const atRisk = live.filter((c) => slaState(c, now) === "at_risk").length;
  const parts = [live.length ? plural(live.length, "open complaint") : null, overdue.length ? plural(overdue.length, "overdue promise") : null].filter(Boolean);
  const tone = breached > 0 || overdue.length > 0 ? "critical" : live.length > 0 || atRisk > 0 ? "watch" : "calm";
  return {
    empty: live.length === 0 && confirmedOpen.length === 0 && suggested.length === 0,
    headline: parts.length ? parts.join(", ") : "No open complaints or overdue promises",
    tone,
    openComplaints: live.length, breached, overdueCommitments: overdue.length, openCommitments: confirmedOpen.length, suggestedCommitments: suggested.length,
    complaints: live.map((c) => complaintView(c, now)).sort((a, b) => rankSla(a) - rankSla(b)),
    commitments: [...confirmedOpen, ...suggested].map((m) => commitmentView(m, now)).sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
  };
}

const rankSla = (c: ComplaintView) => ({ breached: 0, at_risk: 1, ok: 2, met: 3, missed: 3 })[c.slaState];

/** The manager / RM list: live complaints (breached first, then by deadline) and overdue confirmed commitments (latest-running first). */
export function buildListRows(complaints: readonly ComplaintRow[], commitments: readonly CommitmentRow[], now: Date): { complaints: ComplaintView[]; commitments: CommitmentView[] } {
  const live = complaints.filter((c) => LIVE.includes(c.status));
  const rows = live
    .map((c) => ({ c, v: complaintView(c, now) }))
    .sort((a, b) => rankSla(a.v) - rankSla(b.v) || a.c.slaDueAt.getTime() - b.c.slaDueAt.getTime() || SEVERITY_RANK[b.c.severity] - SEVERITY_RANK[a.c.severity])
    .map((x) => x.v);
  const overdue = commitments
    .filter((m) => m.confirmedAt && isOverdueCommitment(m, now))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
    .map((m) => commitmentView(m, now));
  return { complaints: rows, commitments: overdue };
}

/** What other modules read (decision-engine suppression, attention). Facts and counts only: no title, no text, no names. */
export type ServiceFacts = { asOf: Date; hasOpenComplaint: boolean; highestOpenSeverity: ComplaintSeverityName | null; openComplaintCount: number; breachedComplaintCount: number; overdueCommitmentCount: number };

export function buildServiceFacts(complaints: readonly ComplaintRow[], commitments: readonly CommitmentRow[], now: Date): ServiceFacts {
  const live = complaints.filter((c) => LIVE.includes(c.status));
  const top = live.reduce<ComplaintSeverityName | null>((m, c) => (m === null || SEVERITY_RANK[c.severity] > SEVERITY_RANK[m] ? c.severity : m), null);
  return {
    asOf: now,
    hasOpenComplaint: live.length > 0,
    highestOpenSeverity: top,
    openComplaintCount: live.length,
    breachedComplaintCount: live.filter((c) => slaState(c, now) === "breached").length,
    overdueCommitmentCount: commitments.filter((m) => m.confirmedAt && isOverdueCommitment(m, now)).length,
  };
}
