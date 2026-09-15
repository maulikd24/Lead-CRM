"use server";

import Papa from "papaparse";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import type { RevenueType } from "@/generated/prisma/client";
import type { PortfolioImportRowOutcome } from "../households/import-actions";

// Same "generic batch-feed adapter stand-in" framing as households/import-actions.ts — CSV upload
// today for revenue types with no natural Transaction link (TRAIL_COMMISSION, AMC_PAYOUT, etc.);
// a real back-office feed would use its own sourceSystem value against the same upsert key.
const SOURCE_SYSTEM = "csv_import";
const IMPORT_ROW_CAP = 1000;

/**
 * Per-row core logic, deliberately not auth-gated itself — mirrors households/import-actions.ts's
 * importPositionRow() precedent. The TradingAccount must already exist (created during Workstream
 * 2 onboarding/import) — unlike Position/Transaction rows, a revenue row never auto-creates one.
 */
export async function importRevenueEventRow(row: Record<string, string>): Promise<{ status: "created" | "updated"; detail: string }> {
  const accountNumber = row.accountNumber?.trim();
  if (!accountNumber) throw new Error("accountNumber is required");
  const account = await prisma.tradingAccount.findUnique({ where: { accountNumber } });
  if (!account) throw new Error(`No TradingAccount found for accountNumber "${accountNumber}"`);

  const externalRef = row.externalRef?.trim();
  if (!externalRef) throw new Error("externalRef is required");

  const revenueType = (row.revenueType?.trim().toUpperCase() || "OTHER") as RevenueType;

  const grossRevenueAmount = Number(row.grossRevenueAmount);
  if (Number.isNaN(grossRevenueAmount)) throw new Error("Invalid grossRevenueAmount");

  const eventDate = row.eventDate?.trim() ? new Date(row.eventDate.trim()) : null;
  if (!eventDate || Number.isNaN(eventDate.getTime())) throw new Error("Invalid eventDate");

  const existing = await prisma.revenueEvent.findUnique({
    where: { sourceSystem_externalRef: { sourceSystem: SOURCE_SYSTEM, externalRef } },
  });

  await prisma.revenueEvent.upsert({
    where: { sourceSystem_externalRef: { sourceSystem: SOURCE_SYSTEM, externalRef } },
    update: { grossRevenueAmount, eventDate },
    create: {
      sourceSystem: SOURCE_SYSTEM,
      externalRef,
      tradingAccountId: account.id,
      clientId: account.clientId,
      revenueType,
      grossRevenueAmount,
      eventDate,
      rawPayload: row,
    },
  });

  return { status: existing ? "updated" : "created", detail: `${account.accountNumber} · ${revenueType}` };
}

async function runImport(formData: FormData): Promise<{ results: PortfolioImportRowOutcome[] }> {
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file uploaded");

  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const rows = parsed.data.slice(0, IMPORT_ROW_CAP);
  const results: PortfolioImportRowOutcome[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2; // +1 for zero-index, +1 for the header row
    try {
      const outcome = await importRevenueEventRow(rows[i]);
      results.push({ row: rowNumber, ...outcome });
    } catch (error) {
      results.push({ row: rowNumber, status: "failed", error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  return { results };
}

export async function bulkImportRevenueAction(formData: FormData): Promise<{ results: PortfolioImportRowOutcome[] }> {
  await requireRole(["ADMIN", "FINANCE"]);
  return runImport(formData);
}
