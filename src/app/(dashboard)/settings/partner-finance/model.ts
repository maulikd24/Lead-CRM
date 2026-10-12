import { describeOverrideRule, type OverrideRule } from "@/lib/partners/overrides/rules";
import { describeRule, type TaxRule } from "@/lib/partners/tax/rules";

/** Pure view models for the Partner finance settings page. */
export const PARTNER_FINANCE_TABS = [
  { key: "tax", label: "Tax rules" },
  { key: "overrides", label: "Overrides" },
  { key: "statements", label: "Statements" },
  { key: "referrals", label: "Referrals" },
  { key: "approve", label: "To approve" },
] as const;
export type FinanceTab = (typeof PARTNER_FINANCE_TABS)[number]["key"];
export const parseFinanceTab = (v: string | string[] | undefined): FinanceTab => {
  const t = Array.isArray(v) ? v[0] : v;
  return PARTNER_FINANCE_TABS.some((x) => x.key === t) ? (t as FinanceTab) : "tax";
};

type Dated = { effectiveFrom: string; effectiveTo: string | null };
export type RuleStatus = "Active" | "Scheduled" | "Ended";

export function ruleStatus(r: Dated, now: Date): RuleStatus {
  const t = now.getTime();
  if (Date.parse(r.effectiveFrom) > t) return "Scheduled";
  if (r.effectiveTo !== null && Date.parse(r.effectiveTo) <= t) return "Ended";
  return "Active";
}

const IST = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const day = (iso: string) => IST.format(new Date(iso));
const inr = (amount: string) => `₹${new Intl.NumberFormat("en-IN").format(Number(amount))}`;
const ORDER: Record<RuleStatus, number> = { Active: 0, Scheduled: 1, Ended: 2 };
const TYPE_WORD: Record<string, string> = { PARTNER: "Partner", AFFILIATE: "Affiliate", DISTRIBUTOR: "Distributor" };

function reachOf(r: TaxRule): string {
  const parts = [r.partnerTypes.length ? r.partnerTypes.map((t) => TYPE_WORD[t] ?? t).join(" or ") : "Every partner type"];
  if (r.panStatus === "PRESENT") parts.push("with a PAN on file");
  if (r.panStatus === "ABSENT") parts.push("without a PAN on file");
  if (r.gstRegistration === "REGISTERED") parts.push("GST registered");
  if (r.gstRegistration === "UNREGISTERED") parts.push("not GST registered");
  return parts.join(", ");
}

const GST_MODE: Record<string, string> = { REVERSE_CHARGE: "Reverse charge", SELF_INVOICE: "Self-invoice", PARTNER_INVOICED: "Partner invoices" };

export function taxRuleRows(rules: TaxRule[], now: Date) {
  return rules
    .map((r) => {
      const status = ruleStatus(r, now);
      return {
        id: r.id,
        kind: r.kind,
        label: r.label,
        rate: `${Number(r.ratePercent)}%`,
        threshold: r.thresholdAmount ? inr(r.thresholdAmount) : "None",
        treatment: r.gstMode ? GST_MODE[r.gstMode] : null,
        reach: reachOf(r),
        from: day(r.effectiveFrom),
        to: r.effectiveTo ? day(r.effectiveTo) : "No end date",
        status,
        canChange: status !== "Ended",
        text: describeRule(r),
        rule: r,
      };
    })
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.kind.localeCompare(b.kind) || a.from.localeCompare(b.from));
}

export function overrideRuleRows(rules: OverrideRule[], now: Date) {
  return rules
    .map((r) => {
      const status = ruleStatus(r, now);
      return { id: r.id, level: r.level, rate: `${Number(r.ratePercent)}%`, cap: r.capPerAccrual ? inr(r.capPerAccrual) : "No cap", from: day(r.effectiveFrom), to: r.effectiveTo ? day(r.effectiveTo) : "No end date", status, canChange: status !== "Ended", text: describeOverrideRule(r), rule: r };
    })
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.level - b.level);
}

type Pending = { id: string; actionType: string; reason: string | null; requestedAt: Date; requestedById: string; requestedBy: { name: string } };

export function buildPendingRows(requests: Pending[], viewerId: string) {
  return requests.map((r) => ({
    id: r.id,
    kind: r.actionType === "PARTNER_OVERRIDE_RULE_CHANGE" ? "Override rule" : "Tax rule",
    summary: r.reason ?? "A rule change",
    by: r.requestedBy.name,
    when: `${IST.format(r.requestedAt)}`,
    canDecide: r.requestedById !== viewerId,
    blockedReason: r.requestedById === viewerId ? "A different person has to approve this. You proposed it." : null,
  }));
}

