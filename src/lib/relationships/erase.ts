import type { prisma } from "@/lib/db/prisma";
import { eraseEventTraces } from "@/lib/events/erase";

import { RELATIONSHIPS, delegateOf, whereForClients, type RelationshipEntry } from "./registry";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type Delegate = { count: (a: unknown) => Promise<number>; deleteMany: (a: unknown) => Promise<{ count: number }> };
const delegate = (tx: Tx, model: string): Delegate => (tx as unknown as Record<string, Delegate>)[delegateOf(model)];

const flag = (env: Record<string, string | undefined> = process.env) => env.RELATIONSHIP_REGISTRY_ERASURE === "1";
/** Erasure is driven from the relationship registry only when RELATIONSHIP_REGISTRY_ERASURE is exactly "1"; otherwise the original steps run. */
export const registryErasureEnabled = flag;

type Step =
  | { phase: "block"; order: number; entry: RelationshipEntry; onlyInvested: boolean; message: string }
  | { phase: "delete"; order: number; entry: RelationshipEntry }
  | { phase: "handler"; order: number; entry: RelationshipEntry };

/** The erasure plan, derived from the registry. Exported so the tests can read it. */
export function erasurePlan(entries: readonly RelationshipEntry[] = RELATIONSHIPS): Step[] {
  const steps: Step[] = [];
  for (const entry of entries) {
    const e = entry.erase;
    if (e.kind === "block") steps.push({ phase: "block", order: e.order, entry, onlyInvested: false, message: e.message });
    else if (e.kind === "block_then_delete") {
      steps.push({ phase: "block", order: e.blockOrder, entry, onlyInvested: true, message: e.message });
      steps.push({ phase: "delete", order: e.deleteOrder, entry });
    } else if (e.kind === "delete") steps.push({ phase: "delete", order: e.order, entry });
    else if (e.kind === "handler") steps.push({ phase: "handler", order: e.order, entry });
  }
  return steps.sort((a, b) => a.order - b.order || a.phase.localeCompare(b.phase));
}

/** Same rule and the same messages as the original: a financial or regulatory trail on the customer or a merged duplicate blocks the erasure. */
export async function registryAssertErasable(tx: Tx, ids: string[]): Promise<void> {
  for (const step of erasurePlan()) {
    if (step.phase !== "block") continue;
    const where = whereForClients(step.entry.paths, ids);
    // A PMS/AIF holding that was actually invested or redeemed is a financial record; NOT_INVESTED placeholders are deleted below.
    const count = await delegate(tx, step.entry.model).count({ where: step.onlyInvested ? { ...where, status: { not: "NOT_INVESTED" } } : where });
    if (count > 0) throw new Error(step.message);
  }
}

/** Deletes every row of every registry table in dependency order. The customer row itself is deleted by the caller afterwards. */
export async function registryDeleteChildren(tx: Tx, ids: string[]): Promise<void> {
  for (const step of erasurePlan()) {
    if (step.phase === "delete") {
      const paths = [...step.entry.paths, ...(step.entry.extraErasePaths ?? [])];
      await delegate(tx, step.entry.model).deleteMany({ where: whereForClients(paths, ids) });
    } else if (step.phase === "handler") {
      // One shared helper covers the three event tables (they have the same order); run it once.
      if (step.entry.model === "CustomerEvent") await eraseEventTraces(tx, ids);
    }
  }
}
