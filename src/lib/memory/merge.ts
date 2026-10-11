import type { prisma } from "@/lib/db/prisma";

import { audit, type MemoryActor } from "./store";
import { resolvedState, sameValue, type MemoryConfirmationName } from "./rules";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

type Lite = { id: string; class: string; key: string; value: unknown; confirmation: string; freshUntil: Date | null };

/** Groups of live item ids (same key) whose values disagree. Pure. */
export function conflictingGroups(items: readonly Lite[], now: Date): string[][] {
  const live = items.filter((i) => {
    const s = resolvedState({ confirmation: i.confirmation as MemoryConfirmationName, freshUntil: i.freshUntil }, now);
    return s === "UNCONFIRMED" || s === "CONFIRMED" || s === "DISPUTED";
  });
  const byKey = new Map<string, Lite[]>();
  for (const i of live) byKey.set(i.key, [...(byKey.get(i.key) ?? []), i]);
  const groups: string[][] = [];
  for (const list of byKey.values()) {
    if (list.length > 1 && list.some((a) => list.some((b) => !sameValue(a.value, b.value)))) groups.push(list.map((i) => i.id));
  }
  return groups;
}

/**
 * Run inside the merge transaction after the duplicate's items are re-pointed to the survivor. Items for the same key that now
 * disagree become DISPUTED (a person settles it); nothing is overwritten and nothing is dropped.
 */
export async function disputeConflictsAfterMerge(tx: Tx, clientId: string, actorId: string, now: Date = new Date()): Promise<number> {
  const items = await tx.customerMemoryItem.findMany({ where: { clientId, confirmation: { in: ["UNCONFIRMED", "CONFIRMED", "DISPUTED"] } }, select: { id: true, class: true, key: true, value: true, confirmation: true, freshUntil: true, dataClass: true }, take: 1000 });
  const groups = conflictingGroups(items, now);
  const actor: MemoryActor = { type: "SYSTEM", userId: actorId };
  let disputed = 0;
  for (const ids of groups) {
    for (const id of ids) {
      const row = items.find((i) => i.id === id)!;
      if (row.confirmation === "DISPUTED") continue;
      await tx.customerMemoryItem.update({ where: { id }, data: { confirmation: "DISPUTED", disputedAt: now, disputedReason: "Two customer records were merged and this no longer agrees with another item." } });
      await audit(tx, actor, "memory.disputed", { id, clientId, class: row.class, dataClass: row.dataClass }, { reason: "merge_conflict" });
      disputed++;
    }
  }
  return disputed;
}
