import type { MappedCustomer, MappedHolding, MappedTransaction, ProductCategoryName, TransactionTypeName } from "./mapper";

/** Every row written by the feed carries this source system, so it is replay-safe and never collides with CSV imports. */
export const FEED_SOURCE_SYSTEM = "portfolio_feed";

export type AccountRef = { id: string; clientId: string };
export type PositionRow = { id: string; tradingAccountId: string; productId: string; quantity: number; avgCost: number | null; currentValue: number | null };
export type TransactionRow = {
  id: string;
  tradingAccountId: string;
  productId: string | null;
  transactionType: TransactionTypeName;
  transactionDate: number;
  settlementDate: number | null;
  quantity: number | null;
  price: number | null;
  grossAmount: number;
  netAmount: number | null;
  brokerageAmount: number | null;
};
export type PositionKey = { externalRef: string; asOfDate: Date };
export const positionKey = (k: PositionKey) => `${k.externalRef}|${k.asOfDate.toISOString()}`;

/** The narrow persistence surface the writer needs. Implemented over Prisma for production and in memory for tests. */
export interface FeedRepo {
  findAccounts(numbers: string[]): Promise<Map<string, AccountRef>>;
  /** Idempotent: returns the existing account when the number is already known (the writer then checks ownership). */
  ensureAccount(input: { accountNumber: string; clientId: string }): Promise<AccountRef>;
  findProducts(codes: string[]): Promise<Map<string, { id: string }>>;
  ensureProduct(input: { productCode: string; name: string; category: ProductCategoryName; isin: string | null }): Promise<{ id: string }>;
  findPositions(keys: PositionKey[]): Promise<Map<string, PositionRow>>;
  createPosition(input: { tradingAccountId: string; productId: string; quantity: number; avgCost: number | null; currentValue: number | null; asOfDate: Date; externalRef: string }): Promise<void>;
  updatePosition(id: string, input: { quantity: number; avgCost: number | null; currentValue: number | null }): Promise<void>;
  findTransactions(refs: string[]): Promise<Map<string, TransactionRow>>;
  createTransaction(input: Omit<TransactionRow, "id" | "transactionDate" | "settlementDate"> & { transactionDate: Date; settlementDate: Date | null; externalRef: string }): Promise<void>;
  updateTransaction(id: string, input: Omit<TransactionRow, "id" | "transactionDate" | "settlementDate"> & { transactionDate: Date; settlementDate: Date | null }): Promise<void>;
}

export type RowOutcome =
  | { index: number; status: "created" | "updated" | "unchanged" }
  | { index: number; status: "failed"; code: "ACCOUNT_OWNED_BY_OTHER_CUSTOMER" | "REFERENCE_OWNED_BY_OTHER_ACCOUNT" | "WRITE_FAILED" };

export type CustomerWriteOutcome = { holdings: RowOutcome[]; transactions: RowOutcome[] };

const failed = (index: number, code: Extract<RowOutcome, { status: "failed" }>["code"]): RowOutcome => ({ index, status: "failed", code });

/**
 * Writes one matched customer's rows. Natural keys make it replay-safe: positions by (source, externalRef, asOfDate),
 * transactions by (source, externalRef), accounts by account number, products by product code. A row whose values
 * already match what is stored is "unchanged" and causes no write. Failures are per row and carry a code only.
 */
export async function writeCustomerRows(repo: FeedRepo, clientId: string, mapped: Extract<MappedCustomer, { ok: true }>): Promise<CustomerWriteOutcome> {
  const { holdings, transactions } = mapped;
  const accountNumbers = [...new Set([...holdings.map((h) => h.accountNumber), ...transactions.map((t) => t.accountNumber)])];
  const productCodes = [...new Set([...holdings.map((h) => h.productCode), ...transactions.flatMap((t) => (t.productCode ? [t.productCode] : []))])];

  const [knownAccounts, knownProducts, knownPositions, knownTransactions] = await Promise.all([
    repo.findAccounts(accountNumbers),
    repo.findProducts(productCodes),
    repo.findPositions(holdings.map((h) => ({ externalRef: h.externalRef, asOfDate: h.asOfDate }))),
    repo.findTransactions(transactions.map((t) => t.externalRef)),
  ]);

  const accounts = new Map(knownAccounts);
  const products = new Map(knownProducts);

  async function accountFor(accountNumber: string): Promise<AccountRef | "other"> {
    let account = accounts.get(accountNumber);
    if (!account) {
      account = await repo.ensureAccount({ accountNumber, clientId });
      accounts.set(accountNumber, account);
    }
    return account.clientId === clientId ? account : "other";
  }
  async function productFor(code: string, name: string, category: ProductCategoryName, isin: string | null): Promise<{ id: string }> {
    let product = products.get(code);
    if (!product) {
      product = await repo.ensureProduct({ productCode: code, name, category, isin });
      products.set(code, product);
    }
    return product;
  }

  const holdingOutcomes: RowOutcome[] = [];
  for (const h of holdings) holdingOutcomes.push(await writeHolding(h));
  const transactionOutcomes: RowOutcome[] = [];
  for (const t of transactions) transactionOutcomes.push(await writeTransaction(t));
  return { holdings: holdingOutcomes, transactions: transactionOutcomes };

  async function writeHolding(h: MappedHolding): Promise<RowOutcome> {
    try {
      const account = await accountFor(h.accountNumber);
      if (account === "other") return failed(h.index, "ACCOUNT_OWNED_BY_OTHER_CUSTOMER");
      const product = await productFor(h.productCode, h.productName, h.category, h.isin);
      const existing = knownPositions.get(positionKey(h));
      if (existing) {
        if (existing.tradingAccountId !== account.id || existing.productId !== product.id) return failed(h.index, "REFERENCE_OWNED_BY_OTHER_ACCOUNT");
        if (existing.quantity === h.quantity && existing.avgCost === h.avgCost && existing.currentValue === h.currentValue) return { index: h.index, status: "unchanged" };
        await repo.updatePosition(existing.id, { quantity: h.quantity, avgCost: h.avgCost, currentValue: h.currentValue });
        return { index: h.index, status: "updated" };
      }
      await repo.createPosition({ tradingAccountId: account.id, productId: product.id, quantity: h.quantity, avgCost: h.avgCost, currentValue: h.currentValue, asOfDate: h.asOfDate, externalRef: h.externalRef });
      return { index: h.index, status: "created" };
    } catch (error) {
      logRowFailure("holding", error);
      return failed(h.index, "WRITE_FAILED");
    }
  }

  async function writeTransaction(t: MappedTransaction): Promise<RowOutcome> {
    try {
      const account = await accountFor(t.accountNumber);
      if (account === "other") return failed(t.index, "ACCOUNT_OWNED_BY_OTHER_CUSTOMER");
      const product = t.productCode ? await productFor(t.productCode, t.productCode, "OTHER", null) : null;
      const fields = {
        tradingAccountId: account.id,
        productId: product?.id ?? null,
        transactionType: t.transactionType,
        transactionDate: t.transactionDate,
        settlementDate: t.settlementDate,
        quantity: t.quantity,
        price: t.price,
        grossAmount: t.grossAmount,
        netAmount: t.netAmount,
        brokerageAmount: t.brokerageAmount,
      };
      const existing = knownTransactions.get(t.externalRef);
      if (existing) {
        if (existing.tradingAccountId !== account.id) return failed(t.index, "REFERENCE_OWNED_BY_OTHER_ACCOUNT");
        const same =
          existing.productId === fields.productId &&
          existing.transactionType === fields.transactionType &&
          existing.transactionDate === fields.transactionDate.getTime() &&
          existing.settlementDate === (fields.settlementDate?.getTime() ?? null) &&
          existing.quantity === fields.quantity &&
          existing.price === fields.price &&
          existing.grossAmount === fields.grossAmount &&
          existing.netAmount === fields.netAmount &&
          existing.brokerageAmount === fields.brokerageAmount;
        if (same) return { index: t.index, status: "unchanged" };
        await repo.updateTransaction(existing.id, fields);
        return { index: t.index, status: "updated" };
      }
      await repo.createTransaction({ ...fields, externalRef: t.externalRef });
      return { index: t.index, status: "created" };
    } catch (error) {
      logRowFailure("transaction", error);
      return failed(t.index, "WRITE_FAILED");
    }
  }
}

/** Logs the error class only: row values are personal financial data and never go to logs. */
function logRowFailure(kind: string, error: unknown) {
  console.error(`Portfolio feed: ${kind} row failed (${error instanceof Error ? error.name : "unknown"})`);
}
