"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { rateLimit } from "@/lib/security/rate-limit";
import { RateLimitedError } from "@/lib/integrations/types";
import { getFreshdeskTicketSource, syncFreshdeskForClient } from "@/lib/support/freshdesk-sync";

/** "Sync from Freshdesk" on a client's Support tab: pull their full ticket history now instead of waiting for the
 * scheduler. Same access as viewing the client; rate-limited per user to stay inside Freshdesk's API limits. */
export async function syncClientTicketsAction(clientId: string): Promise<{ tickets: number; newTickets: number }> {
  const session = await requireUser();
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { assignedToId: true } });
  if (!client) throw new Error("Client not found");
  const visible = await getVisibleUserIds(session.user.id, session.user.role);
  const allowed = visible === null || (client.assignedToId ? visible.includes(client.assignedToId) : session.user.role === "MANAGER");
  if (!allowed) throw new Error("You don't have access to this client");

  const limited = await rateLimit("freshdesk-sync", session.user.id, { limit: 10, windowSeconds: 60 });
  if (!limited.allowed) throw new Error(`Too many syncs — try again in ${limited.retryAfterSeconds}s`);

  const source = await getFreshdeskTicketSource({ allowMock: true });
  if (!source) throw new Error("Freshdesk isn't connected — set it up in Settings → Apps & Integrations");

  try {
    const result = await syncFreshdeskForClient(clientId, source);
    revalidatePath(`/clients/${clientId}`);
    return { tickets: result.tickets, newTickets: result.newTickets };
  } catch (error) {
    if (error instanceof RateLimitedError) throw new Error(`Freshdesk is busy — try again in ${error.retryAfterSeconds}s`);
    throw error;
  }
}
