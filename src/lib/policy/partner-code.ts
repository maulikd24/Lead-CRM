import { prisma } from "@/lib/db/prisma";

/** Generates the next sequential human-readable partner code, e.g. "PTR-00001" — mirrors generateClientCode(). */
export async function generatePartnerCode(): Promise<string> {
  const last = await prisma.partnerProfile.findFirst({
    orderBy: { createdAt: "desc" },
    select: { partnerCode: true },
  });

  const lastNumber = last ? parseInt(last.partnerCode.replace("PTR-", ""), 10) || 0 : 0;
  const next = lastNumber + 1;
  return `PTR-${String(next).padStart(5, "0")}`;
}
