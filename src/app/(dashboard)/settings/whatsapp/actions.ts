"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole, requireUser } from "@/lib/auth/require-role";
import { toAccountState, type AccountState } from "@/lib/whatsapp/account-state";

const accountSchema = z.object({
  id: z.string().optional(),
  label: z.string().trim().min(1, "Label is required").max(60),
  sessionId: z
    .string()
    .trim()
    .min(1, "Session ID is required")
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "Session ID can only contain letters, numbers, hyphens and underscores (no spaces)"),
  ownerUserId: z.string().optional(),
});

export async function upsertWhatsAppAccountAction(formData: FormData) {
  await requireRole(["ADMIN"]);

  const rawOwner = formData.get("ownerUserId");
  const parsed = accountSchema.safeParse({
    id: formData.get("id") || undefined,
    label: formData.get("label"),
    sessionId: formData.get("sessionId"),
    ownerUserId: rawOwner && rawOwner !== "none" ? String(rawOwner) : undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  const { id, label, sessionId, ownerUserId } = parsed.data;

  if (ownerUserId) {
    const owner = await prisma.user.findUnique({ where: { id: ownerUserId }, select: { role: true, isActive: true } });
    if (!owner || !owner.isActive || owner.role !== "RM") throw new Error("The owner must be an active RM");
  }

  try {
    if (id) {
      // sessionId is deliberately not editable: the worker's saved browser session is keyed on it.
      await prisma.whatsAppAccount.update({ where: { id }, data: { label, ownerUserId: ownerUserId ?? null } });
    } else {
      await prisma.whatsAppAccount.create({ data: { label, sessionId, ownerUserId: ownerUserId ?? null } });
    }
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
      throw new Error("That session ID is already in use, or that RM already has a WhatsApp number");
    }
    throw error;
  }

  revalidatePath("/settings/whatsapp");
}

export async function setWhatsAppAccountActiveAction(accountId: string, isActive: boolean) {
  await requireRole(["ADMIN"]);
  await prisma.whatsAppAccount.update({ where: { id: accountId }, data: { isActive } });
  revalidatePath("/settings/whatsapp");
}

/**
 * Polled by the QR panel. The QR lets whoever scans it take over that WhatsApp number, so it is only
 * ever returned to an Admin or the number's own RM — every other caller gets null, the same answer
 * as for an id that doesn't exist.
 */
export async function getWhatsAppAccountStateAction(accountId: string): Promise<AccountState | null> {
  const session = await requireUser();
  const account = await prisma.whatsAppAccount.findUnique({ where: { id: String(accountId) } });
  if (!account) return null;

  const isAdmin = session.user.role === "ADMIN";
  const isOwner = account.ownerUserId === session.user.id;
  if (!isAdmin && !isOwner) return null;

  return toAccountState(account);
}
