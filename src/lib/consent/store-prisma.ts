import { prisma } from "@/lib/db/prisma";
import type { ConsentStore, StoredConsent } from "./ledger";
import type { ConsentSnapshot } from "./enforce";

/** The Prisma-backed ledger. Append and read only: there is no update or delete here, and the table rejects UPDATE. */
export const prismaConsentStore: ConsentStore = {
  async append(row) {
    const saved = (await prisma.consentRecord.create({ data: row })) as StoredConsent;
    // Wave 2 customer memory (R6): a withdrawn AI or call-recording consent expires what was derived under it. Never blocks or fails the consent write.
    if (saved.status === "WITHDRAWN" && (saved.purpose === "AI_PROCESSING_OF_CHATS" || saved.purpose === "CALL_RECORDING") && process.env.NEXT_PUBLIC_MEMORY === "1") {
      try {
        const { expireOnConsentWithdrawal } = await import("@/lib/memory/store");
        await expireOnConsentWithdrawal(saved.clientId, saved.purpose);
      } catch (error) {
        console.error("memory expiry on consent withdrawal failed", error instanceof Error ? error.name : "unknown");
      }
    }
    return saved;
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
