/** The sections of the back-office importer, in the order a file moves through them. */
export const IMPORT_TABS = [
  { key: "upload", label: "Upload" },
  { key: "preview", label: "Preview" },
  { key: "runs", label: "Runs" },
  { key: "mapping", label: "Mapping" },
] as const;

export type ImportTabKey = (typeof IMPORT_TABS)[number]["key"];

/** How a run began, in words: a dry run changes nothing, so it says so. */
export function runLine(dryRun: boolean, trigger: string): string {
  const how = trigger === "CRON" ? "nightly job" : "uploaded";
  return dryRun ? `Preview, ${how}` : `Import, ${how}`;
}
