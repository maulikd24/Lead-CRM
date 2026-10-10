import { prisma } from "@/lib/db/prisma";
import { getAdapter, isMockAdapter } from "@/lib/integrations/registry";
import { phoneVariants } from "@/lib/clients/identity";
import { RateLimitedError, type TicketSource } from "@/lib/integrations/types";
import { isProductionRuntime } from "@/lib/security/webhook-auth";
import { upsertSupportTicket } from "./tickets";

const PROVIDER = "freshdesk";
const CLIENTS_PER_TICK = 10;

/** What a client's history was last pulled for; a different value (phone/email changed, filled in, merged) means
 * pull again. Plain keys, so the scheduler can compare in SQL. */
export function freshdeskSyncKey(client: { mobileKey: string | null; emailKey: string | null }): string {
  return `${client.mobileKey ?? ""}|${client.emailKey ?? ""}`;
}

/** The ticket source to sync from, or null when Freshdesk isn't usable here. The scheduler only ever uses a live
 * Freshdesk; the mock (fake tickets) is allowed for an explicit manual sync outside Production, for demos/testing. */
export async function getFreshdeskTicketSource(opts: { allowMock?: boolean } = {}): Promise<TicketSource | null> {
  const adapter = await getAdapter(PROVIDER);
  if (!adapter.tickets) return null;
  if (isMockAdapter(adapter) && (!opts.allowMock || isProductionRuntime())) return null;
  return adapter.tickets;
}

/**
 * Pulls every Freshdesk ticket raised by this client — their contacts are found by any stored format of the client's
 * phone and by email — and records each on the profile (upsertSupportTicket). Throws RateLimitedError if Freshdesk
 * is throttling us, so the caller can stop for now.
 */
export async function syncFreshdeskForClient(clientId: string, source: TicketSource) {
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    select: { id: true, mobile: true, email: true, mobileKey: true, emailKey: true, isDeleted: true, mergedIntoId: true },
  });
  if (client.isDeleted || client.mergedIntoId) return { contacts: 0, tickets: 0, newTickets: 0 };

  const contactIds = await source.findContactIds({ phones: phoneVariants(client.mobile), email: client.emailKey });
  let tickets = 0;
  let newTickets = 0;
  for (const contactId of contactIds) {
    for (const ticket of await source.listTicketsForContact(contactId)) {
      const { isNew } = await upsertSupportTicket(client.id, PROVIDER, ticket, "history-sync");
      tickets++;
      if (isNew) newTickets++;
    }
  }
  await prisma.client.update({
    where: { id: client.id },
    data: { freshdeskSyncedAt: new Date(), freshdeskSyncKey: freshdeskSyncKey(client) },
  });
  return { contacts: contactIds.length, tickets, newTickets };
}

/**
 * Scheduler job: brings ticket history onto clients that have never been synced or whose phone/email changed since —
 * which covers new clients from any source, edits, filled-in contact details, merges and the first full backfill
 * alike. A few clients per tick keeps well inside Freshdesk's API limits; a 429 stops the run until the next tick.
 */
export async function syncFreshdeskHistory() {
  const source = await getFreshdeskTicketSource();
  if (!source) return { skipped: "freshdesk-not-live" as const };

  const due = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Client"
    WHERE "isDeleted" = false AND "mergedIntoId" IS NULL
      AND ("mobileKey" IS NOT NULL OR "emailKey" IS NOT NULL)
      AND ("freshdeskSyncedAt" IS NULL
           OR "freshdeskSyncKey" IS DISTINCT FROM coalesce("mobileKey", '') || '|' || coalesce("emailKey", ''))
    ORDER BY "freshdeskSyncedAt" ASC NULLS FIRST, "createdAt" DESC
    LIMIT ${CLIENTS_PER_TICK}`;

  let synced = 0;
  let tickets = 0;
  let failed = 0;
  for (const { id } of due) {
    try {
      const result = await syncFreshdeskForClient(id, source);
      synced++;
      tickets += result.newTickets;
    } catch (error) {
      if (error instanceof RateLimitedError) return { synced, newTickets: tickets, failed, rateLimited: error.retryAfterSeconds };
      failed++;
      console.error(`Freshdesk history sync failed for client ${id}`, error);
      // Moved to the back of the queue (synced-at = now) but still marked stale, so it's retried after the others.
      await prisma.client.update({ where: { id }, data: { freshdeskSyncedAt: new Date(), freshdeskSyncKey: "retry" } });
    }
  }
  return { synced, newTickets: tickets, failed, remaining: due.length === CLIENTS_PER_TICK ? "more" : "none" };
}
