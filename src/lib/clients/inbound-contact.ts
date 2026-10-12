import { prisma } from "@/lib/db/prisma";
import { createClientCore, type CreateClientInput } from "@/app/(dashboard)/clients/actions";
import { getSystemActorId } from "@/lib/system/system-actor";
import { logActivity } from "@/lib/activities/log-activity";
import { createTaskIfNotExists } from "@/lib/stage-engine/create-task-if-not-exists";
import { findClientByIdentity, phoneKey, emailKey } from "@/lib/clients/identity";
import type { Client } from "@/generated/prisma/client";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Find-or-create for an inbound contact from any channel (Freshdesk ticket, Exotel call, WhatsApp, ad/website
 * lead). One profile per person:
 *  - Matched on the shared identity keys (src/lib/clients/identity.ts) — phone first, then email, including joint
 *    holders and clients marked Not proceeding.
 *  - A match gains whichever of mobile/email it was missing (never overwritten), so a phone-only lead and a later
 *    email-only ticket from the same person stay one profile.
 *  - Phone → client A but email → client B: attached to A (phone is the stronger identifier) and a "possible
 *    duplicate" review task goes to A's RM's manager (or an Admin).
 *  - A returning Not-proceeding client is attached, not duplicated, and their RM is told.
 *  - No match: created through createClientCore(), so PAN/CKYC/mobile/email dedupe, assignment, tasks and journeys
 *    all apply as for any new client.
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
}): Promise<{ client: Client; isNew: boolean; returnedLead?: boolean }> {
  if (!input.phone && !input.email) {
    throw new Error("resolveInboundClient requires a phone or email to key on");
  }

  const identity = await findClientByIdentity({ phone: input.phone, email: input.email });
  if (identity.match) {
    const matched = identity.match;
    await enrichContact(matched, input, identity.conflict);
    if (identity.conflict && identity.emailMatch) await flagPossibleDuplicate(matched.id, identity.emailMatch.id, input.leadSource);
    const returnedLead = matched.status === "NOT_PROCEEDING";
    if (returnedLead) await notifyLeadReturned(matched, input.leadSource);
    // returnedLead: the RM has already been told (lead_returned) — callers skip their own "contacted again" alert.
    return { client: await prisma.client.findUniqueOrThrow({ where: { id: matched.id } }), isNew: false, returnedLead };
  }

  const systemActorId = await getSystemActorId();
  const name = input.name?.trim() || `${input.leadSource} Lead — ${input.phone ?? input.email}`;
  const result = await createClientCore(
    { name, mobile: input.phone, email: input.email, leadSource: input.leadSource, assignedToId: input.assignedToId, ...input.extras },
    systemActorId,
  );

  // createClientCore can still find a duplicate the identity lookup didn't (PAN/CKYC, or a concurrent create).
  if (result.status === "duplicate") {
    if (!result.duplicate) throw new Error("createClientCore reported a duplicate with no duplicate record");
    return { client: await prisma.client.findUniqueOrThrow({ where: { id: result.duplicate.id } }), isNew: false };
  }
  return { client: await prisma.client.findUniqueOrThrow({ where: { id: result.client.id } }), isNew: true };
}

/** Fills the matched client's missing mobile/email from this contact. Never overwrites, and never copies a detail
 * that already belongs to a different client (the conflict case). */
async function enrichContact(
  client: { id: string; mobile: string | null; email: string | null },
  input: { phone?: string; email?: string; leadSource: string },
  conflict: boolean,
) {
  const data: { mobile?: string; email?: string } = {};
  if (!client.mobile && input.phone && phoneKey(input.phone)) data.mobile = input.phone;
  if (!client.email && input.email && emailKey(input.email) && !conflict) data.email = input.email.trim();
  if (!data.mobile && !data.email) return;

  // The detail must not already identify someone else (e.g. an email held by a client the phone didn't match).
  const taken = await findClientByIdentity({ phone: data.mobile, email: data.email });
  if (data.mobile && taken.phoneMatch && taken.phoneMatch.id !== client.id) delete data.mobile;
  if (data.email && taken.emailMatch && taken.emailMatch.id !== client.id) delete data.email;
  if (!data.mobile && !data.email) return;

  await prisma.client.update({ where: { id: client.id }, data });
  const added = [data.mobile && "mobile", data.email && "email"].filter(Boolean).join(" and ");
  await logActivity({ clientId: client.id, type: "NOTE", payload: { message: `Added ${added} from a ${input.leadSource} contact` } });
}

async function flagPossibleDuplicate(phoneClientId: string, emailClientId: string, leadSource: string) {
  const [a, b] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: phoneClientId }, select: { id: true, name: true, clientCode: true, assignedTo: { select: { managerId: true } } } }),
    prisma.client.findUniqueOrThrow({ where: { id: emailClientId }, select: { id: true, name: true, clientCode: true } }),
  ]);
  const reviewer =
    a.assignedTo?.managerId ??
    (await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, select: { id: true }, orderBy: { createdAt: "asc" } }))?.id;
  if (!reviewer) return;

  await createTaskIfNotExists({
    clientId: a.id,
    assignedToId: reviewer,
    title: `Possible duplicate: ${a.name} (${a.clientCode}) / ${b.name} (${b.clientCode}) — review and merge`,
    dueAt: new Date(Date.now() + 2 * DAY),
    source: `identity-conflict:${a.id}:${b.id}`,
  });
  const note = `A ${leadSource} contact's phone matched ${a.clientCode} but its email matched ${b.clientCode} — attached to ${a.clientCode}; flagged for review`;
  await Promise.all([a.id, b.id].map((clientId) => logActivity({ clientId, type: "NOTE", payload: { message: note } })));
}

async function notifyLeadReturned(client: { id: string; name: string; assignedToId: string | null }, leadSource: string) {
  await logActivity({ clientId: client.id, type: "NOTE", payload: { message: `Contacted again via ${leadSource} after being marked Not proceeding` } });
  if (!client.assignedToId) return;
  // One alert per client per day, however many messages they send.
  const recent = await prisma.notification.findFirst({
    where: { userId: client.assignedToId, type: "lead_returned", createdAt: { gte: new Date(Date.now() - DAY) }, payload: { path: ["clientId"], equals: client.id } },
    select: { id: true },
  });
  if (recent) return;
  await prisma.notification.create({
    data: { userId: client.assignedToId, type: "lead_returned", payload: { clientId: client.id, clientName: client.name, leadSource } },
  });
}
