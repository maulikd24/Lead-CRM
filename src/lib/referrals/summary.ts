import { accrualStates, type AccrualState, type LedgerEntry } from "./ledger";

type Bucket = { paise: number; count: number };
export type LedgerSummary = { accrued: Bucket; needsReview: Bucket; approved: Bucket; paid: Bucket; reversed: Bucket };

const KEY: Record<AccrualState, keyof LedgerSummary> = { ACCRUED: "accrued", NEEDS_REVIEW: "needsReview", APPROVED: "approved", PAID: "paid", REVERSED: "reversed" };

export function summarizeLedger(entries: LedgerEntry[]): LedgerSummary {
  const out: LedgerSummary = { accrued: { paise: 0, count: 0 }, needsReview: { paise: 0, count: 0 }, approved: { paise: 0, count: 0 }, paid: { paise: 0, count: 0 }, reversed: { paise: 0, count: 0 } };
  const states = accrualStates(entries);
  for (const e of entries) {
    if (e.kind !== "ACCRUED") continue;
    const b = out[KEY[states.get(e.id)!]];
    b.paise += e.amountPaise;
    b.count += 1;
  }
  return out;
}

export type FunnelStep = { key: "referrals" | "kyc" | "funded"; label: string; value: number; fromPrevious: number | null; widthPct: number };

export function funnelSteps(c: { referrals: number; kyc: number; funded: number }): FunnelStep[] {
  const rows: [FunnelStep["key"], string, number][] = [["referrals", "Signed up with a code", c.referrals], ["kyc", "KYC complete", c.kyc], ["funded", "First funding", c.funded]];
  return rows.map(([key, label, value], i) => ({ key, label, value, fromPrevious: i === 0 ? null : rows[i - 1][2] > 0 ? value / rows[i - 1][2] : 0, widthPct: c.referrals > 0 ? (value / c.referrals) * 100 : 0 }));
}

export function weeklyBuckets(dates: Date[], now: Date, weeks: number): number[] {
  const out = new Array<number>(weeks).fill(0);
  const WEEK = 7 * 86_400_000;
  for (const d of dates) {
    const age = now.getTime() - d.getTime();
    if (age < 0 || age >= weeks * WEEK) continue;
    out[weeks - 1 - Math.floor(age / WEEK)] += 1;
  }
  return out;
}

const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
export function formatRupees(paise: number): string {
  const rupees = paise / 100;
  return `₹${INR.format(rupees).replace(/^(-?[\d,]+\.\d)$/, "$10")}`;
}
