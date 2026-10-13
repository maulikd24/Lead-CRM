"use server";

import { revalidatePath } from "next/cache";

import { actOnFinding, FINDING_ACTION_KINDS, type FindingActionKind } from "@/lib/audit/finding-actions";
import { prismaFindingActionPort } from "@/lib/audit/finding-actions-prisma";
import { qualityAuditEnabled } from "@/lib/audit/finding-store";
import { requireAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";

export type FindingActionResult = { ok: true; message: string } | { ok: false; error: string };

/** Acknowledge, resolve or dismiss one audit finding. The access rules (who may do what) are in lib/audit/finding-actions.ts. */
export async function findingAction(findingId: string, action: FindingActionKind, note?: string): Promise<FindingActionResult> {
  const session = await requireAccess("quality-audit", "manage");
  if (!qualityAuditEnabled()) return { ok: false, error: "Not available." };
  if (!FINDING_ACTION_KINDS.includes(action)) return { ok: false, error: "Unknown action." };
  const r = await actOnFinding(prismaFindingActionPort(prisma), {
    findingId: String(findingId),
    action,
    note: typeof note === "string" ? note : null,
    actor: { userId: session.user.id, role: session.user.role },
    now: new Date(),
  });
  if (!r.ok) return { ok: false, error: r.message };
  revalidatePath("/quality-audit");
  return { ok: true, message: "Updated." };
}
