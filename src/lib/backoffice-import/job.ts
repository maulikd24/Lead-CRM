import { lstat, readFile, readdir } from "node:fs/promises";

import { cronRanSince, loadMapping, prismaRunDeps } from "./prisma-deps";
import { scanDirectory, type FsLike } from "./scan";
import { runBackOfficeImportTick, type TickResult } from "./tick";

const realFs: FsLike = {
  readdir: (dir) => readdir(dir),
  lstat: (path) => lstat(path),
  readFile: (path) => readFile(path, "utf8"),
};

/** Cron job: a no-op (no database, no file system) unless BACKOFFICE_IMPORT_ENABLED is on. */
export function runBackOfficeImport(): Promise<TickResult> {
  return runBackOfficeImportTick({
    env: process.env,
    now: () => Date.now(),
    cronRanSince,
    loadMapping,
    scan: ({ dir, mapping }) => scanDirectory({ dir, mapping, deps: prismaRunDeps(), fs: realFs }),
  });
}
