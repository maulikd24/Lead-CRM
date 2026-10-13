/**
 * Aggregation for the four management panels (bible section 10): Funnel, Team, Opportunities, Quality. Pure: each builder takes
 * rows that the read models in management.ts already returned, plus the as-of time, and returns the view the page renders.
 * No database, no network. Every panel names its data source and carries its as-of time.
 */

/** A ratio over a base. Null when the base is zero or missing, never Infinity or NaN. */
export function pct(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export type FunnelTotals = { leads: number; kyc: number; funded: number; activated: number };
export type FunnelSourceRow = FunnelTotals & { label: string };

export type FunnelPanel = {
  asOf: string;
  source: string;
  totals: FunnelTotals;
  /** Share of leads that reached each stage. Null when there are no leads. */
  shareOfLeads: { kyc: number | null; funded: number | null; activated: number | null };
  bySource: Array<FunnelSourceRow & { kycPct: number | null; fundedPct: number | null; activatedPct: number | null }>;
};

export const FUNNEL_SOURCE = "Client, KycRecord, FundingRecord, ClientPayment, TradingAccount (intelligence/management.ts getFunnel)";

export function buildFunnelPanel(input: { totals: FunnelTotals; bySource: FunnelSourceRow[] }, asOf: Date): FunnelPanel {
  const { totals } = input;
  return {
    asOf: asOf.toISOString(),
    source: FUNNEL_SOURCE,
    totals,
    shareOfLeads: { kyc: pct(totals.kyc, totals.leads), funded: pct(totals.funded, totals.leads), activated: pct(totals.activated, totals.leads) },
    bySource: input.bySource.map((s) => ({ ...s, kycPct: pct(s.kyc, s.leads), fundedPct: pct(s.funded, s.leads), activatedPct: pct(s.activated, s.leads) })),
  };
}

export type RmFollowupRow = { rm: string; open: number; overdue: number };

export type TeamPanel = {
  asOf: string;
  source: string;
  /** Open follow-ups (pending or overdue) across the team. */
  pendingFollowUps: number;
  overdueFollowUps: number;
  rmsWithOverdue: number;
  unassignedCustomers: number;
  rms: Array<RmFollowupRow & { pending: number }>;
};

export const TEAM_SOURCE = "Task (PENDING, OVERDUE), Client.assignedToId (intelligence/management.ts getTeamFollowups)";

export function buildTeamPanel(input: { rms: RmFollowupRow[]; unassigned: number }, asOf: Date): TeamPanel {
  const rms = [...input.rms].sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.rm.localeCompare(b.rm));
  return {
    asOf: asOf.toISOString(),
    source: TEAM_SOURCE,
    pendingFollowUps: rms.reduce((n, r) => n + r.open, 0),
    overdueFollowUps: rms.reduce((n, r) => n + r.overdue, 0),
    rmsWithOverdue: rms.filter((r) => r.overdue > 0).length,
    unassignedCustomers: input.unassigned,
    rms: rms.map((r) => ({ ...r, pending: Math.max(0, r.open - r.overdue) })),
  };
}

/** Aggregates only: the management view never carries a customer name, code or RM-by-customer row (see gate.ts). */
export type OpportunitiesPanel = {
  asOf: string;
  source: string;
  highPriority: { total: number };
  dormant: number;
  crossSell: number;
  portfolioReviewDue: { total: number };
  programmes: Array<{ programme: string; count: number }>;
};

export const OPPORTUNITIES_SOURCE = "CustomerIntelligence (nbaPriority, nbaProgramme), SegmentMembership (dormant, cross_sell, review_due)";

export function buildOpportunitiesPanel(
  input: {
    highPriority: { total: number };
    segments: Array<{ key: string; count: number }>;
    programmes: Array<{ programme: string; count: number }>;
    reviewDue: { total: number };
  },
  asOf: Date,
): OpportunitiesPanel {
  const count = (key: string) => input.segments.find((s) => s.key === key)?.count ?? 0;
  return {
    asOf: asOf.toISOString(),
    source: OPPORTUNITIES_SOURCE,
    highPriority: { total: input.highPriority.total },
    dormant: count("dormant"),
    crossSell: count("cross_sell"),
    portfolioReviewDue: { total: input.reviewDue.total },
    programmes: input.programmes.filter((p) => p.count > 0).slice(0, 8),
  };
}

export const QUALITY_TILES = {
  complaints: ["CUSTOMER_DISSATISFACTION"],
  auditFailures: ["POOR_CONVERSATION", "INCORRECT_COMMUNICATION"],
  missedCommitments: ["MISSED_FOLLOW_UP", "COMMITMENT_NOT_COMPLETED"],
  complianceFlags: ["POTENTIAL_COMPLIANCE_ISSUE"],
} as const;

export type QualityPanel = {
  asOf: string;
  source: string;
  openTotal: number;
  tiles: Record<keyof typeof QUALITY_TILES, number>;
  /** Open findings in categories the tiles do not name (for example missed opportunities). */
  otherOpen: number;
  bySeverity: Record<"HIGH" | "MEDIUM" | "LOW", number>;
  /** Open count per category, largest first. Counts only. */
  categories: Array<{ category: string; open: number }>;
};

export const QUALITY_SOURCE = "AuditFinding (status OPEN, for customers in scope)";

export function buildQualityPanel(input: { byCategory: Array<{ category: string; open: number }>; bySeverity: Array<{ severity: string; open: number }> }, asOf: Date): QualityPanel {
  const open = (categories: readonly string[]) => input.byCategory.filter((g) => categories.includes(g.category)).reduce((n, g) => n + g.open, 0);
  const tiles = {
    complaints: open(QUALITY_TILES.complaints),
    auditFailures: open(QUALITY_TILES.auditFailures),
    missedCommitments: open(QUALITY_TILES.missedCommitments),
    complianceFlags: open(QUALITY_TILES.complianceFlags),
  };
  const openTotal = input.byCategory.reduce((n, g) => n + g.open, 0);
  const named = Object.values(QUALITY_TILES).flat();
  const severity = (level: "HIGH" | "MEDIUM" | "LOW") => input.bySeverity.find((s) => s.severity === level)?.open ?? 0;
  return {
    asOf: asOf.toISOString(),
    source: QUALITY_SOURCE,
    openTotal,
    tiles,
    otherOpen: openTotal - input.byCategory.filter((g) => named.includes(g.category as never)).reduce((n, g) => n + g.open, 0),
    bySeverity: { HIGH: severity("HIGH"), MEDIUM: severity("MEDIUM"), LOW: severity("LOW") },
    categories: [...input.byCategory].filter((g) => g.open > 0).sort((a, b) => b.open - a.open || a.category.localeCompare(b.category)),
  };
}
