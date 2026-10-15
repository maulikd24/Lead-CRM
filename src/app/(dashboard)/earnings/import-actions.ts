"use server";

import Papa from "papaparse";

import { requireRole } from "@/lib/auth/require-role";
import { importRevenueEventRow } from "@/lib/imports/revenue-rows";
import type { PortfolioImportRowOutcome } from "../households/import-actions";

const IMPORT_ROW_CAP = 1000;

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
