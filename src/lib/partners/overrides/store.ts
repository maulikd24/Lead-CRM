import type { Actor } from "@/lib/policy/types";
import { createRuleStore, type RuleStoreDb } from "../rule-store";
import type { RuleChange } from "../rule-plan";
import { trimDecimal } from "../tax/store";
import { planOverrideRuleChange, type OverrideRule } from "./rules";

type Dec = { toFixed(): string };
type OverrideRow = { id: string; level: number; ratePercent: Dec; capPerAccrual: Dec | null; effectiveFrom: Date; effectiveTo: Date | null };

export type OverrideStoreDb = RuleStoreDb & {
  partnerOverrideRule: {
    findMany(a?: { orderBy?: unknown }): Promise<OverrideRow[]>;
    create(a: { data: Record<string, unknown> }): Promise<{ id: string }>;
    update(a: { where: { id: string }; data: { effectiveTo: Date } }): Promise<unknown>;
  };
};

export function toOverrideRule(r: OverrideRow): OverrideRule {
  return {
    id: r.id,
    level: r.level,
    ratePercent: trimDecimal(r.ratePercent.toFixed()),
    capPerAccrual: r.capPerAccrual === null ? null : trimDecimal(r.capPerAccrual.toFixed()),
    effectiveFrom: r.effectiveFrom.toISOString(),
    effectiveTo: r.effectiveTo ? r.effectiveTo.toISOString() : null,
  };
}

export async function loadOverrideRules(db: Pick<OverrideStoreDb, "partnerOverrideRule">): Promise<OverrideRule[]> {
  const rows = await db.partnerOverrideRule.findMany({ orderBy: [{ level: "asc" }, { effectiveFrom: "asc" }, { id: "asc" }] });
  return rows.map(toOverrideRule);
}

const store = createRuleStore<OverrideRule, Omit<OverrideRule, "id">, OverrideStoreDb>({
  entity: "PartnerOverrideRule",
  actionType: "PARTNER_OVERRIDE_RULE_CHANGE",
  auditPrefix: "partner_override_rule",
  delegate: (db) => db.partnerOverrideRule,
  load: loadOverrideRules,
  plan: planOverrideRuleChange,
  createData: (r) => ({ level: r.level, ratePercent: r.ratePercent, capPerAccrual: r.capPerAccrual, effectiveFrom: new Date(r.effectiveFrom), effectiveTo: r.effectiveTo ? new Date(r.effectiveTo) : null }),
});

export const proposeOverrideRuleChange = (deps: { db: OverrideStoreDb; request: Parameters<typeof store.propose>[0]["request"] }, actor: Actor, change: RuleChange, now: Date) => store.propose(deps, actor, change, now);
export const checkOverrideRuleChange = store.check;
export const applyOverrideRuleChange = store.apply;
