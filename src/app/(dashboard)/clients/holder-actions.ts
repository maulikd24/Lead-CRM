"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole, requireAccess } from "@/lib/auth/require-role";
import { assertClientInScope } from "@/lib/clients/load-in-scope";
import { logActivity } from "@/lib/activities/log-activity";
import { startDocumentCollection } from "@/lib/stage-engine/transitions";
import { seedKycSteps } from "@/lib/kyc/pipeline";
import { canRevealContact } from "@/lib/privacy/contact-reveal";
import { normalizePan, PAN_REGEX } from "@/lib/utils/normalize-contact";
import type { Prisma } from "@/generated/prisma/client";
import { addHolderCore, assertNoActiveTradingAccount, HOLDER_LOCK_MESSAGE, holderSchema, type HolderInput } from "@/lib/clients/add-holder";

export type { HolderInput };

function revalidateClient(clientId: string) {
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
}

export async function addHolderAction(clientId: string, input: HolderInput) {
  const session = await requireAccess("clients", "manage");
  await assertClientInScope(session.user, clientId);
  const holder = await addHolderCore(clientId, input, session.user.id);
  revalidateClient(clientId);
  return holder;
}

const updateHolderSchema = holderSchema.omit({ position: true }).partial();

export async function updateHolderAction(holderId: string, rawInput: z.input<typeof updateHolderSchema>) {
  const session = await requireAccess("clients", "manage");
  const input = updateHolderSchema.parse(rawInput);
  const existing = await prisma.accountHolder.findUniqueOrThrow({ where: { id: holderId } });
  await assertClientInScope(session.user, existing.clientId);
  await assertNoActiveTradingAccount(existing.clientId);

  const data: Prisma.AccountHolderUpdateInput = {};
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};

  // A PAN follows the reveal rule: only an Admin or the assigned RM changes it.
  if (input.pan && normalizePan(input.pan) !== (existing.pan ?? "")) {
    const owner = await prisma.client.findUnique({ where: { id: existing.clientId }, select: { assignedToId: true } });
    if (!owner || !canRevealContact({ id: session.user.id, role: session.user.role }, owner)) throw new Error("Only an Admin or the assigned RM can change the PAN");
  }

  // Like the customer's own number, a holder's number is changed by an Admin only.
  if (input.mobile !== undefined && (input.mobile || null) !== existing.mobile && session.user.role !== "ADMIN") {
    throw new Error("Ask an Admin to change a holder's mobile number");
  }

  for (const field of ["name", "mobile", "email", "pan", "ckycRef", "relationToFirstHolder"] as const) {
    if (input[field] === undefined) continue;
    const next = input[field] || null;
    const prev = existing[field];
    if (next === prev) continue;
    (data as Record<string, unknown>)[field] = next;
    oldValue[field] = prev;
    newValue[field] = next;
  }

  const updated = await prisma.accountHolder.update({ where: { id: holderId }, data });

  if (Object.keys(newValue).length > 0) {
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        entity: "Client",
        entityId: existing.clientId,
        action: "holder_updated",
        oldValue: oldValue as Prisma.InputJsonValue,
        newValue: newValue as Prisma.InputJsonValue,
      },
    });
    await logActivity({
      clientId: existing.clientId,
      userId: session.user.id,
      type: "NOTE",
      payload: { message: `Updated holder ${updated.name}: ${Object.keys(newValue).join(", ")}` },
    });
  }

  revalidateClient(existing.clientId);
  return updated;
}

export async function removeHolderAction(holderId: string, reason?: string) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const existing = await prisma.accountHolder.findUniqueOrThrow({ where: { id: holderId } });
  await assertClientInScope(session.user, existing.clientId);
  await assertNoActiveTradingAccount(existing.clientId);

  await prisma.accountHolder.update({
    where: { id: holderId },
    // Clear position to null so the (clientId, position) slot is free for a future holder — the
    // unique index isn't partial, so an inactive row must vacate its position.
    data: { isDeleted: true, deletedAt: new Date(), position: null },
  });

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      entity: "Client",
      entityId: existing.clientId,
      action: "holder_removed",
      oldValue: { holderId: existing.id, position: existing.position, name: existing.name },
      reason,
    },
  });
  await logActivity({
    clientId: existing.clientId,
    userId: session.user.id,
    type: "NOTE",
    payload: { message: `Removed holder: ${existing.name}${reason ? ` — ${reason}` : ""}` },
  });

  revalidateClient(existing.clientId);
}
