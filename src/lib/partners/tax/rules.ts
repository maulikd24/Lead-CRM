import { parseRate } from "../native/money";

/**
 * Tax rules for partner statements. Pure: no database, no clock. Every value comes from a rule Finance typed and a second
 * person approved; this file has no default rate, no default threshold and no default section.
 */
export type TaxKind = "TDS" | "GST";
export type PanStatus = "ANY" | "PRESENT" | "ABSENT";
export type GstRegistration = "ANY" | "REGISTERED" | "UNREGISTERED";
export type GstMode = "REVERSE_CHARGE" | "SELF_INVOICE" | "PARTNER_INVOICED";

export const PARTNER_TYPES = ["PARTNER", "AFFILIATE", "DISTRIBUTOR"] as const;
const PAN_STATUSES: PanStatus[] = ["ANY", "PRESENT", "ABSENT"];
const GST_REGISTRATIONS: GstRegistration[] = ["ANY", "REGISTERED", "UNREGISTERED"];
export const GST_MODES: GstMode[] = ["REVERSE_CHARGE", "SELF_INVOICE", "PARTNER_INVOICED"];

export type TaxRule = {
  id: string;
  kind: TaxKind;
  label: string;
  /** Percentage as typed, at most four decimals ("10", "3.75"). */
  ratePercent: string;
  /** TDS only: the amount in a financial year up to which nothing is deducted, in rupees (at most two decimals). */
  thresholdAmount: string | null;
  /** Empty means every partner type. */
  partnerTypes: string[];
  panStatus: PanStatus;
  gstRegistration: GstRegistration;
  gstMode: GstMode | null;
  /** ISO instants. effectiveFrom is inclusive, effectiveTo exclusive. */
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type PartnerTaxFacts = { partnerType: string; hasPan: boolean; hasGstin: boolean };

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const AMOUNT = /^\d{1,13}(\.\d{1,2})?$/;

function readDate(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const t = v.trim();
  // A bare date means midnight India time, the day the rule starts for the people who typed it.
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(t) ? Date.parse(`${t}T00:00:00.000Z`) - IST_OFFSET_MS : Date.parse(t);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export type RuleValidation = { ok: true; rule: Omit<TaxRule, "id"> } | { ok: false; errors: string[] };

/** Checks a rule typed in Settings. Returns the normalised rule or every reason it was refused. A missing value is never defaulted. */
export function validateTaxRule(input: Record<string, unknown>): RuleValidation {
  const errors: string[] = [];
  const kind = input.kind === "TDS" || input.kind === "GST" ? input.kind : null;
  if (!kind) errors.push("Choose TDS or GST.");

  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (!label) errors.push("Give the rule a label (for TDS, the section as it should print).");
  if (label.length > 80) errors.push("The label is too long (80 characters at most).");

  let ratePercent = "";
  try {
    ratePercent = typeof input.ratePercent === "string" ? input.ratePercent.trim() : "";
    parseRate(ratePercent);
  } catch {
    errors.push("Type the rate as a percentage with at most four decimals, from 0 to 100. There is no default rate.");
  }

  let thresholdAmount: string | null = null;
  const th = typeof input.thresholdAmount === "string" ? input.thresholdAmount.trim() : "";
  if (th) {
    if (!AMOUNT.test(th)) errors.push("The threshold must be an amount in rupees with at most two decimals.");
    else thresholdAmount = th;
  }

  const partnerTypes = Array.isArray(input.partnerTypes) ? input.partnerTypes.map(String) : [];
  if (partnerTypes.some((t) => !(PARTNER_TYPES as readonly string[]).includes(t))) errors.push("Unknown partner type.");

  const panStatus = (input.panStatus ?? "ANY") as PanStatus;
  if (!PAN_STATUSES.includes(panStatus)) errors.push("Unknown PAN status.");
  const gstRegistration = (input.gstRegistration ?? "ANY") as GstRegistration;
  if (!GST_REGISTRATIONS.includes(gstRegistration)) errors.push("Unknown GST registration status.");

  const gstModeRaw = input.gstMode === undefined || input.gstMode === null || input.gstMode === "" ? null : (input.gstMode as GstMode);
  if (gstModeRaw !== null && !GST_MODES.includes(gstModeRaw)) errors.push("Unknown GST treatment.");
  if (kind === "GST") {
    if (gstModeRaw === null) errors.push("Choose how GST is handled: reverse charge, self-invoice or the partner invoices.");
    if (thresholdAmount !== null) errors.push("A GST rule has no threshold.");
    if (panStatus !== "ANY") errors.push("A GST rule does not use PAN status.");
  }
  if (kind === "TDS") {
    if (gstModeRaw !== null) errors.push("A TDS rule has no GST treatment.");
    if (gstRegistration !== "ANY") errors.push("A TDS rule does not use GST registration.");
  }

  const effectiveFrom = readDate(input.effectiveFrom);
  if (!effectiveFrom) errors.push("Give the date the rule starts.");
  const endRaw = input.effectiveTo;
  const effectiveTo = endRaw === undefined || endRaw === null || endRaw === "" ? null : readDate(endRaw);
  if (endRaw !== undefined && endRaw !== null && endRaw !== "" && !effectiveTo) errors.push("The end date is not a date.");
  if (effectiveFrom && effectiveTo && Date.parse(effectiveTo) <= Date.parse(effectiveFrom)) errors.push("The end date must be after the start date.");

  if (errors.length || !kind || !effectiveFrom) return { ok: false, errors };
  return { ok: true, rule: { kind, label, ratePercent, thresholdAmount, partnerTypes, panStatus, gstRegistration, gstMode: gstModeRaw, effectiveFrom, effectiveTo } };
}

function activeAt(rule: Pick<TaxRule, "effectiveFrom" | "effectiveTo">, at: Date): boolean {
  const t = at.getTime();
  return Date.parse(rule.effectiveFrom) <= t && (rule.effectiveTo === null || t < Date.parse(rule.effectiveTo));
}

const specificity = (r: TaxRule): number => (r.partnerTypes.length > 0 ? 1 : 0) + (r.panStatus !== "ANY" ? 1 : 0) + (r.gstRegistration !== "ANY" ? 1 : 0);

function matches(r: TaxRule, f: PartnerTaxFacts): boolean {
  if (r.partnerTypes.length > 0 && !r.partnerTypes.includes(f.partnerType)) return false;
  if (r.panStatus === "PRESENT" && !f.hasPan) return false;
  if (r.panStatus === "ABSENT" && f.hasPan) return false;
  if (r.gstRegistration === "REGISTERED" && !f.hasGstin) return false;
  if (r.gstRegistration === "UNREGISTERED" && f.hasGstin) return false;
  return true;
}

export type RulePick = { status: "none" } | { status: "rule"; rule: TaxRule } | { status: "conflict"; ruleIds: string[] };

/**
 * The one rule of a kind that applies to a partner on a date. The most specific matching rule wins; two equally specific
 * matches are a conflict, and a conflict deducts nothing (the statement says so) until Finance resolves it.
 */
export function pickRule(rules: TaxRule[], kind: TaxKind, facts: PartnerTaxFacts, at: Date): RulePick {
  const hits = rules.filter((r) => r.kind === kind && activeAt(r, at) && matches(r, facts));
  if (hits.length === 0) return { status: "none" };
  const top = Math.max(...hits.map(specificity));
  const best = hits.filter((r) => specificity(r) === top);
  if (best.length > 1) return { status: "conflict", ruleIds: best.map((r) => r.id).sort() };
  return { status: "rule", rule: best[0] };
}

const intersects = (a: string[], b: string[]) => a.length === 0 || b.length === 0 || a.some((x) => b.includes(x));
const compatible = (a: string, b: string) => a === "ANY" || b === "ANY" || a === b;

/** The id of an existing rule that a new one would collide with (same kind, overlapping dates, overlapping partners, equally specific), or null. */
export function findOverlap(existing: TaxRule[], candidate: TaxRule, ignoreId?: string): string | null {
  const cs = Date.parse(candidate.effectiveFrom);
  const ce = candidate.effectiveTo === null ? Infinity : Date.parse(candidate.effectiveTo);
  for (const r of existing) {
    if (r.id === ignoreId || r.id === candidate.id || r.kind !== candidate.kind) continue;
    const rs = Date.parse(r.effectiveFrom);
    const re = r.effectiveTo === null ? Infinity : Date.parse(r.effectiveTo);
    if (!(cs < re && rs < ce)) continue;
    if (!intersects(r.partnerTypes, candidate.partnerTypes) || !compatible(r.panStatus, candidate.panStatus) || !compatible(r.gstRegistration, candidate.gstRegistration)) continue;
    if (specificity(r) !== specificity(candidate)) continue;
    return r.id;
  }
  return null;
}

const TYPE_WORD: Record<string, string> = { PARTNER: "Partner", AFFILIATE: "Affiliate", DISTRIBUTOR: "Distributor" };
const day = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(iso));
const rupees = (amount: string) => {
  const [whole, frac] = amount.split(".");
  return `₹${new Intl.NumberFormat("en-IN").format(Number(whole))}${frac && Number(frac) > 0 ? `.${frac}` : ""}`;
};

const GST_WORDS: Record<GstMode, string> = {
  REVERSE_CHARGE: "reverse charge: the firm pays the tax and it is not taken from you",
  SELF_INVOICE: "self-invoice: the firm raises the invoice and pays the tax, it is not taken from you",
  PARTNER_INVOICED: "the partner invoices: the tax is added to what you are paid",
};

/** The exact rule in words, as printed on a statement: label, rate, threshold, who it covers and since when. */
export function describeRule(r: TaxRule): string {
  const types = r.partnerTypes.length ? r.partnerTypes.map((t) => TYPE_WORD[t] ?? t).join(" or ") : "every partner";
  const quals: string[] = [];
  if (r.panStatus === "PRESENT") quals.push("with a PAN on file");
  if (r.panStatus === "ABSENT") quals.push("without a PAN on file");
  if (r.gstRegistration === "REGISTERED") quals.push("who is GST registered");
  if (r.gstRegistration === "UNREGISTERED") quals.push("who is not GST registered");
  const rate = `${Number(r.ratePercent)}%`;
  const parts: string[] = [];
  if (r.kind === "TDS") {
    parts.push(`${r.label}: ${rate} ${r.thresholdAmount ? `on the financial year's total once it passes ${rupees(r.thresholdAmount)}` : "with no threshold"}`);
  } else {
    parts.push(`${r.label}: ${rate}, ${r.gstMode ? GST_WORDS[r.gstMode] : ""}`);
  }
  parts.push(`Applies to ${[types, ...quals].join(" ")}`);
  parts.push(`Effective ${day(r.effectiveFrom)}${r.effectiveTo ? ` until ${day(r.effectiveTo)} (that day not included)` : ""}`);
  return parts.join(". ");
}
