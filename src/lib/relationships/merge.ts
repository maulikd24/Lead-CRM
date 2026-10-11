import type { prisma } from "@/lib/db/prisma";

import { RELATIONSHIPS, delegateOf } from "./registry";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type Delegate = {
  updateMany: (a: unknown) => Promise<{ count: number }>;
  update: (a: unknown) => Promise<unknown>;
  count: (a: unknown) => Promise<number>;
  findUnique: (a: unknown) => Promise<unknown | null>;
};
const delegate = (tx: Tx, model: string): Delegate => (tx as unknown as Record<string, Delegate>)[delegateOf(model)];

/** Merge is driven from the relationship registry only when RELATIONSHIP_REGISTRY_MERGE is exactly "1"; otherwise the original statements run. */
export const registryMergeEnabled = (env: Record<string, string | undefined> = process.env): boolean => env.RELATIONSHIP_REGISTRY_MERGE === "1";

/** Tables whose rows are re-pointed unconditionally. */
export const reparentedModels = (): string[] => RELATIONSHIPS.filter((r) => r.merge.kind === "reparent").map((r) => r.model);

/** Re-points every `reparent` table's rows of the duplicate to the survivor (the same statements as the original, one per registry table). */
export async function registryReparent(tx: Tx, primaryId: string, duplicateId: string): Promise<void> {
  for (const r of RELATIONSHIPS) {
    if (r.merge.kind !== "reparent") continue;
    if (r.merge.onlyIfAny && (await delegate(tx, r.model).count({ where: { clientId: duplicateId, ...r.merge.onlyIfAny } })) === 0) continue;
    await delegate(tx, r.model).updateMany({ where: { clientId: duplicateId }, data: { clientId: primaryId } });
  }
}

/**
 * The conditional moves, in registry order: a table with at most one row per customer moves only when the survivor has none (`reparent_if_absent`),
 * KYC steps only when the survivor has no steps at all. Otherwise the row stays on the archived record and its name is returned as a conflict.
 */
export async function registryReparentConditional(tx: Tx, primaryId: string, duplicateId: string): Promise<string[]> {
  const conflicts: string[] = [];
  for (const r of RELATIONSHIPS) {
    const d = delegate(tx, r.model);
    if (r.merge.kind === "reparent_if_survivor_has_none") {
      if ((await d.count({ where: { clientId: duplicateId } })) > 0) {
        if ((await d.count({ where: { clientId: primaryId } })) === 0) await d.updateMany({ where: { clientId: duplicateId }, data: { clientId: primaryId } });
        else conflicts.push(r.merge.conflict);
      }
    } else if (r.merge.kind === "reparent_if_absent") {
      if (await d.findUnique({ where: { clientId: duplicateId } })) {
        if (!(await d.findUnique({ where: { clientId: primaryId } }))) await d.update({ where: { clientId: duplicateId }, data: { clientId: primaryId } });
        else conflicts.push(r.merge.conflict);
      }
    }
  }
  return conflicts;
}
