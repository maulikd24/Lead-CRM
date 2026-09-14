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

  await prisma.transaction.upsert({
    where: { sourceSystem_externalRef: { sourceSystem: SOURCE_SYSTEM, externalRef } },
    update: { grossAmount },
    create: {
      tradingAccountId: account.id,
      productId: product?.id,
      transactionType: (row.transactionType?.trim().toUpperCase() || "OTHER") as TransactionType,
      transactionDate,
      quantity: row.quantity?.trim() ? Number(row.quantity) : null,
      price: row.price?.trim() ? Number(row.price) : null,
      grossAmount,
      netAmount: row.netAmount?.trim() ? Number(row.netAmount) : null,
      brokerageAmount: row.brokerageAmount?.trim() ? Number(row.brokerageAmount) : null,
      sourceSystem: SOURCE_SYSTEM,
      externalRef,
    },
  });

  return {
    status: existing ? "updated" : "created",
    detail: `${account.accountNumber} · ${row.transactionType || "OTHER"}`,
  };
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
