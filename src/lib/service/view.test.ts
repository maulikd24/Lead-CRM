import { describe, expect, it } from "vitest";

import { buildListRows, buildServiceFacts, buildServiceStrip, type ComplaintRow, type CommitmentRow } from "./view";

const NOW = new Date("2027-06-30T10:00:00Z");
const h = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

let n = 0;
const complaint = (over: Partial<ComplaintRow> = {}): ComplaintRow => ({
  id: `c${++n}`, clientId: "k1", title: "Delayed withdrawal", severity: "MEDIUM", status: "OPEN", ownerId: "rm1", openedAt: h(-10), acknowledgedAt: null, slaDueAt: h(62), resolvedAt: null, closedAt: null, reopenedCount: 0, taskId: null, supportTicketId: null, insightId: null, reviewId: null, updatedAt: h(-1), ...over,
});
const commitment = (over: Partial<CommitmentRow> = {}): CommitmentRow => ({
  id: `m${++n}`, clientId: "k1", text: "Send the statement", dueAt: h(48), status: "OPEN", promisedByType: "RM", promisedById: "rm1", promisedToType: "CUSTOMER", ownerId: "rm1", confirmedAt: h(-5), keptAt: null, taskId: null, insightId: null, ...over,
});

describe("the Service strip on Customer 360", () => {
  it("is honestly empty when there is nothing", () => {
    const s = buildServiceStrip([], [], NOW);
    expect(s.empty).toBe(true);
    expect(s.headline).toBe("No open complaints or overdue promises");
  });
  it("counts live complaints (including reopened), breached SLAs and overdue confirmed commitments", () => {
    const s = buildServiceStrip(
      [complaint(), complaint({ status: "REOPENED", slaDueAt: h(-3), reopenedCount: 1 }), complaint({ status: "RESOLVED", resolvedAt: h(-2) })],
      [commitment({ dueAt: h(-2) }), commitment({ dueAt: h(30) }), commitment({ dueAt: h(-2), status: "KEPT", keptAt: h(-1) })],
      NOW,
    );
    expect(s).toMatchObject({ openComplaints: 2, breached: 1, overdueCommitments: 1, openCommitments: 2, empty: false });
    expect(s.headline).toBe("2 open complaints, 1 overdue promise");
    expect(s.tone).toBe("critical");
  });
  it("a suggested (unaccepted) commitment is not overdue and is shown as a suggestion", () => {
    const s = buildServiceStrip([], [commitment({ dueAt: h(-50), confirmedAt: null })], NOW);
    expect(s.overdueCommitments).toBe(0);
    expect(s.suggestedCommitments).toBe(1);
    expect(s.tone).toBe("calm");
  });
  it("tone: critical on a breach or an overdue promise, watch for an at-risk or open case, calm otherwise", () => {
    expect(buildServiceStrip([complaint({ slaDueAt: h(5), openedAt: h(-65) })], [], NOW).tone).toBe("watch");
    expect(buildServiceStrip([complaint()], [], NOW).tone).toBe("watch");
    expect(buildServiceStrip([complaint({ slaDueAt: h(-1) })], [], NOW).tone).toBe("critical");
  });
  it("complaint rows carry the SLA state and the acknowledgement state", () => {
    const s = buildServiceStrip([complaint({ openedAt: h(-30), slaDueAt: h(-1) })], [], NOW);
    expect(s.complaints[0]).toMatchObject({ slaState: "breached", ackState: "overdue", reopened: false });
  });
});

describe("the RM / manager list", () => {
  it("puts breached complaints first, then by deadline; overdue commitments by how late they are", () => {
    const rows = buildListRows(
      [complaint({ id: "a", slaDueAt: h(10) }), complaint({ id: "b", slaDueAt: h(-5) }), complaint({ id: "c", slaDueAt: h(-1), severity: "CRITICAL" }), complaint({ id: "d", status: "CLOSED", resolvedAt: h(-1) })],
      [commitment({ id: "x", dueAt: h(-2) }), commitment({ id: "y", dueAt: h(-20) }), commitment({ id: "z", dueAt: h(5) })],
      NOW,
    );
    expect(rows.complaints.map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(rows.commitments.map((r) => r.id)).toEqual(["y", "x"]);
  });
  it("shows only live complaints and overdue confirmed commitments", () => {
    const rows = buildListRows([complaint({ status: "RESOLVED", resolvedAt: h(-1) })], [commitment({ dueAt: h(5) }), commitment({ dueAt: h(-5), confirmedAt: null })], NOW);
    expect(rows.complaints).toEqual([]);
    expect(rows.commitments).toEqual([]);
  });
});

describe("buildServiceFacts: what other modules (decision engine, attention) read", () => {
  it("reports open complaint and overdue commitment facts with an as-of, and no free text", () => {
    const f = buildServiceFacts([complaint({ title: "secret title", severity: "HIGH" })], [commitment({ dueAt: h(-2), text: "secret promise" })], NOW);
    expect(f).toMatchObject({ hasOpenComplaint: true, highestOpenSeverity: "HIGH", overdueCommitmentCount: 1 });
    expect(f.asOf).toEqual(NOW);
    expect(JSON.stringify(f)).not.toContain("secret");
  });
  it("has no open complaint when all are resolved or closed", () => {
    expect(buildServiceFacts([complaint({ status: "CLOSED", resolvedAt: h(-1) })], [], NOW)).toMatchObject({ hasOpenComplaint: false, highestOpenSeverity: null, overdueCommitmentCount: 0 });
  });
});
