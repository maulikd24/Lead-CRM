import { backofficeImportDir, backofficeImportEnabled } from "./flag";
import type { BackOfficeMapping } from "./mapping";
import type { ScanResult } from "./scan";

export type TickDeps = {
  env: NodeJS.ProcessEnv;
  now: () => number;
  /** A cron-triggered run has already started since this instant. */
  cronRanSince: (since: Date) => Promise<boolean>;
  loadMapping: () => Promise<BackOfficeMapping>;
  scan: (opts: { dir: string; mapping: BackOfficeMapping }) => Promise<ScanResult>;
};

export type TickResult = { skipped: "disabled" | "no_directory" | "outside_window" | "already_ran_today" } | ({ ran: true } & ScanResult);

/** 21:00 UTC is 02:30 in India: after the back office's end-of-day export, before the working day starts. */
const DEFAULT_HOUR_UTC = 21;

function windowHour(env: NodeJS.ProcessEnv): number {
  const n = Number(env.BACKOFFICE_IMPORT_HOUR_UTC);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : DEFAULT_HOUR_UTC;
}

/**
 * Cron-tick entry point. A no-op, touching neither the database nor the file system, unless BACKOFFICE_IMPORT_ENABLED
 * is on, a drop directory is configured, the clock is inside the nightly hour and no cron run has started today.
 * Returns counts only.
 */
export async function runBackOfficeImportTick(deps: TickDeps): Promise<TickResult> {
  if (!backofficeImportEnabled(deps.env)) return { skipped: "disabled" };
  const dir = backofficeImportDir(deps.env);
  if (!dir) return { skipped: "no_directory" };

  const now = new Date(deps.now());
  if (now.getUTCHours() !== windowHour(deps.env)) return { skipped: "outside_window" };
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (await deps.cronRanSince(dayStart)) return { skipped: "already_ran_today" };

  const mapping = await deps.loadMapping();
  return { ran: true, ...(await deps.scan({ dir, mapping })) };
}
