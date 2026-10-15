"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { encryptJson } from "@/lib/security/crypto";
import { getAdapter } from "@/lib/integrations/registry";
import { requestCleverTapPushBatch } from "@/lib/integrations/clevertap/batch-request";

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

/** An Admin asks for the CleverTap batch to be approved. A different Admin approves it in the approvals queue; then the push sends it once. */
export async function requestCleverTapBatchApprovalAction() {
  const session = await requireRole(["ADMIN"]);
  const result = await requestCleverTapPushBatch({ id: session.user.id, role: session.user.role });
  revalidatePath("/settings/integrations");
  revalidatePath("/settings/approval-workflows");
  return { count: result.count, region: result.region };
}
