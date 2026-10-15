import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/activities/log-activity";
import { startDocumentCollection } from "@/lib/stage-engine/transitions";
import { seedKycSteps } from "@/lib/kyc/pipeline";
import { PAN_REGEX } from "@/lib/utils/normalize-contact";
import type { HolderPosition, OperatingInstruction } from "@/generated/prisma/client";

export const holderSchema = z.object({
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

export const HOLDER_LOCK_MESSAGE = "Joint holders can't be changed once a trading account is active — contact Ops for an account modification.";

export async function assertNoActiveTradingAccount(clientId: string) {
  const count = await prisma.tradingAccount.count({ where: { clientId, status: "ACTIVE" } });
  if (count > 0) throw new Error(HOLDER_LOCK_MESSAGE);
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
 * Not a server action (it trusts the actor it is given), so it lives in a regular module. Shared by both creation paths: a brand-new joint client (looped once per holder right after
 * createClientCore) and adding a holder to an existing client later.
 */
export async function addHolderCore(clientId: string, rawInput: HolderInput, actorId: string) {
  const input = holderSchema.parse(rawInput);
  await assertNoActiveTradingAccount(clientId);

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
  // Already in the KYC pipeline? The new holder needs their own identity steps too.
  if (await prisma.kycStep.count({ where: { clientId } })) await seedKycSteps(clientId);

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
