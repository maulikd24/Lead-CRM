import { prisma } from "@/lib/db/prisma";
import { createClientCore, type CreateClientInput } from "@/app/(dashboard)/clients/actions";
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
  /** Force the owner (e.g. the RM whose WhatsApp number received the message) instead of load-balanced routing. */
  assignedToId?: string;
  /** Lead-intake extras (ads / website forms): carried straight onto the new client, ignored for an existing one. */
  extras?: Pick<CreateClientInput, "priority" | "notes" | "city" | "productInterest" | "leadAttribution" | "customerCategory" | "marketingConsentAt" | "marketingConsentText">;
}): Promise<{ client: Client; isNew: boolean }> {
  if (!input.phone && !input.email) {
    throw new Error("resolveInboundClient requires a phone or email to key on");
  }

  const systemActorId = await getSystemActorId();
  const name = input.name?.trim() || `${input.leadSource} Lead — ${input.phone ?? input.email}`;

  const result = await createClientCore(
    { name, mobile: input.phone, email: input.email, leadSource: input.leadSource, assignedToId: input.assignedToId, ...input.extras },
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
