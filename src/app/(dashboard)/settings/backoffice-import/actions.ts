"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole } from "@/lib/auth/require-role";
import { CSV_LIMITS } from "@/lib/backoffice-import/csv";
import { backofficeImportEnabled } from "@/lib/backoffice-import/flag";
import { loadMapping, prismaRunDeps, saveMapping } from "@/lib/backoffice-import/prisma-deps";
import { runImport, type ImportOutcome } from "@/lib/backoffice-import/runner";

const kindSchema = z.enum(["CLIENTS", "HOLDINGS", "TRANSACTIONS"]);

export type UploadResult = { ok: true; outcome: ImportOutcome } | { ok: false; message: string };
export type SaveResult = { ok: true } | { ok: false; message: string };

const safeName = (raw: string) => (/^[A-Za-z0-9._-]{1,100}$/.test(raw) ? raw : "upload.csv");

/** Admin upload: the same importer the nightly job uses. `dryRun` (the default in the UI) changes nothing and shows what would change. */
export async function runUploadAction(formData: FormData): Promise<UploadResult> {
  const session = await requireRole(["ADMIN"]);
  if (!backofficeImportEnabled()) return { ok: false, message: "The back-office import is switched off." };

  const kind = kindSchema.safeParse(formData.get("kind"));
  const file = formData.get("file");
  if (!kind.success) return { ok: false, message: "Choose which kind of file this is." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a CSV file." };
  if (file.size > CSV_LIMITS.maxBytes) return { ok: false, message: `That file is larger than ${CSV_LIMITS.maxBytes / 1_000_000} MB.` };

  const text = await file.text();
  const outcome = await runImport(
    { kind: kind.data, text, fileName: safeName(file.name), dryRun: formData.get("dryRun") !== "false", trigger: "UPLOAD", userId: session.user.id, force: formData.get("force") === "true" },
    await loadMapping(),
    prismaRunDeps(),
  );
  revalidatePath("/settings/backoffice-import");
  return { ok: true, outcome };
}

export async function saveMappingAction(json: string): Promise<SaveResult> {
  const session = await requireRole(["ADMIN"]);
  if (!backofficeImportEnabled()) return { ok: false, message: "The back-office import is switched off." };
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { ok: false, message: "The mapping is not valid JSON." };
  }
  const result = await saveMapping(value, session.user.id);
  if (!result.ok) return { ok: false, message: `The mapping was not saved. Check: ${result.issues.map((i) => i.path).join(", ")}.` };
  revalidatePath("/settings/backoffice-import");
  return { ok: true };
}
