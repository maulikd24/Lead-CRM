"use server";

import Papa from "papaparse";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import type { ProductCategory, TradingAccountType, TransactionType } from "@/generated/prisma/client";

// Stand-in for the future back-office batch-file adapter (vendor not yet chosen, per the
// Distribution OS design) — CSV upload today, same idempotent sourceSystem/externalRef upsert
// keys a real feed adapter would use tomorrow.
const SOURCE_SYSTEM = "csv_import";
const IMPORT_ROW_CAP = 1000;

export type PortfolioImportRowOutcome =
  | { row: number; status: "created"; detail: string }
  | { row: number; status: "updated"; detail: string }
  | { row: number; status: "failed"; error: string };

async function resolveAccount(row: Record<string, string>, actorUserId: string) {
  const clientCode = row.clientCode?.trim();
  if (!clientCode) throw new Error("clientCode is required");
  const client = await prisma.client.findUnique({ where: { clientCode } });
  if (!client) throw new Error(`No client found for clientCode "${clientCode}"`);

  const accountNumber = row.accountNumber?.trim();
  if (!accountNumber) throw new Error("accountNumber is required");

  const accountType = (row.accountType?.trim().toUpperCase() || "EQUITY") as TradingAccountType;

  return prisma.tradingAccount.upsert({
    where: { accountNumber },
    update: {},
    create: {
      accountNumber,
      clientId: client.id,
      accountType,
      sourceSystem: SOURCE_SYSTEM,
      externalRef: accountNumber,
      rmAtOpeningId: client.assignedToId ?? actorUserId,
    },
  });
}

async function resolveProduct(row: Record<string, string>) {
  const productCode = row.productCode?.trim();
  if (!productCode) throw new Error("productCode is required");

  return prisma.product.upsert({
    where: { productCode },
    update: {},
    create: {
      productCode,
      name: row.productName?.trim() || productCode,
      category: (row.productCategory?.trim().toUpperCase() || "OTHER") as ProductCategory,
      sourceSystem: SOURCE_SYSTEM,
      externalRef: productCode,
    },
  });
}

/**
 * Per-row core logic, deliberately NOT auth-gated itself — mirrors clients/actions.ts's
 * createClientCore() precedent, where the exported bulk action does requireRole() once and this
 * function does the actual work. Upserts by (sourceSystem, externalRef[, asOfDate]) — safely
 * re-runnable, matching the DailyJobRun/Document.externalId idempotency precedent.
 */
export async function importPositionRow(row: Record<string, string>, actorUserId: string): Promise<{ status: "created" | "updated"; detail: string }> {
  const account = await resolveAccount(row, actorUserId);
  const product = await resolveProduct(row);

  const externalRef = row.externalRef?.trim() || `${account.accountNumber}-${product.productCode}`;
  const asOfDate = row.asOfDate?.trim() ? new Date(row.asOfDate.trim()) : new Date();
  if (Number.isNaN(asOfDate.getTime())) throw new Error("Invalid asOfDate");

  const quantity = Number(row.quantity);
  if (Number.isNaN(quantity)) throw new Error("Invalid quantity");

  const existing = await prisma.position.findUnique({
    where: { sourceSystem_externalRef_asOfDate: { sourceSystem: SOURCE_SYSTEM, externalRef, asOfDate } },
  });

  await prisma.position.upsert({
    where: { sourceSystem_externalRef_asOfDate: { sourceSystem: SOURCE_SYSTEM, externalRef, asOfDate } },
    update: {
      quantity,
      avgCost: row.avgCost?.trim() ? Number(row.avgCost) : null,
      currentValue: row.currentValue?.trim() ? Number(row.currentValue) : null,
    },
    create: {
      tradingAccountId: account.id,
      productId: product.id,
      quantity,
      avgCost: row.avgCost?.trim() ? Number(row.avgCost) : null,
      currentValue: row.currentValue?.trim() ? Number(row.currentValue) : null,
      asOfDate,
      sourceSystem: SOURCE_SYSTEM,
      externalRef,
    },
  });

  return { status: existing ? "updated" : "created", detail: `${account.accountNumber} · ${product.productCode}` };
}

/** Same shape as importPositionRow, for Transaction rows. */
export async function importTransactionRow(row: Record<string, string>, actorUserId: string): Promise<{ status: "created" | "updated"; detail: string }> {
  const account = await resolveAccount(row, actorUserId);
  const product = row.productCode?.trim() ? await resolveProduct(row) : null;

  const externalRef = row.externalRef?.trim();
  if (!externalRef) throw new Error("externalRef is required");

  const transactionDate = row.transactionDate?.trim() ? new Date(row.transactionDate.trim()) : null;
  if (!transactionDate || Number.isNaN(transactionDate.getTime())) throw new Error("Invalid transactionDate");

  const grossAmount = Number(row.grossAmount);
  if (Number.isNaN(grossAmount)) throw new Error("Invalid grossAmount");

  const existing = await prisma.transaction.findUnique({
    where: { sourceSystem_externalRef: { sourceSystem: SOURCE_SYSTEM, externalRef } },
  });
  const tradeFields = {
    tradingAccountId: account.id,
    productId: product?.id ?? null,
    transactionType: (row.transactionType?.trim().toUpperCase() || "OTHER") as TransactionType,
    transactionDate,
    quantity: row.quantity?.trim() ? Number(row.quantity) : null,
    price: row.price?.trim() ? Number(row.price) : null,
    grossAmount,
    netAmount: row.netAmount?.trim() ? Number(row.netAmount) : null,
    brokerageAmount: row.brokerageAmount?.trim() ? Number(row.brokerageAmount) : null,
  };

  await prisma.transaction.upsert({
    where: { sourceSystem_externalRef: { sourceSystem: SOURCE_SYSTEM, externalRef } },
    // A re-import must refresh every mutable field (the back office can correct a trade), not just the amount.
    update: tradeFields,
    create: { ...tradeFields, sourceSystem: SOURCE_SYSTEM, externalRef },
  });

  return {
    status: existing ? "updated" : "created",
    detail: `${account.accountNumber} · ${row.transactionType || "OTHER"}`,
  };
}

const PAYMENT_TYPES = new Set(["FUNDS_IN", "FUNDS_OUT", "FEE", "OTHER"]);
const PAYMENT_STATUSES = new Set(["SUCCESS", "PENDING", "FAILED"]);

/**
 * Same shape as importTransactionRow, for ClientPayment rows (funds in/out, fees). Client is resolved by
 * clientCode; accountNumber is optional. Upserts by (sourceSystem, externalRef) so re-runs and corrections are safe.
 * Exported separately from the role-gated action so a future live back-office adapter can call it directly.
 */
export async function importPaymentRow(row: Record<string, string>, _actorUserId: string): Promise<{ status: "created" | "updated"; detail: string }> {
  void _actorUserId;
  const clientCode = row.clientCode?.trim();
  if (!clientCode) throw new Error("clientCode is required");
  const client = await prisma.client.findUnique({ where: { clientCode }, select: { id: true } });
  if (!client) throw new Error(`No client found for clientCode "${clientCode}"`);

  const externalRef = row.externalRef?.trim();
  if (!externalRef) throw new Error("externalRef is required");

  const paidAt = row.paidAt?.trim() ? new Date(row.paidAt.trim()) : null;
  if (!paidAt || Number.isNaN(paidAt.getTime())) throw new Error("Invalid paidAt");

  const amount = Number(row.amount);
  if (row.amount === undefined || row.amount.trim() === "" || Number.isNaN(amount) || amount < 0) throw new Error("Invalid amount");

  const paymentType = (row.paymentType?.trim().toUpperCase() || "FUNDS_IN") as "FUNDS_IN" | "FUNDS_OUT" | "FEE" | "OTHER";
  if (!PAYMENT_TYPES.has(paymentType)) throw new Error(`Unknown paymentType "${row.paymentType}" (use FUNDS_IN, FUNDS_OUT, FEE or OTHER)`);
  const status = row.status?.trim().toUpperCase() || "SUCCESS";
  if (!PAYMENT_STATUSES.has(status)) throw new Error(`Unknown status "${row.status}" (use SUCCESS, PENDING or FAILED)`);

  const accountNumber = row.accountNumber?.trim();
  const account = accountNumber ? await prisma.tradingAccount.findUnique({ where: { accountNumber }, select: { id: true, clientId: true } }) : null;
  if (accountNumber && (!account || account.clientId !== client.id)) {
    throw new Error(`Account "${accountNumber}" doesn't belong to client "${clientCode}"`);
  }

  const existing = await prisma.clientPayment.findUnique({
    where: { sourceSystem_externalRef: { sourceSystem: SOURCE_SYSTEM, externalRef } },
    select: { clientId: true },
  });
  if (existing && existing.clientId !== client.id) throw new Error(`externalRef "${externalRef}" already belongs to a different client`);

  const fields = {
    clientId: client.id,
    tradingAccountId: account?.id ?? null,
    paymentType,
    amount,
    paidAt,
    mode: row.mode?.trim() || null,
    referenceNumber: row.referenceNumber?.trim() || null,
    status,
  };
  await prisma.clientPayment.upsert({
    where: { sourceSystem_externalRef: { sourceSystem: SOURCE_SYSTEM, externalRef } },
    update: fields,
    create: { ...fields, sourceSystem: SOURCE_SYSTEM, externalRef },
  });

  return { status: existing ? "updated" : "created", detail: `${clientCode} · ${paymentType.replace("_", " ").toLowerCase()} ₹${amount}` };
}

async function runImport(
  formData: FormData,
  actorUserId: string,
  importRow: (row: Record<string, string>, actorUserId: string) => Promise<{ status: "created" | "updated"; detail: string }>,
): Promise<{ results: PortfolioImportRowOutcome[] }> {
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file uploaded");

  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const rows = parsed.data.slice(0, IMPORT_ROW_CAP);
  const results: PortfolioImportRowOutcome[] = [];

  // Sequential, not parallel — matches bulkImportClientsAction's convention so an
  // account/product created earlier in the same batch is visible to a later row referencing it.
  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2; // +1 for zero-index, +1 for the header row
    try {
      const outcome = await importRow(rows[i], actorUserId);
      results.push({ row: rowNumber, ...outcome });
    } catch (error) {
      results.push({ row: rowNumber, status: "failed", error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  return { results };
}

export async function bulkImportPositionsAction(formData: FormData): Promise<{ results: PortfolioImportRowOutcome[] }> {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  return runImport(formData, session.user.id, importPositionRow);
}

export async function bulkImportTransactionsAction(formData: FormData): Promise<{ results: PortfolioImportRowOutcome[] }> {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  return runImport(formData, session.user.id, importTransactionRow);
}

export async function bulkImportPaymentsAction(formData: FormData): Promise<{ results: PortfolioImportRowOutcome[] }> {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  return runImport(formData, session.user.id, importPaymentRow);
}
