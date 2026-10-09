import { prisma } from "@/lib/db/prisma";
import { logUserEvent } from "@/lib/activity/log-user-event";

import type { IngestSummary } from "./ingest";
import type { CustomerIdentity } from "./mapper";
import type { IdentityHits } from "./match";
import { canonDecimal } from "./decimal";
import { FEED_SOURCE_SYSTEM, positionKey, type FeedRepo, type PositionRow, type TransactionRow } from "./write";

const dec = (v: { toString(): string } | null | undefined): string | null => (v === null || v === undefined ? null : canonDecimal(v.toString()));

/** Every active (not archived, not merged) client id per last-10-digit phone key. Unlike findClientsByPhoneKeys it does
 * NOT collapse a shared number to one winner: the matcher needs to see all of them to refuse an ambiguous write. */
export async function findAllClientIdsByPhoneKeys(keys: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (keys.length === 0) return out;
  const rows = await prisma.$queryRaw<{ id: string; key: string }[]>`
    SELECT id, right(regexp_replace(mobile, '[^0-9]', '', 'g'), 10) AS key
    FROM "Client"
    WHERE "isDeleted" = false AND "mergedIntoId" IS NULL AND mobile IS NOT NULL
      AND right(regexp_replace(mobile, '[^0-9]', '', 'g'), 10) = ANY(${keys}::text[])`;
  for (const r of rows) out.set(r.key, [...(out.get(r.key) ?? []), r.id]);
  return out;
}

/** Read-only customer lookup. Excludes archived and merged customers; never creates anything. Returns all ids per identifier. */
export async function lookupCustomers(identities: CustomerIdentity[]): Promise<IdentityHits[]> {
  const codes = [...new Set(identities.flatMap((i) => (i.clientCode ? [i.clientCode] : [])))];
  const pans = [...new Set(identities.flatMap((i) => (i.pan ? [i.pan] : [])))];
  const emails = [...new Set(identities.flatMap((i) => (i.email ? [i.email] : [])))];
  const phoneKeys = [...new Set(identities.flatMap((i) => (i.phoneKey ? [i.phoneKey] : [])))];

  const or = [
    ...(codes.length ? [{ clientCode: { in: codes } }] : []),
    ...(pans.length ? [{ pan: { in: pans } }] : []),
    ...(emails.length ? [{ email: { in: emails, mode: "insensitive" as const } }] : []),
  ];
  const [rows, byPhone] = await Promise.all([
    or.length ? prisma.client.findMany({ where: { isDeleted: false, mergedIntoId: null, OR: or }, select: { id: true, clientCode: true, pan: true, email: true } }) : [],
    findAllClientIdsByPhoneKeys(phoneKeys),
  ]);

  return identities.map((i) => {
    const hits: IdentityHits = {};
    if (i.clientCode) hits.clientCode = rows.filter((r) => r.clientCode.toUpperCase() === i.clientCode).map((r) => r.id);
    if (i.pan) hits.pan = rows.filter((r) => r.pan === i.pan).map((r) => r.id);
    if (i.email) hits.email = rows.filter((r) => r.email?.trim().toLowerCase() === i.email).map((r) => r.id);
    if (i.phoneKey) hits.phoneKey = byPhone.get(i.phoneKey) ?? [];
    return hits;
  });
}

export const prismaFeedRepo: FeedRepo = {
  async findAccounts(numbers) {
    const rows = numbers.length ? await prisma.tradingAccount.findMany({ where: { accountNumber: { in: numbers } }, select: { id: true, clientId: true, accountNumber: true } }) : [];
    return new Map(rows.map((r) => [r.accountNumber, { id: r.id, clientId: r.clientId }]));
  },
  async ensureAccount({ accountNumber, clientId }) {
    const row = await prisma.tradingAccount.upsert({
      where: { accountNumber },
      update: {},
      create: { accountNumber, clientId, accountType: "OTHER", sourceSystem: FEED_SOURCE_SYSTEM, externalRef: accountNumber },
      select: { id: true, clientId: true },
    });
    return { id: row.id, clientId: row.clientId };
  },
  async findProducts(codes) {
    const rows = codes.length ? await prisma.product.findMany({ where: { productCode: { in: codes } }, select: { id: true, productCode: true } }) : [];
    return new Map(rows.map((r) => [r.productCode, { id: r.id }]));
  },
  async ensureProduct({ productCode, name, category, isin }) {
    // ISIN is unique across products: drop it rather than fail the row when another product already owns it.
    const isinTaken = isin ? await prisma.product.findUnique({ where: { isin }, select: { id: true } }) : null;
    const row = await prisma.product.upsert({
      where: { productCode },
      update: {},
      create: { productCode, name, category, isin: isinTaken ? null : isin, sourceSystem: FEED_SOURCE_SYSTEM, externalRef: productCode },
      select: { id: true },
    });
    return { id: row.id };
  },
  async findPositions(keys) {
    if (keys.length === 0) return new Map();
    const rows = await prisma.position.findMany({
      where: { sourceSystem: FEED_SOURCE_SYSTEM, externalRef: { in: [...new Set(keys.map((k) => k.externalRef))] }, asOfDate: { in: [...new Set(keys.map((k) => k.asOfDate.getTime()))].map((t) => new Date(t)) } },
    });
    const out = new Map<string, PositionRow>();
    for (const r of rows) out.set(positionKey({ externalRef: r.externalRef, asOfDate: r.asOfDate }), { id: r.id, tradingAccountId: r.tradingAccountId, productId: r.productId, quantity: dec(r.quantity) as string, avgCost: dec(r.avgCost), currentValue: dec(r.currentValue), revision: r.feedRevision });
    return out;
  },
  async createPosition(input) {
    const { revision, ...rest } = input;
    await prisma.position.create({ data: { ...rest, feedRevision: revision, sourceSystem: FEED_SOURCE_SYSTEM } });
  },
  async updatePosition(id, input) {
    const { revision, ...rest } = input;
    await prisma.position.update({ where: { id }, data: { ...rest, feedRevision: revision } });
  },
  async findTransactions(refs) {
    if (refs.length === 0) return new Map();
    const rows = await prisma.transaction.findMany({ where: { sourceSystem: FEED_SOURCE_SYSTEM, externalRef: { in: refs } } });
    const out = new Map<string, TransactionRow>();
    for (const r of rows)
      out.set(r.externalRef, {
        id: r.id,
        tradingAccountId: r.tradingAccountId,
        productId: r.productId,
        transactionType: r.transactionType,
        transactionDate: r.transactionDate.getTime(),
        settlementDate: r.settlementDate?.getTime() ?? null,
        quantity: dec(r.quantity),
        price: dec(r.price),
        grossAmount: dec(r.grossAmount) as string,
        netAmount: dec(r.netAmount),
        brokerageAmount: dec(r.brokerageAmount),
        revision: r.feedRevision,
      });
    return out;
  },
  async createTransaction(input) {
    const { revision, ...rest } = input;
    await prisma.transaction.create({ data: { ...rest, feedRevision: revision, sourceSystem: FEED_SOURCE_SYSTEM } });
  },
  async updateTransaction(id, input) {
    const { revision, ...rest } = input;
    await prisma.transaction.update({ where: { id }, data: { ...rest, feedRevision: revision } });
  },
};

/** Audit record in the existing user-event log: counts only, never identifiers or values. */
export async function auditBatch(summary: IngestSummary): Promise<void> {
  const c = summary.counts;
  await logUserEvent({
    type: "DATA_UPDATE",
    entity: "PortfolioFeed",
    entityId: summary.batchId,
    summary: `Portfolio feed batch: ${c.customers.matched}/${c.customers.received} customers matched`,
    details: { customers: c.customers, holdings: c.holdings, transactions: c.transactions },
  });
}
