import { describe, expect, it } from "vitest";

import type { AuditOpenRow } from "./management";
import { buildFunnelPanel, buildOpportunitiesPanel, buildQualityPanel, buildTeamPanel, pct, topOpenFindings } from "./management-panels";

const NOW = new Date("2026-10-13T09:30:00Z");

describe("pct", () => {
  it("is a percentage to one decimal place", () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(30, 60)).toBe(50);
  });
  it("is null with no base, never Infinity or NaN", () => {
    expect(pct(5, 0)).toBeNull();
    expect(pct(5, -1)).toBeNull();
    expect(pct(Number.NaN, 4)).toBeNull();
  });
});

describe("buildFunnelPanel", () => {
  it("shares of leads per stage, and conversion per source", () => {
    const p = buildFunnelPanel(
      {
        totals: { leads: 200, kyc: 50, funded: 20, activated: 0 },
        bySource: [
          { label: "Meta", leads: 150, kyc: 30, funded: 10, activated: 0 },
          { label: "Unknown", leads: 0, kyc: 0, funded: 0, activated: 0 },
        ],
      },
      NOW,
    );
    expect(p.shareOfLeads).toEqual({ kyc: 25, funded: 10, activated: 0 });
    expect(p.bySource[0]).toMatchObject({ label: "Meta", kycPct: 20, fundedPct: 6.7, activatedPct: 0 });
    expect(p.bySource[1]).toMatchObject({ kycPct: null, fundedPct: null, activatedPct: null });
    expect(p.asOf).toBe(NOW.toISOString());
    expect(p.source).toMatch(/Client/);
  });
  it("no leads gives no shares, not zeros dressed as data", () => {
    const p = buildFunnelPanel({ totals: { leads: 0, kyc: 0, funded: 0, activated: 0 }, bySource: [] }, NOW);
    expect(p.shareOfLeads).toEqual({ kyc: null, funded: null, activated: null });
  });
});

describe("buildTeamPanel", () => {
  it("totals pending and overdue, counts RMs with overdue, and orders the worst first", () => {
    const p = buildTeamPanel(
      {
        rms: [
          { rm: "Anil", open: 3, overdue: 0 },
          { rm: "Priya", open: 4, overdue: 3 },
          { rm: "Ravi", open: 5, overdue: 2 },
        ],
        unassigned: 7,
      },
      NOW,
    );
    expect(p.pendingFollowUps).toBe(12);
    expect(p.overdueFollowUps).toBe(5);
    expect(p.rmsWithOverdue).toBe(2);
    expect(p.unassignedCustomers).toBe(7);
    expect(p.rms.map((r) => r.rm)).toEqual(["Priya", "Ravi", "Anil"]);
    expect(p.rms[0].pending).toBe(1);
  });
  it("an empty team reads as zero", () => {
    const p = buildTeamPanel({ rms: [], unassigned: 0 }, NOW);
    expect(p).toMatchObject({ pendingFollowUps: 0, overdueFollowUps: 0, rmsWithOverdue: 0, rms: [] });
  });
});

describe("buildOpportunitiesPanel", () => {
  const row = { id: "c", name: "Vikram", code: "CL-9", rm: "Ravi", lifecycle: "Active", programme: "PMS / AIF opportunity", action: "Call", topic: null, priority: "High", timing: "This Week", reason: "" };
  it("reads dormant and cross-sell counts from segments, and drops programmes with no customers", () => {
    const p = buildOpportunitiesPanel(
      {
        highPriority: { total: 4, rows: [row] },
        segments: [
          { key: "dormant", count: 9 },
          { key: "cross_sell", count: 2 },
          { key: "unfunded", count: 5 },
        ],
        programmes: [
          { programme: "Fund account", count: 0 },
          { programme: "MF / SIP opportunity", count: 6 },
        ],
        reviewDue: { total: 3, rows: [] },
      },
      NOW,
    );
    expect(p).toMatchObject({ highPriority: { total: 4 }, dormant: 9, crossSell: 2, portfolioReviewDue: { total: 3 } });
    expect(p.programmes).toEqual([{ programme: "MF / SIP opportunity", count: 6 }]);
  });
  it("a missing segment reads as zero", () => {
    const p = buildOpportunitiesPanel({ highPriority: { total: 0, rows: [] }, segments: [], programmes: [], reviewDue: { total: 0, rows: [] } }, NOW);
    expect(p).toMatchObject({ dormant: 0, crossSell: 0 });
  });
  it("shows at most eight programmes", () => {
    const programmes = Array.from({ length: 12 }, (_, i) => ({ programme: `P${i}`, count: i + 1 }));
    const p = buildOpportunitiesPanel({ highPriority: { total: 0, rows: [] }, segments: [], programmes, reviewDue: { total: 0, rows: [] } }, NOW);
    expect(p.programmes).toHaveLength(8);
  });
});

function finding(over: Partial<AuditOpenRow> & { id: string }): AuditOpenRow {
  return { category: "MISSED_FOLLOW_UP", severity: "LOW", summary: "s", detectedAt: new Date("2026-10-01T00:00:00Z"), clientId: "c1", client: "Asha", rm: "Ravi", ...over };
}

describe("buildQualityPanel", () => {
  const byCategory = [
    { category: "CUSTOMER_DISSATISFACTION", open: 4 },
    { category: "POOR_CONVERSATION", open: 2 },
    { category: "INCORRECT_COMMUNICATION", open: 1 },
    { category: "MISSED_FOLLOW_UP", open: 3 },
    { category: "COMMITMENT_NOT_COMPLETED", open: 1 },
    { category: "POTENTIAL_COMPLIANCE_ISSUE", open: 2 },
    { category: "MISSED_OPPORTUNITY", open: 5 },
  ];
  const bySeverity = [
    { severity: "HIGH", open: 6 },
    { severity: "LOW", open: 4 },
  ];

  it("maps categories onto the four tiles and counts the rest separately", () => {
    const p = buildQualityPanel({ byCategory, bySeverity, openRows: [] }, NOW);
    expect(p.tiles).toEqual({ complaints: 4, auditFailures: 3, missedCommitments: 4, complianceFlags: 2 });
    expect(p.openTotal).toBe(18);
    expect(p.otherOpen).toBe(5);
    expect(p.bySeverity).toEqual({ HIGH: 6, MEDIUM: 0, LOW: 4 });
    expect(p.source).toMatch(/AuditFinding/);
  });

  it("no findings reads as zero everywhere", () => {
    const p = buildQualityPanel({ byCategory: [], bySeverity: [], openRows: [] }, NOW);
    expect(p).toMatchObject({ openTotal: 0, otherOpen: 0, topOpen: [] });
    expect(p.tiles).toEqual({ complaints: 0, auditFailures: 0, missedCommitments: 0, complianceFlags: 0 });
  });

  it("the top open items are highest severity first, then oldest first", () => {
    const rows = [
      finding({ id: "low-old", severity: "LOW", detectedAt: new Date("2026-09-01T00:00:00Z") }),
      finding({ id: "high-new", severity: "HIGH", detectedAt: new Date("2026-10-10T00:00:00Z") }),
      finding({ id: "high-old", severity: "HIGH", detectedAt: new Date("2026-09-20T00:00:00Z") }),
      finding({ id: "med", severity: "MEDIUM", detectedAt: new Date("2026-09-05T00:00:00Z") }),
    ];
    const p = buildQualityPanel({ byCategory, bySeverity, openRows: rows }, NOW, 3);
    expect(p.topOpen.map((f) => f.id)).toEqual(["high-old", "high-new", "med"]);
    expect(p.topOpen[0].detectedAt).toBe("2026-09-20T00:00:00.000Z");
  });

  it("a finding with no customer keeps a null customer, not a made-up name", () => {
    const [item] = topOpenFindings([finding({ id: "x", clientId: null, client: null, rm: null })]);
    expect(item).toMatchObject({ clientId: null, client: null, rm: null });
  });

  it("the top list is capped at the limit", () => {
    const rows = Array.from({ length: 20 }, (_, i) => finding({ id: `f${i}` }));
    expect(topOpenFindings(rows)).toHaveLength(8);
  });
});
