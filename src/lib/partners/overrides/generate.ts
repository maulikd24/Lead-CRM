import type { PrismaClient } from "@/generated/prisma/client";
import { ancestorsOf, computeOverrides, diffOverrides, type OverrideSource } from "./compute";
import { loadOverrideRules, type OverrideStoreDb } from "./store";

/**
 * Writes override accruals from the configured override rules: for each commission accrual of a sub-partner, an accrual for
 * the ancestor `level` steps above them (see compute.ts). It reuses CommissionAccrual additively: commissionRuleId stays null,
 * overrideRuleId / sourceAccrualId / overrideKey say where a line came from, and nothing about how ordinary accruals are computed
 * or paid changes. Idempotent (overrideKey is unique), and with no rules it reads one small table and stops.
 */
export type GenerateDb = Pick<PrismaClient, "commissionAccrual" | "partnerProfile"> & Pick<OverrideStoreDb, "partnerOverrideRule">;

export const OVERRIDE_COMPUTATION_VERSION = "override-v1";
const BATCH = 500;
const MAX_ANCESTRY_QUERIES = 6;

export type GenerateResult = { rules: number; sources: number; created: number; updated: number; unchanged: number };

export async function generateOverrideAccruals(db: GenerateDb): Promise<GenerateResult> {
  const rules = await loadOverrideRules(db);
  const result: GenerateResult = { rules: rules.length, sources: 0, created: 0, updated: 0, unchanged: 0 };
  if (rules.length === 0) return result;

  const maxLevel = Math.max(...rules.map((r) => r.level));
  const earliest = new Date(Math.min(...rules.map((r) => Date.parse(r.effectiveFrom))));
  const parentOf = new Map<string, string | null>();
  const statusOf = new Map<string, string>();

  /** Loads the partners and their ancestors up to maxLevel into the caches, one query per level. */
  async function loadAncestry(ids: string[]) {
    let frontier = ids.filter((id) => !parentOf.has(id));
    for (let i = 0; i <= Math.min(maxLevel, MAX_ANCESTRY_QUERIES) && frontier.length; i++) {
      const rows = await db.partnerProfile.findMany({ where: { id: { in: frontier } }, select: { id: true, parentPartnerProfileId: true, empanelmentStatus: true } });
      for (const r of rows) {
        parentOf.set(r.id, r.parentPartnerProfileId);
        statusOf.set(r.id, r.empanelmentStatus);
      }
      frontier = [...new Set(rows.map((r) => r.parentPartnerProfileId).filter((p): p is string => !!p && !parentOf.has(p)))];
    }
  }

  let cursor: string | undefined;
  for (;;) {
    const batch = await db.commissionAccrual.findMany({
      where: { overrideRuleId: null, status: { not: "REVERSED" }, accrualDate: { gte: earliest }, partnerProfile: { parentPartnerProfileId: { not: null } } },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, revenueEventId: true, partnerProfileId: true, accrualAmount: true, accrualDate: true },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    result.sources += batch.length;

    await loadAncestry([...new Set(batch.map((b) => b.partnerProfileId))]);
    const eventOf = new Map(batch.map((b) => [b.id, b.revenueEventId]));
    const computed = batch.flatMap((b) => {
      const ancestors = ancestorsOf(b.partnerProfileId, parentOf, maxLevel).map((id) => ({ id, status: statusOf.get(id) ?? "ACTIVE" }));
      const source: OverrideSource = { accrualId: b.id, partnerId: b.partnerProfileId, amount: b.accrualAmount.toFixed(), accrualDate: b.accrualDate.toISOString(), ancestors };
      return computeOverrides(source, rules);
    });
    if (computed.length) {
      const existing = await db.commissionAccrual.findMany({ where: { overrideKey: { in: computed.map((c) => c.key) } }, select: { overrideKey: true, accrualAmount: true, status: true } });
      const diff = diffOverrides(computed, existing.map((e) => ({ key: e.overrideKey as string, amount: e.accrualAmount.toFixed(), status: e.status })));
      if (diff.create.length) {
        const made = await db.commissionAccrual.createMany({
          skipDuplicates: true,
          data: diff.create.map((c) => ({
            revenueEventId: eventOf.get(c.sourceAccrualId) as string,
            partnerProfileId: c.partnerId,
            commissionRuleId: null,
            accrualAmount: c.amount,
            accrualDate: new Date(c.accrualDate),
            status: "ACCRUED" as const,
            computationVersion: OVERRIDE_COMPUTATION_VERSION,
            overrideRuleId: c.ruleId,
            sourceAccrualId: c.sourceAccrualId,
            overrideKey: c.key,
          })),
        });
        result.created += made.count;
      }
      for (const u of diff.update) {
        const r = await db.commissionAccrual.updateMany({ where: { overrideKey: u.key, status: "ACCRUED" }, data: { accrualAmount: u.amount } });
        result.updated += r.count;
      }
      result.unchanged += diff.unchanged;
    }
    if (batch.length < BATCH) break;
  }
  return result;
}
