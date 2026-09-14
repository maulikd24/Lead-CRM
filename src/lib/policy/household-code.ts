import { prisma } from "@/lib/db/prisma";

/** Generates the next sequential human-readable household code, e.g. "HH-00001" — mirrors generateClientCode(). */
export async function generateHouseholdCode(): Promise<string> {
  const last = await prisma.household.findFirst({
    orderBy: { createdAt: "desc" },
    select: { householdCode: true },
  });

  const lastNumber = last ? parseInt(last.householdCode.replace("HH-", ""), 10) || 0 : 0;
  const next = lastNumber + 1;
  return `HH-${String(next).padStart(5, "0")}`;
}
