import { DEFAULT_ASSUMPTIONS } from "./progress";

export const GOAL_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export const GOAL_STATUSES = ["ACTIVE", "ACHIEVED", "PAUSED", "ARCHIVED"] as const;
export type GoalPriorityValue = (typeof GOAL_PRIORITIES)[number];
export type GoalStatusValue = (typeof GOAL_STATUSES)[number];

export type GoalInput = {
  name: string;
  targetAmount: number;
  targetDate: Date;
  priority: GoalPriorityValue;
  status: GoalStatusValue;
  annualRatePct: number | null;
  plannedMonthly: number | null;
  notes: string | null;
  /** Whole trading accounts whose holdings count towards the goal (read-only references). */
  linkedAccountIds: string[];
  /** Single holdings, as "accountId:productId" (read-only references). */
  linkedHoldingKeys: string[];
};

export type GoalParse = { ok: true; value: GoalInput } | { ok: false; errors: Record<string, string> };

const MAX_AMOUNT = 1e12;
const MAX_LINKS = 50;
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const toNumber = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

export function parseRef(key: string): { accountId: string; productId: string } | null {
  const i = key.indexOf(":");
  if (i <= 0 || i === key.length - 1 || key.indexOf(":", i + 1) !== -1) return null;
  return { accountId: key.slice(0, i), productId: key.slice(i + 1) };
}

const unique = (xs: unknown[]): string[] => [...new Set(xs.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()))];

/** Reads and checks what the goal form sends. Field problems come back in plain words, keyed by field. */
export function parseGoalInput(raw: Record<string, unknown>, now: Date, opts: { allowPast?: boolean } = {}): GoalParse {
  const errors: Record<string, string> = {};

  const name = text(raw.name);
  if (!name) errors.name = "Give the goal a name.";
  else if (name.length > 80) errors.name = "The name can be at most 80 characters.";

  const targetAmount = toNumber(raw.targetAmount);
  if (!Number.isFinite(targetAmount) || targetAmount <= 0) errors.targetAmount = "Enter a target amount above zero.";
  else if (targetAmount > MAX_AMOUNT) errors.targetAmount = "That target amount is too large.";

  const date = typeof raw.targetDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw.targetDate) ? new Date(raw.targetDate) : raw.targetDate instanceof Date ? raw.targetDate : null;
  if (!date || Number.isNaN(date.getTime())) errors.targetDate = "Pick a valid target date.";
  else if (!opts.allowPast && date.getTime() <= now.getTime()) errors.targetDate = "The target date has to be in the future.";

  const priority = text(raw.priority) || "MEDIUM";
  if (!(GOAL_PRIORITIES as readonly string[]).includes(priority)) errors.priority = "Choose Low, Medium or High priority.";

  const status = text(raw.status) || "ACTIVE";
  if (!(GOAL_STATUSES as readonly string[]).includes(status)) errors.status = "Choose a valid status.";

  let annualRatePct: number | null = null;
  if (!blank(raw.annualRatePct)) {
    const rate = toNumber(raw.annualRatePct);
    if (!Number.isFinite(rate) || rate < DEFAULT_ASSUMPTIONS.minRatePct || rate > DEFAULT_ASSUMPTIONS.maxRatePct) errors.annualRatePct = `The assumed rate has to be between ${DEFAULT_ASSUMPTIONS.minRatePct} and ${DEFAULT_ASSUMPTIONS.maxRatePct} percent a year.`;
    else annualRatePct = rate;
  }

  let plannedMonthly: number | null = null;
  if (!blank(raw.plannedMonthly)) {
    const m = toNumber(raw.plannedMonthly);
    if (!Number.isFinite(m) || m < 0 || m > MAX_AMOUNT) errors.plannedMonthly = "The monthly amount cannot be negative.";
    else plannedMonthly = m;
  }

  const notesText = text(raw.notes);
  if (notesText.length > 500) errors.notes = "Notes can be at most 500 characters.";

  const linkedAccountIds = unique(Array.isArray(raw.linkedAccountIds) ? raw.linkedAccountIds : []);
  const linkedHoldingKeys = unique(Array.isArray(raw.linkedHoldingKeys) ? raw.linkedHoldingKeys : []);
  if (linkedAccountIds.length > MAX_LINKS || linkedHoldingKeys.length > MAX_LINKS) errors.links = `Link at most ${MAX_LINKS} accounts and ${MAX_LINKS} holdings.`;
  if (linkedHoldingKeys.some((k) => parseRef(k) === null)) errors.links = "A linked holding is not in the expected form.";

  if (Object.keys(errors).length > 0 || !date) return { ok: false, errors };
  return { ok: true, value: { name, targetAmount, targetDate: date, priority: priority as GoalPriorityValue, status: status as GoalStatusValue, annualRatePct, plannedMonthly, notes: notesText || null, linkedAccountIds, linkedHoldingKeys } };
}

/** Only the customer's own RM (and an admin) may change goals; managers see them. Same rule as approving a draft for that customer. */
export function mayEditGoals(role: string, userId: string, assignedToId: string | null): boolean {
  return role === "ADMIN" || (role === "RM" && assignedToId !== null && assignedToId === userId);
}
