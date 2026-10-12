import type { PrismaClient } from "@/generated/prisma/client";
import { normalizeReferralCode } from "./touch";

/**
 * Is this string a partner's code? Any case, any partner status: an inactive partner's code is still theirs, so it must never be
 * mistaken for a customer's referral code. Anything that cannot be a partner code is answered without a database read.
 */
export async function isPartnerCode(db: Pick<PrismaClient, "partnerProfile">, raw: string): Promise<boolean> {
  const code = normalizeReferralCode(raw);
  if (!code) return false;
  const found = await db.partnerProfile.findFirst({ where: { partnerCode: { equals: code, mode: "insensitive" } }, select: { id: true } });
  return found !== null;
}
