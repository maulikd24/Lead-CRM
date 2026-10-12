export type KeyDatesInput = { signedUpAt: Date; kycCompletedAt: Date | null; firstFundedAt: Date | null; firstTransactionAt: Date | null };
export type KeyDateStep = { key: "signup" | "kyc" | "funding" | "transaction"; label: string; date: string | null; state: "done" | "current" | "pending"; elapsed?: string; waiting?: string };
export type KeyDates = { steps: KeyDateStep[]; fillPct: number };

const DAY = 86_400_000;
const days = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY));

/** The customer's activation path as a mini progress track. A later date counts even if an earlier one is missing. */
export function buildKeyDates(input: KeyDatesInput, now: Date): KeyDates {
  const defs: { key: KeyDateStep["key"]; label: string; date: Date | null }[] = [
    { key: "signup", label: "Signed up", date: input.signedUpAt },
    { key: "kyc", label: "KYC approved", date: input.kycCompletedAt },
    { key: "funding", label: "First funding", date: input.firstFundedAt },
    { key: "transaction", label: "First transaction", date: input.firstTransactionAt },
  ];
  const firstOpen = defs.findIndex((d) => !d.date);
  let lastDoneDate: Date | null = null;
  let lastDone = -1;
  const steps = defs.map((d, i): KeyDateStep => {
    if (d.date) {
      const step: KeyDateStep = { key: d.key, label: d.label, date: d.date.toISOString(), state: "done" };
      if (lastDoneDate) step.elapsed = `+${days(lastDoneDate, d.date)}d`;
      lastDoneDate = d.date;
      lastDone = i;
      return step;
    }
    if (i === firstOpen) {
      return { key: d.key, label: d.label, date: null, state: "current", ...(lastDoneDate ? { waiting: `${days(lastDoneDate, now)}d waiting` } : {}) };
    }
    return { key: d.key, label: d.label, date: null, state: "pending" };
  });
  return { steps, fillPct: lastDone <= 0 ? 0 : (lastDone / (defs.length - 1)) * 100 };
}
