import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_MAPPING, type BackOfficeMapping } from "@/lib/backoffice-import/mapping";
import { kindLabel } from "@/lib/backoffice-import/labels";
import type { LastRun } from "@/lib/backoffice-import/prisma-deps";
import { MappingEditor } from "./mapping-editor";
import { RunSummary, type SummaryData } from "./run-summary";
import { UploadPanel } from "./upload-panel";

type RunRow = Omit<LastRun, "startedAt" | "finishedAt"> & { startedAt: string; finishedAt: string | null };
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

export function ImportView({ mapping, runs, directoryConfigured, nightlyHourUtc }: { mapping: BackOfficeMapping; runs: RunRow[]; directoryConfigured: boolean; nightlyHourUtc: number }) {
  const real = runs.find((r) => !r.dryRun);
  const fields = {
    clients: Object.keys(DEFAULT_MAPPING.clients),
    holdings: Object.keys(DEFAULT_MAPPING.holdings),
    transactions: Object.keys(DEFAULT_MAPPING.transactions),
  };
  const asSummary = (r: RunRow): SummaryData => ({
    kind: r.kind,
    status: r.status,
    dryRun: r.dryRun,
    fileName: r.fileName,
    counts: (r.counts as Record<string, unknown> | null) ?? {},
    errors: Array.isArray(r.errors) ? (r.errors as SummaryData["errors"]) : [],
    failureCode: (r.counts as { failureCode?: string } | null)?.failureCode,
    missingFields: (r.counts as { missingFields?: string[] } | null)?.missingFields,
  });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Last import</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            <Badge variant={directoryConfigured ? "success" : "outline"}>{directoryConfigured ? "Nightly folder import on" : "No drop folder set"}</Badge>
            {directoryConfigured ? `Runs once a night at ${String(nightlyHourUtc).padStart(2, "0")}:00 UTC.` : "Uploads below still work. Ask your administrator to set BACKOFFICE_IMPORT_DIR for the nightly import."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {real ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                {kindLabel(real.kind)} · {when(real.startedAt)} · {real.trigger === "CRON" ? "nightly job" : "uploaded"}
              </p>
              <RunSummary data={asSummary(real)} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing has been imported yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload a file</CardTitle>
          <CardDescription>Preview shows what would be created, updated or refused. Nothing is saved until you import. Clients are only ever matched on client code or PAN, and no client is created from a file.</CardDescription>
        </CardHeader>
        <CardContent>
          <UploadPanel />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Column mapping</CardTitle>
          <CardDescription>Tell the importer which column in your files holds each field. The defaults are the names in docs/backoffice-import.md, so a file in that layout needs no changes.</CardDescription>
        </CardHeader>
        <CardContent>
          <MappingEditor initial={mapping as never} fields={fields} />
        </CardContent>
      </Card>
    </div>
  );
}
