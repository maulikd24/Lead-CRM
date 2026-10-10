/** The back-office file importer is off unless BACKOFFICE_IMPORT_ENABLED is "1"/"true". Everything (cron job, settings page, upload) checks this first. */
export function backofficeImportEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BACKOFFICE_IMPORT_ENABLED === "1" || env.BACKOFFICE_IMPORT_ENABLED === "true";
}

/** Uploads work whenever the flag is on; the drop directory is optional. */
export const backofficeImportConfigured = backofficeImportEnabled;

/** Drop directory scanned by the nightly job: an absolute path set by ops (infrastructure, not a Settings value). */
export function backofficeImportDir(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!backofficeImportEnabled(env)) return null;
  const dir = env.BACKOFFICE_IMPORT_DIR?.trim();
  return dir && dir.startsWith("/") ? dir : null;
}
