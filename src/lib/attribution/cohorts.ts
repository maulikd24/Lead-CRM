import { isPseudonymousViewer, seesExactFigures } from "@/lib/access/pseudonym";

import type { ImpactClient } from "./impact";

/**
 * Lead cohorts: the customer-level FACTS a marketing engine needs to analyse timing and regions (when a lead arrived, how fast a person reached
 * it, whether it was KYC-approved or funded, what it earned, where it lives), WITHOUT who the customer is. There is no id, name, phone, email,
 * RM or any key that leads back to a person. The funded, KYC, contact and revenue facts are the ones the Campaign impact tab counts: one
 * definition. Prisma-free: the mapping and the blur live here, the database side is impact-db.ts (includeClients).
 *
 * Who gets what: a signed-in ADMIN sees exact arrival and contact times and exact AUM and revenue. Everyone else, and every system reader
 * (a scheduled job's output reaches MARKETING), gets the blurred form: arrival to the hour, first contact to five minutes, AUM and revenue
 * as coarse bands about 1.6x apart, so a person cannot be singled out while totals stay roughly right.
 */
export type LeadCohortRow = {
  /** The provider's campaign key (e.g. "meta:123"), or null when the lead is not credited to a campaign. */
  campaignKey: string | null;
  channel: "meta" | "google" | null;
  /** ISO instant the lead arrived (to the hour when blurred). */
  arrivedAt: string;
  /** Minutes until a person of ours first reached the lead; null when nobody has. */
  firstContactMinutes: number | null;
  kyc: boolean;
  funded: boolean;
  /** Net revenue to date, INR. */
  revenue: number;
  /** Assets under management today, INR. */
  aum: number;
  city: string | null;
  state: string | null;
};

export type LeadCohortQuery = { period: { from: string; to: string }; channel?: "meta" | "google" };

export type LeadCohortReport = {
  provider: string;
  period: { from: string; to: string };
  /** true: arrival, contact, AUM and revenue are coarse bands (everyone but a signed-in ADMIN). */
  blurred: boolean;
  rows: LeadCohortRow[];
  truncated: boolean;
  notes: string[];
};

const AUM_BANDS = [25_000, 50_000, 1_00_000, 2_00_000, 3_00_000, 5_00_000, 8_00_000, 12_00_000, 20_00_000, 35_00_000, 60_00_000, 1_00_00_000];
const REVENUE_BANDS = [250, 500, 1_000, 2_000, 4_000, 8_000, 16_000, 32_000];

/** Rounds a value to the geometric middle of its band, so a band stands for its members within about 20%. */
export function bandValue(x: number, bands: readonly number[]): number {
  if (!(x > 0)) return 0;
  let lower = bands[0] / 1.6;
  for (const b of bands) {
    if (x < b) return Math.round(Math.sqrt(lower * b));
    lower = b;
  }
  return lower;
}

export function blurCohortRow(r: LeadCohortRow): LeadCohortRow {
  const arrived = new Date(Date.parse(r.arrivedAt));
  arrived.setUTCMinutes(0, 0, 0);
  return {
    ...r,
    arrivedAt: arrived.toISOString(),
    firstContactMinutes: r.firstContactMinutes === null ? null : Math.round(r.firstContactMinutes / 5) * 5,
    aum: bandValue(r.aum, AUM_BANDS),
    revenue: bandValue(r.revenue, REVENUE_BANDS),
  };
}

/** Only a signed-in ADMIN is shown exact figures. Takes the caller as a plain shape so an unknown caller is blurred. */
export function cohortsAreBlurred(caller: { kind: "user"; role: string } | { kind: "system" }): boolean {
  return caller.kind === "system" || isPseudonymousViewer(caller.role) || !seesExactFigures(caller.role);
}

export function cohortRowOf(c: ImpactClient): LeadCohortRow {
  const campaign = c.group.kind === "campaign";
  const channel = campaign ? (c.group.key.startsWith("google:") ? "google" : c.group.key.startsWith("meta:") ? "meta" : null) : null;
  return {
    campaignKey: campaign ? c.group.key : null, channel,
    arrivedAt: c.createdAt.toISOString(), firstContactMinutes: c.firstContactMinutes,
    kyc: c.kycApproved, funded: c.funded, revenue: c.revenue, aum: c.aum ?? 0, city: c.city ?? null, state: c.state ?? null,
  };
}
