import { prisma } from "@/lib/db/prisma";
import { createClientCore } from "@/app/(dashboard)/clients/actions";
import { getSystemActorId } from "@/lib/system/system-actor";
import type { Client } from "@/generated/prisma/client";

/**
 * Find-or-create for an inbound contact from a digital-campaign channel (Freshdesk Omni ticket,
 * Exotel call) — deliberately does not run its own phone/email lookup query. createClientCore()
 * already returns { status: "duplicate", duplicate: {...} } whenever its own normalized
 * mobile/email matching (checkDuplicateClientAction) finds an existing client, so always
 * attempting creation and branching on that result reuses the exact same matching logic the rest
 * of the app already trusts, rather than writing a second, parallel lookup that could drift from
 * it (or under-implement it, the way the webhook route's own prior exact-string match did).
 */
export async function resolveInboundClient(input: {
  phone?: string;
  email?: string;
  name?: string;
  leadSource: string;
}): Promise<{ client: Client; isNew: boolean }> {
  if (!input.phone && !input.email) {
    throw new Error("resolveInboundClient requires a phone or email to key on");
  }

  const systemActorId = await getSystemActorId();
  const name = input.name?.trim() || `${input.leadSource} Lead — ${input.phone ?? input.email}`;

  const result = await createClientCore(
    { name, mobile: input.phone, email: input.email, leadSource: input.leadSource },
    systemActorId,
  );

  if (result.status === "duplicate") {
    if (!result.duplicate) throw new Error("createClientCore reported a duplicate with no duplicate record");
    const client = await prisma.client.findUniqueOrThrow({ where: { id: result.duplicate.id } });
    return { client, isNew: false };
  }

  const client = await prisma.client.findUniqueOrThrow({ where: { id: result.client.id } });
  return { client, isNew: true };
}
