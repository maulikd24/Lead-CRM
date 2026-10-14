"use server";

import Papa from "papaparse";

import { requireRole } from "@/lib/auth/require-role";
import { importPaymentRow, importPositionRow, importTransactionRow } from "@/lib/imports/portfolio-rows";

const IMPORT_ROW_CAP = 1000;

export type PortfolioImportRowOutcome =
  | { row: number; status: "created"; detail: string }
  | { row: number; status: "updated"; detail: string }
  | { row: number; status: "failed"; error: string };

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
