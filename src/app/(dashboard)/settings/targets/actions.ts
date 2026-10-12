"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { parseQuarterKey } from "@/lib/targets/quarter";

/**
 * Sets one RM's funded-amount target for a quarter. Admins: any active RM. Managers: RMs in their team only. Every change is in the
 * audit log with the old and new amounts. A blank or zero amount removes the target.
 */
export async function setRmTargetAction(input: { rmId: string; quarterKey: string; amount: string }): Promise<{ ok: true } | { ok: false; reason: string }> {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const quarter = parseQuarterKey(input.quarterKey);
  if (!quarter) return { ok: false, reason: "Unknown quarter" };
  const amount = input.amount.trim() === "" ? 0 : Number(input.amount.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e13) return { ok: false, reason: "Enter an amount in rupees, or leave it blank" };

  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const rm = await prisma.user.findFirst({ where: { id: input.rmId, role: "RM", isActive: true }, select: { id: true } });
  if (!rm || (visibleUserIds && !visibleUserIds.includes(rm.id))) return { ok: false, reason: "That RM isn't in your team" };

  const key = { userId_quarterStart: { userId: rm.id, quarterStart: quarter.start } };
  const existing = await prisma.rmTarget.findUnique({ where: key, select: { id: true, fundedAmount: true } });
  const oldAmount = existing ? Number(existing.fundedAmount) : 0;
  if (oldAmount === amount) return { ok: true };

  await prisma.$transaction(async (tx) => {
    let entityId = existing?.id ?? null;
    if (amount === 0) {
      if (existing) await tx.rmTarget.delete({ where: { id: existing.id } });
    } else {
      const saved = await tx.rmTarget.upsert({
        where: key,
        update: { fundedAmount: amount, setById: session.user.id },
        create: { userId: rm.id, quarterStart: quarter.start, fundedAmount: amount, setById: session.user.id },
        select: { id: true },
      });
      entityId = saved.id;
    }
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        entity: "RmTarget",
        entityId: entityId ?? `${rm.id}:${quarter.key}`,
        action: "rm_target_set",
        oldValue: { rmId: rm.id, quarter: quarter.key, fundedAmount: oldAmount },
        newValue: { rmId: rm.id, quarter: quarter.key, fundedAmount: amount },
      },
    });
  });
  revalidatePath("/settings/targets");
  revalidatePath("/dashboard");
  return { ok: true };
}
