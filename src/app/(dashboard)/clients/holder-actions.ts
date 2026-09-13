"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireUser, requireRole } from "@/lib/auth/require-role";
import { logActivity } from "@/lib/activities/log-activity";
import { startDocumentCollection } from "@/lib/stage-engine/transitions";
import { normalizePan, PAN_REGEX } from "@/lib/utils/normalize-contact";
import type { Prisma, HolderPosition, OperatingInstruction } from "@/generated/prisma/client";

const holderSchema = z.object({
  position: z.enum(["SECOND", "THIRD"]),
  name: z.string().min(1, "Name is required"),
  mobile: z.string().optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  pan: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v.trim().toUpperCase() : undefined))
    .refine((v) => !v || PAN_REGEX.test(v), "Invalid PAN format (expected e.g. ABCDE1234F)"),
  ckycRef: z.string().optional().or(z.literal("")),
  relationToFirstHolder: z.string().optional().or(z.literal("")),
});

export type HolderInput = z.input<typeof holderSchema>;

function revalidateClient(clientId: string) {
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
}

/** At most 2 extra holders (Second + Third); EITHER_OR_SURVIVOR only makes sense with exactly one. */
function assertOperatingInstructionConsistent(
  operatingInstruction: OperatingInstruction | null | undefined,
  totalHolderCount: number,
) {
  if (!operatingInstruction) return;
  if (operatingInstruction === "EITHER_OR_SURVIVOR" && totalHolderCount !== 2) {
    throw new Error("Either-or-Survivor requires exactly 2 total holders");
  }
}

/**
 * Shared by both creation paths: a brand-new joint client (looped once per holder right after
 * createClientCore) and adding a holder to an existing client later.
 */
export async function addHolderCore(clientId: string, rawInput: HolderInput, actorId: string) {
  const input = holderSchema.parse(rawInput);

  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  const activeHolders = await prisma.accountHolder.findMany({ where: { clientId, isDeleted: false } });

  if (activeHolders.some((h) => h.position === input.position)) {
    throw new Error(`This account already has a ${input.position.toLowerCase()} holder`);
  }
  if (activeHolders.length >= 2) {
    throw new Error("An account can have at most 3 total holders (First, Second, Third)");
  }

  const totalHolderCount = activeHolders.length + 2; // +1 for First Holder, +1 for the one being added
  assertOperatingInstructionConsistent(client.operatingInstruction, totalHolderCount);

  const holder = await prisma.accountHolder.create({
    data: {
      clientId,
      position: input.position as HolderPosition,
      name: input.name,
      mobile: input.mobile || null,
      email: input.email || null,
      pan: input.pan || null,
      ckycRef: input.ckycRef || null,
      relationToFirstHolder: input.relationToFirstHolder || null,
    },
  });

  await startDocumentCollection(clientId, holder.id);

  await prisma.auditLog.create({
    data: {
      userId: actorId,
      entity: "Client",
      entityId: clientId,
      action: "holder_added",
      newValue: { holderId: holder.id, position: holder.position, name: holder.name },
    },
  });
  await logActivity({
    clientId,
    userId: actorId,
    type: "NOTE",
    payload: { message: `Added ${holder.position?.toLowerCase()} holder: ${holder.name}` },
  });

  return holder;
}

export async function addHolderAction(clientId: string, input: HolderInput) {
  const session = await requireUser();
  const holder = await addHolderCore(clientId, input, session.user.id);
  revalidateClient(clientId);
  return holder;
}

const updateHolderSchema = holderSchema.omit({ position: true }).partial();

export async function updateHolderAction(holderId: string, rawInput: z.input<typeof updateHolderSchema>) {
  const session = await requireUser();
  const input = updateHolderSchema.parse(rawInput);
  const existing = await prisma.accountHolder.findUniqueOrThrow({ where: { id: holderId } });

  const data: Prisma.AccountHolderUpdateInput = {};
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};

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
