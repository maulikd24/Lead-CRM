"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { encryptJson } from "@/lib/security/crypto";
import { getAdapter } from "@/lib/integrations/registry";
import { markContractVerified, REFERRAL_API_PROVIDER } from "@/lib/partners/contract";

export async function setIntegrationModeAction(provider: string, mode: "mock" | "live") {
  await requireRole(["ADMIN"]);

  await prisma.integrationConfig.upsert({
    where: { provider },
    update: { mode },
    create: { provider, mode },
  });

  revalidatePath("/settings/integrations");
}

export async function saveIntegrationCredentialsAction(provider: string, credentials: Record<string, string>) {
  await requireRole(["ADMIN"]);

  const encrypted = encryptJson(credentials);

  // A contract check is only meaningful for the server it was run against: new details clear the verified mark.
  const clearVerified = provider === REFERRAL_API_PROVIDER ? { settings: {} } : {};
  await prisma.integrationConfig.upsert({
    where: { provider },
    update: { credentials: encrypted, isEnabled: true, ...clearVerified },
    create: { provider, credentials: encrypted, isEnabled: true },
  });

  revalidatePath("/settings/integrations");
}

export async function testIntegrationConnectionAction(provider: string) {
  await requireRole(["ADMIN"]);

  const adapter = await getAdapter(provider);
  return adapter.testConnection();
}

/** Admin records that the referral API contract was checked (scripts/partner-contract-check.ts) and accepted. */
export async function markPartnerContractVerifiedAction(input: unknown) {
  const session = await requireRole(["ADMIN"]);
  await markContractVerified(prisma as never, input, { userId: session.user.id, now: new Date() });
  revalidatePath("/settings/integrations");
}
