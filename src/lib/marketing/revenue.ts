/**
 * Revenue attributed to a customer. Only revenue earned from the customer's own activity counts: brokerage and
 * advisory fees. Trail and upfront commissions, AMC payouts and "other" are product-level income that is not tied to
 * what an ad brought in, so they are left out. A reversal row (it points at the event it reverses) always subtracts,
 * whichever sign it was stored with, and is counted only when the event it reverses was a counted type, so a fully
 * reversed event nets to zero and a partial reversal nets the difference.
 *
 * This is "lifetime revenue of the leads from the period", not revenue earned inside the period. It is shown as
 * indicative until Finance has confirmed the revenue model.
 */
export const INCLUDED_REVENUE_TYPES = ["BROKERAGE", "ADVISORY_FEE"] as const;

export type RevenueEventLite = {
  id: string;
  revenueType: string;
  amount: number;
  reversesEventId: string | null;
  /** Type of the event that this row reverses, when it is a reversal. */
  reversedType: string | null;
};

const counted = (type: string | null) => type !== null && (INCLUDED_REVENUE_TYPES as readonly string[]).includes(type);

export function netRevenue(events: RevenueEventLite[]): number {
  let total = 0;
  for (const e of events) {
    if (e.reversesEventId) {
      if (counted(e.reversedType)) total -= Math.abs(e.amount);
    } else if (counted(e.revenueType)) {
      total += e.amount;
    }
  }
  return Math.max(0, total);
}
