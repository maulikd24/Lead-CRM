/** The back-office file importer is off unless BACKOFFICE_IMPORT_ENABLED is exactly "1" (same rule as every flag, so the nav item and the page cannot disagree). Everything (cron job, settings page, upload) checks this first. */
type Env = Record<string, string | undefined>;

export function backofficeImportEnabled(env: Env = process.env): boolean {
  return env.BACKOFFICE_IMPORT_ENABLED === "1";
}

/** Uploads work whenever the flag is on; the drop directory is optional. */
export const backofficeImportConfigured = backofficeImportEnabled;

/** Drop directory scanned by the nightly job: an absolute path set by ops (infrastructure, not a Settings value). */
export function backofficeImportDir(env: Env = process.env): string | null {
  if (!backofficeImportEnabled(env)) return null;
  const dir = env.BACKOFFICE_IMPORT_DIR?.trim();
  return dir && dir.startsWith("/") ? dir : null;
}
