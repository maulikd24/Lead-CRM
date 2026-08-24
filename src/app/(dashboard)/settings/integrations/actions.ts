"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { encryptJson } from "@/lib/security/crypto";
import { getAdapter } from "@/lib/integrations/registry";

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

  await prisma.integrationConfig.upsert({
    where: { provider },
    update: { credentials: encrypted, isEnabled: true },
    create: { provider, credentials: encrypted, isEnabled: true },
  });

  revalidatePath("/settings/integrations");
}

export async function testIntegrationConnectionAction(provider: string) {
  await requireRole(["ADMIN"]);

  const adapter = await getAdapter(provider);
  return adapter.testConnection();
}
