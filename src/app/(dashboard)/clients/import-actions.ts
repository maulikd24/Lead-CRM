"use server";

import Papa from "papaparse";

import { requireRole } from "@/lib/auth/require-role";
import { PAN_REGEX } from "@/lib/utils/normalize-contact";
import { createClientCore } from "./actions";

export type ImportRowOutcome =
  | { row: number; status: "created"; clientCode: string; name: string }
  | { row: number; status: "duplicate"; name: string; reason: string }
  | { row: number; status: "failed"; name: string; error: string };

// Safety valve for a single import batch — not a hard product limit, just a sane ceiling.
const IMPORT_ROW_CAP = 1000;

function reasonLabel(reason: "pan" | "ckycRef" | "mobile_or_email" | null): string {
  if (reason === "pan") return "PAN already exists";
  if (reason === "ckycRef") return "CKYC reference already exists";
  return "Mobile/email already exists";
}

/**
 * Every row goes through createClientCore — the exact same PAN-required, PAN/CKYC-hard-block,
 * mobile/email-soft-duplicate validation as manual single-client creation. No bypass, no
 * per-row override: a duplicate in a batch import is skipped and reported, not created.
 */
export async function bulkImportClientsAction(formData: FormData): Promise<{ results: ImportRowOutcome[] }> {
  const session = await requireRole(["ADMIN", "MANAGER"]);

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file uploaded");

  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const rows = parsed.data.slice(0, IMPORT_ROW_CAP);
  const results: ImportRowOutcome[] = [];

  // Sequential, not parallel — a later row sharing a PAN with an earlier row in this same batch
  // must be caught as a duplicate against the just-created record, not race past it.
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2; // +1 for zero-index, +1 for the header row
    const name = (row.name || "").trim();

    try {
      if (!name) throw new Error("Name is required");
      if (!row.mobile?.trim()) throw new Error("Mobile is required");
      const pan = (row.pan || "").trim().toUpperCase();
      if (!PAN_REGEX.test(pan)) throw new Error("Invalid PAN format (expected e.g. ABCDE1234F)");

      const result = await createClientCore(
        {
          name,
          mobile: row.mobile.trim(),
          pan,
          email: row.email?.trim() || undefined,
          ckycRef: row.ckycRef?.trim() || undefined,
          region: row.region?.trim() || undefined,
          preferredLanguage: row.preferredLanguage?.trim() || undefined,
          clientType: row.clientType?.trim() || undefined,
          leadSource: row.leadSource?.trim() || "bulk_import",
          referralSource: row.referralSource?.trim() || undefined,
          notes: row.notes?.trim() || undefined,
          city: row.city?.trim() || undefined,
          state: row.state?.trim() || undefined,
          productInterest: row.productInterest?.trim() || undefined,
          existingBroker: row.existingBroker?.trim() || undefined,
          tradingExperience: row.tradingExperience?.trim() || undefined,
        },
        session.user.id,
      );

      if (result.status === "created") {
        results.push({ row: rowNumber, status: "created", clientCode: result.client.clientCode, name: result.client.name });
      } else {
        results.push({ row: rowNumber, status: "duplicate", name, reason: reasonLabel(result.reason) });
      }
    } catch (error) {
      results.push({
        row: rowNumber,
        status: "failed",
        name: name || `Row ${rowNumber}`,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return { results };
}
