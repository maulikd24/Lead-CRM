import { positionKey, type AccountRef, type FeedRepo, type PositionRow, type TransactionRow } from "./write";

/** In-memory FeedRepo for tests. Mirrors the database: unique natural keys make a duplicate create throw, and an
 * account number belongs to one customer for good. */
export function createMemoryRepo(opts: { failOnPositionRef?: string } = {}) {
  const state = {
    accounts: new Map<string, AccountRef>(),
    products: new Map<string, { id: string; name: string }>(),
    positions: new Map<string, PositionRow & { externalRef: string }>(),
    transactions: new Map<string, TransactionRow & { externalRef: string }>(),
    writes: 0,
  };
  let seq = 0;
  const id = (p: string) => `${p}-${++seq}`;

  const repo: FeedRepo = {
    async findAccounts(numbers) {
      return new Map(numbers.flatMap((n) => (state.accounts.has(n) ? [[n, state.accounts.get(n)!] as const] : [])));
    },
    async ensureAccount({ accountNumber, clientId }) {
      const existing = state.accounts.get(accountNumber);
      if (existing) return existing;
      const account = { id: id("acct"), clientId };
      state.accounts.set(accountNumber, account);
      state.writes++;
      return account;
    },
    async findProducts(codes) {
      return new Map(codes.flatMap((c) => (state.products.has(c) ? [[c, { id: state.products.get(c)!.id }] as const] : [])));
    },
    async ensureProduct({ productCode, name }) {
      const existing = state.products.get(productCode);
      if (existing) return { id: existing.id };
      const product = { id: id("prod"), name };
      state.products.set(productCode, product);
      state.writes++;
      return { id: product.id };
    },
    async findPositions(keys) {
      const out = new Map<string, PositionRow>();
      for (const k of keys) {
        const p = state.positions.get(positionKey(k));
        if (p) out.set(positionKey(k), p);
      }
      return out;
    },
    async createPosition(input) {
      if (opts.failOnPositionRef === input.externalRef) throw new Error("boom");
      if (state.positions.has(positionKey(input))) throw new Error("Unique constraint failed");
      state.positions.set(positionKey(input), { id: id("pos"), ...input });
      state.writes++;
    },
    async updatePosition(posId, input) {
      for (const p of state.positions.values()) if (p.id === posId) Object.assign(p, input);
      state.writes++;
    },
    async findTransactions(refs) {
      return new Map(refs.flatMap((r) => (state.transactions.has(r) ? [[r, state.transactions.get(r)!] as const] : [])));
    },
    async createTransaction(input) {
      if (state.transactions.has(input.externalRef)) throw new Error("Unique constraint failed");
      state.transactions.set(input.externalRef, { id: id("txn"), ...input, transactionDate: input.transactionDate.getTime(), settlementDate: input.settlementDate?.getTime() ?? null });
      state.writes++;
    },
    async updateTransaction(txnId, input) {
      for (const t of state.transactions.values()) if (t.id === txnId) Object.assign(t, input, { transactionDate: input.transactionDate.getTime(), settlementDate: input.settlementDate?.getTime() ?? null });
      state.writes++;
    },
  };
  return Object.assign(repo, { state });
}
