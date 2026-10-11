import type { AutopilotSnapshot, LeadRecord } from "./types";

/**
 * Marketing staff see how campaigns perform, not who the customers are. Lead rows already carry no name, phone,
 * email, PAN or id; this also blurs what could single a person out: the exact arrival minute, the exact first-contact
 * time, and per-person AUM and revenue, which become coarse bands. Totals stay approximately right.
 */

/** Roughly 1.5x apart, so a band represents its members within about 20%. */
const AUM_BANDS = [25_000, 50_000, 1_00_000, 2_00_000, 3_00_000, 5_00_000, 8_00_000, 12_00_000, 20_00_000, 35_00_000, 60_00_000, 1_00_00_000];
const bandValue = (x: number, bands: number[]): number => {
  if (x <= 0) return 0;
  let lower = bands[0] / 1.6;
  for (const b of bands) { if (x < b) return Math.round(Math.sqrt(lower * b)); lower = b; }
  return lower;
};

export function pseudonymizeLead(l: LeadRecord): LeadRecord {
  const arrived = new Date(Date.parse(l.arrivedAt));
  arrived.setUTCMinutes(0, 0, 0);
  return {
    ...l,
    arrivedAt: arrived.toISOString(),
    contactMinutes: l.contactMinutes === null ? null : Math.round(l.contactMinutes / 5) * 5,
    aum: bandValue(l.aum, AUM_BANDS),
    revenue: bandValue(l.revenue, [250, 500, 1_000, 2_000, 4_000, 8_000, 16_000, 32_000]),
  };
}

export function pseudonymize(s: AutopilotSnapshot): AutopilotSnapshot {
  return { ...s, leads: s.leads.map(pseudonymizeLead) };
}
