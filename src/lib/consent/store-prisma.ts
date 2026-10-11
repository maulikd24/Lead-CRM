import { prisma } from "@/lib/db/prisma";
import type { ConsentStore, StoredConsent } from "./ledger";
import type { ConsentSnapshot } from "./enforce";
import { createPrismaOutbox } from "@/lib/closedloop/db";
import { cancelOnWithdrawal } from "@/lib/closedloop/withdrawal";

/** The Prisma-backed ledger. Append and read only: there is no update or delete here, and the table rejects UPDATE. */
export const prismaConsentStore: ConsentStore = {
  async append(row) {
    const stored = (await prisma.consentRecord.create({ data: row })) as StoredConsent;
    // Every write path (screen, WhatsApp, import) passes here: a withdrawal of ad measurement takes the customer's not-yet-sent conversion rows out of the queue at once.
    // A courtesy on top of the send-time consent check; it never throws into the consent write.
    await cancelOnWithdrawal(createPrismaOutbox(prisma), stored);
    return stored;
  },
  async listForClient(clientId) {
    return (await prisma.consentRecord.findMany({ where: { clientId }, orderBy: { capturedAt: "desc" }, take: 500 })) as StoredConsent[];
  },
  async listForClients(clientIds) {
    return (await prisma.consentRecord.findMany({ where: { clientId: { in: clientIds } } })) as StoredConsent[];
  },
};

/** Ledger rows and the legacy lead-form timestamp for a set of customers, in two queries. Customers with neither are absent. */
export async function loadSnapshots(clientIds: string[]): Promise<Map<string, ConsentSnapshot>> {
  const out = new Map<string, ConsentSnapshot>();
  if (clientIds.length === 0) return out;
  const [records, clients] = await Promise.all([
    prisma.consentRecord.findMany({
      where: { clientId: { in: clientIds } },
      select: { clientId: true, id: true, purpose: true, channel: true, status: true, capturedAt: true, expiresAt: true },
    }),
    prisma.client.findMany({ where: { id: { in: clientIds }, marketingConsentAt: { not: null } }, select: { id: true, marketingConsentAt: true } }),
  ]);
  for (const c of clients) out.set(c.id, { records: [], legacyMarketingConsentAt: c.marketingConsentAt });
  for (const { clientId, ...row } of records) {
    const snap = out.get(clientId) ?? { records: [], legacyMarketingConsentAt: null };
    snap.records.push(row);
    out.set(clientId, snap);
  }
  return out;
}
