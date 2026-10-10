import type { ConsentStore, StoredConsent } from "./ledger";

/**
 * In-memory ConsentStore for tests and local runs. Same contract as the Prisma store: it can append and read, nothing else.
 * Returned rows are copies, so a caller cannot edit the ledger through them.
 */
export function createMemoryStore(seed: StoredConsent[] = []): ConsentStore {
  const rows: StoredConsent[] = seed.map((r) => ({ ...r }));
  let n = 0;
  return {
    async append(input) {
      const row: StoredConsent = { ...input, id: `mem_${++n}`, createdAt: new Date() };
      rows.push(row);
      return { ...row };
    },
    async listForClient(clientId) {
      return rows.filter((r) => r.clientId === clientId).map((r) => ({ ...r }));
    },
    async listForClients(clientIds) {
      const set = new Set(clientIds);
      return rows.filter((r) => set.has(r.clientId)).map((r) => ({ ...r }));
    },
  };
}
