import { CSV_LIMITS } from "./csv";
import { kindForFileName, type BackOfficeMapping, type FileKind } from "./mapping";
import { runImport, type RunDeps } from "./runner";

export type FsLike = {
  readdir(dir: string): Promise<string[]>;
  lstat(path: string): Promise<{ isFile(): boolean; isSymbolicLink(): boolean; size: number }>;
  readFile(path: string): Promise<string>;
};

export type ScanResult = { files: number; imported: number; skippedDuplicate: number; failed: number; refused: number; deferred: number; directoryError?: string };

/** Files per scan; the rest wait for the next night. Keeps one tick inside its time budget. */
export const MAX_FILES_PER_SCAN = 10;
const ORDER: FileKind[] = ["CLIENTS", "HOLDINGS", "TRANSACTIONS"];

/**
 * Imports every recognised CSV in the drop directory, read-only: nothing is moved or deleted, because an unchanged
 * file is recognised by its checksum and skipped. Only plain files directly in the directory qualify (no symlinks, no
 * sub-directories, names matching the configured prefixes). Clients load first so holdings and transactions can match them.
 */
export async function scanDirectory(opts: { dir: string; mapping: BackOfficeMapping; deps: RunDeps; fs: FsLike; maxFiles?: number }): Promise<ScanResult> {
  const result: ScanResult = { files: 0, imported: 0, skippedDuplicate: 0, failed: 0, refused: 0, deferred: 0 };
  let names: string[];
  try {
    names = await opts.fs.readdir(opts.dir);
  } catch (error) {
    return { ...result, directoryError: typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "UNREADABLE" };
  }

  const candidates: { name: string; kind: FileKind }[] = [];
  for (const name of names) {
    const kind = kindForFileName(name, opts.mapping);
    if (!kind) continue;
    try {
      const stat = await opts.fs.lstat(`${opts.dir}/${name}`);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > CSV_LIMITS.maxBytes) {
        result.refused++;
        continue;
      }
    } catch {
      result.refused++;
      continue;
    }
    candidates.push({ name, kind });
  }
  candidates.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));

  const limit = opts.maxFiles ?? MAX_FILES_PER_SCAN;
  result.deferred = Math.max(0, candidates.length - limit);
  for (const { name, kind } of candidates.slice(0, limit)) {
    result.files++;
    let text: string;
    try {
      text = await opts.fs.readFile(`${opts.dir}/${name}`);
    } catch {
      result.failed++;
      continue;
    }
    const outcome = await runImport({ kind, text, fileName: name, dryRun: false, trigger: "CRON", userId: null }, opts.mapping, opts.deps);
    if (outcome.status === "SKIPPED_DUPLICATE") result.skippedDuplicate++;
    else if (outcome.status === "FAILED") result.failed++;
    else result.imported++;
  }
  return result;
}
