import type { Actor } from "@/lib/policy/types";
import { createRuleStore, type RuleStoreDb } from "../rule-store";
import type { RuleChange } from "../rule-plan";
import { planTaxRuleChange } from "./plan";
import type { TaxRule } from "./rules";

type Dec = { toFixed(): string };
type TaxRow = {
  id: string;
  kind: string;
  label: string;
  ratePercent: Dec;
  thresholdAmount: Dec | null;
  partnerTypes: string[];
  panStatus: string;
  gstRegistration: string;
  gstMode: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

/** The narrow slice of Prisma this module uses, so every path is tested with a fake. */
export type TaxStoreDb = RuleStoreDb & {
  partnerTaxRule: {
    findMany(a?: { orderBy?: unknown }): Promise<TaxRow[]>;
    create(a: { data: Record<string, unknown> }): Promise<{ id: string }>;
    update(a: { where: { id: string }; data: { effectiveTo: Date } }): Promise<unknown>;
  };
};

/** "10.0000" becomes "10", "100.50" becomes "100.5": the form the maths and the rule text use. */
export const trimDecimal = (d: string) => (d.includes(".") ? d.replace(/\.?0+$/, "") : d);

export function toTaxRule(r: TaxRow): TaxRule {
  return {
    id: r.id,
    kind: r.kind as TaxRule["kind"],
    label: r.label,
    ratePercent: trimDecimal(r.ratePercent.toFixed()),
    thresholdAmount: r.thresholdAmount === null ? null : trimDecimal(r.thresholdAmount.toFixed()),
    partnerTypes: r.partnerTypes,
    panStatus: r.panStatus as TaxRule["panStatus"],
    gstRegistration: r.gstRegistration as TaxRule["gstRegistration"],
    gstMode: r.gstMode as TaxRule["gstMode"],
    effectiveFrom: r.effectiveFrom.toISOString(),
    effectiveTo: r.effectiveTo ? r.effectiveTo.toISOString() : null,
  };
}

/** Every configured tax rule. There are only ever a handful, so this is read whole. */
export async function loadTaxRules(db: Pick<TaxStoreDb, "partnerTaxRule">): Promise<TaxRule[]> {
  const rows = await db.partnerTaxRule.findMany({ orderBy: [{ kind: "asc" }, { effectiveFrom: "asc" }, { id: "asc" }] });
  return rows.map(toTaxRule);
}

const store = createRuleStore<TaxRule, Omit<TaxRule, "id">, TaxStoreDb>({
  entity: "PartnerTaxRule",
  actionType: "PARTNER_TAX_RULE_CHANGE",
  auditPrefix: "partner_tax_rule",
  delegate: (db) => db.partnerTaxRule,
  load: loadTaxRules,
  plan: planTaxRuleChange,
  createData: (r) => ({
    kind: r.kind,
    label: r.label,
    ratePercent: r.ratePercent,
    thresholdAmount: r.thresholdAmount,
    partnerTypes: r.partnerTypes,
    panStatus: r.panStatus,
    gstRegistration: r.gstRegistration,
    gstMode: r.gstMode,
    effectiveFrom: new Date(r.effectiveFrom),
    effectiveTo: r.effectiveTo ? new Date(r.effectiveTo) : null,
  }),
});

export type { ProposeResult } from "../rule-store";

/** Files a tax rule change for approval by a different person. Nothing changes until it is approved. */
export const proposeTaxRuleChange = (deps: { db: TaxStoreDb; request: Parameters<typeof store.propose>[0]["request"] }, actor: Actor, change: RuleChange, now: Date) => store.propose(deps, actor, change, now);
export const checkTaxRuleChange = store.check;
export const applyTaxRuleChange = store.apply;
