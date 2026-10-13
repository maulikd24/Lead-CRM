import { describe, expect, it } from "vitest";

import { buildFunnelPanel, buildOpportunitiesPanel, buildQualityPanel, buildTeamPanel, pct } from "./management-panels";

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
  it("reads dormant and cross-sell counts from segments, and drops programmes with no customers", () => {
    const p = buildOpportunitiesPanel(
      {
        highPriority: { total: 4 },
        segments: [
          { key: "dormant", count: 9 },
          { key: "cross_sell", count: 2 },
          { key: "unfunded", count: 5 },
        ],
        programmes: [
          { programme: "Fund account", count: 0 },
          { programme: "MF / SIP opportunity", count: 6 },
        ],
        reviewDue: { total: 3 },
      },
      NOW,
    );
    expect(p).toMatchObject({ highPriority: { total: 4 }, dormant: 9, crossSell: 2, portfolioReviewDue: { total: 3 } });
    expect(p.programmes).toEqual([{ programme: "MF / SIP opportunity", count: 6 }]);
  });
  it("carries no customer rows, only counts", () => {
    const p = buildOpportunitiesPanel({ highPriority: { total: 2 }, segments: [], programmes: [], reviewDue: { total: 1 } }, NOW);
    expect(JSON.stringify(p)).not.toMatch(/"rows"|"name"|"code"/);
  });
  it("a missing segment reads as zero", () => {
    const p = buildOpportunitiesPanel({ highPriority: { total: 0 }, segments: [], programmes: [], reviewDue: { total: 0 } }, NOW);
    expect(p).toMatchObject({ dormant: 0, crossSell: 0 });
  });
  it("shows at most eight programmes", () => {
    const programmes = Array.from({ length: 12 }, (_, i) => ({ programme: `P${i}`, count: i + 1 }));
    const p = buildOpportunitiesPanel({ highPriority: { total: 0 }, segments: [], programmes, reviewDue: { total: 0 } }, NOW);
    expect(p.programmes).toHaveLength(8);
  });
});

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
    const p = buildQualityPanel({ byCategory, bySeverity }, NOW);
    expect(p.tiles).toEqual({ complaints: 4, auditFailures: 3, missedCommitments: 4, complianceFlags: 2 });
    expect(p.openTotal).toBe(18);
    expect(p.otherOpen).toBe(5);
    expect(p.bySeverity).toEqual({ HIGH: 6, MEDIUM: 0, LOW: 4 });
    expect(p.source).toMatch(/AuditFinding/);
  });

  it("lists categories by open count, largest first, with no finding text", () => {
    const p = buildQualityPanel({ byCategory, bySeverity }, NOW);
    expect(p.categories[0]).toEqual({ category: "MISSED_OPPORTUNITY", open: 5 });
    expect(p.categories.map((c) => c.open)).toEqual([5, 4, 3, 2, 2, 1, 1]);
    expect(JSON.stringify(p)).not.toMatch(/summary|clientId|"client"/);
  });

  it("no findings reads as zero everywhere", () => {
    const p = buildQualityPanel({ byCategory: [], bySeverity: [] }, NOW);
    expect(p).toMatchObject({ openTotal: 0, otherOpen: 0, categories: [] });
    expect(p.tiles).toEqual({ complaints: 0, auditFailures: 0, missedCommitments: 0, complianceFlags: 0 });
  });
});
