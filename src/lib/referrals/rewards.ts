import type { ReferralEventType } from "./state-machine";

/** Reward maths in whole paise (integers), so there is no floating-point money anywhere. */
export type RuleSpec = {
  id: string;
  event: ReferralEventType;
  kind: "FIXED" | "PERCENT";
  fixedPaise: number | null;
  percentBps: number | null;
  maxRewardPaise: number | null;
  capPerReferrerMonthPaise: number | null;
  validFrom: Date | null;
  validTo: Date | null;
  active: boolean;
};

export function ruleApplies(rule: RuleSpec, event: { type: ReferralEventType; occurredAt: Date }): boolean {
  if (!rule.active || rule.event !== event.type) return false;
  const t = event.occurredAt.getTime();
  if (rule.validFrom && t < rule.validFrom.getTime()) return false;
  if (rule.validTo && t > rule.validTo.getTime()) return false;
  return true;
}

export function computeReward(rule: RuleSpec, ctx: { eventAmountPaise: number; accruedThisMonthPaise: number }): { amountPaise: number; capped: boolean } {
  let amount = 0;
  if (rule.kind === "FIXED") amount = rule.fixedPaise !== null && rule.fixedPaise > 0 ? rule.fixedPaise : 0;
  else if (rule.percentBps !== null && rule.percentBps > 0) amount = Math.floor((Math.max(0, ctx.eventAmountPaise) * rule.percentBps) / 10_000);
  const uncapped = amount;
  if (rule.maxRewardPaise !== null && amount > rule.maxRewardPaise) amount = rule.maxRewardPaise;
  if (rule.capPerReferrerMonthPaise !== null) amount = Math.min(amount, Math.max(0, rule.capPerReferrerMonthPaise - ctx.accruedThisMonthPaise));
  return { amountPaise: amount, capped: amount < uncapped };
}

const IST_MS = 330 * 60_000;
/** The reporting month ("YYYY-MM") in India time. */
export function monthKeyIST(date: Date): string {
  const d = new Date(date.getTime() + IST_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type RuleFormInput = { name: string; event: string; kind: string; amountRupees: string; maxRewardRupees: string; capPerMonthRupees: string; validFrom: string; validTo: string };
export type RuleValue = Omit<RuleSpec, "id" | "active"> & { name: string };

const toPaise = (raw: string): number | null | "bad" => {
  const t = raw.trim();
  if (!t) return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return "bad";
  return Math.round(Number(t) * 100);
};
const toDate = (raw: string): Date | null | "bad" => {
  const t = raw.trim();
  if (!t) return null;
  const d = new Date(`${t.length === 10 ? t + "T00:00:00+05:30" : t}`);
  return Number.isNaN(d.getTime()) ? "bad" : d;
};

/** Validates the admin form. A percent rule applies to a funding amount only, in 0.01% steps up to 100%. */
export function validateRuleInput(i: RuleFormInput): { ok: true; value: RuleValue } | { ok: false; error: string } {
  const name = i.name.trim();
  if (!name || name.length > 80) return { ok: false, error: "Give the rule a name (up to 80 characters)." };
  if (i.event !== "SIGNED_UP" && i.event !== "KYC_COMPLETE" && i.event !== "FIRST_FUNDING") return { ok: false, error: "Choose which event the rule pays on." };
  if (i.kind !== "FIXED" && i.kind !== "PERCENT") return { ok: false, error: "Choose a fixed amount or a percentage." };
  if (i.kind === "PERCENT" && i.event !== "FIRST_FUNDING") return { ok: false, error: "A percentage needs an amount to take it from: use it on First funding only." };
  const amount = toPaise(i.amountRupees);
  if (amount === null || amount === "bad" || amount <= 0) return { ok: false, error: i.kind === "FIXED" ? "Enter the reward amount in rupees." : "Enter the percentage." };
  let fixedPaise: number | null = null;
  let percentBps: number | null = null;
  if (i.kind === "FIXED") fixedPaise = amount;
  else {
    if (amount > 10_000) return { ok: false, error: "A percentage cannot be more than 100." };
    percentBps = amount;
  }
  const max = toPaise(i.maxRewardRupees);
  const cap = toPaise(i.capPerMonthRupees);
  if (max === "bad" || cap === "bad") return { ok: false, error: "Caps must be amounts in rupees." };
  const from = toDate(i.validFrom);
  const to = toDate(i.validTo);
  if (from === "bad" || to === "bad") return { ok: false, error: "Dates must look like 2027-01-31." };
  if (from && to && to.getTime() < from.getTime()) return { ok: false, error: "The end date is before the start date." };
  return { ok: true, value: { name, event: i.event, kind: i.kind, fixedPaise, percentBps, maxRewardPaise: max, capPerReferrerMonthPaise: cap, validFrom: from, validTo: to } };
}
