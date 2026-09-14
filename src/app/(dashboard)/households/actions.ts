"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { generateHouseholdCode } from "@/lib/policy/household-code";

const createHouseholdSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

export async function createHouseholdAction(formData: FormData) {
  await requireRole(["ADMIN", "MANAGER"]);

  const parsed = createHouseholdSchema.parse({ name: formData.get("name") });
  const householdCode = await generateHouseholdCode();

  const household = await prisma.household.create({
    data: { name: parsed.name, householdCode },
  });

  revalidatePath("/households");
  return household;
}

/** Clients not already in this household, scoped to the caller's visible clients. */
export async function searchClientsForHouseholdAction(query: string, householdId: string) {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (!query.trim()) return [];

  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const existingMemberIds = (
    await prisma.householdMember.findMany({ where: { householdId }, select: { clientId: true } })
  ).map((m) => m.clientId);

  return prisma.client.findMany({
    where: {
      isDeleted: false,
      id: { notIn: existingMemberIds },
      ...(visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {}),
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { mobile: { contains: query, mode: "insensitive" } },
        { clientCode: { contains: query, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, clientCode: true, mobile: true },
    take: 10,
  });
}

export async function addHouseholdMemberAction(
  householdId: string,
  clientId: string,
  input: { relationship?: string; isPrimary?: boolean },
) {
  await requireRole(["ADMIN", "MANAGER"]);

  if (input.isPrimary) {
    await prisma.householdMember.updateMany({ where: { householdId }, data: { isPrimary: false } });
  }

  await prisma.householdMember.create({
    data: { householdId, clientId, relationship: input.relationship, isPrimary: input.isPrimary ?? false },
  });

  revalidatePath(`/households/${householdId}`);
}

export async function removeHouseholdMemberAction(householdId: string, memberId: string) {
  await requireRole(["ADMIN", "MANAGER"]);

  await prisma.householdMember.delete({ where: { id: memberId } });

  revalidatePath(`/households/${householdId}`);
}
