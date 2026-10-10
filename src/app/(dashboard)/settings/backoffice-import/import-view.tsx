"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CountUp, RailCard, RailFact, StickyRail, WorkspaceHeading, WorkspacePanel, WorkspaceShell, WorkspaceTabs, useUrlTab } from "@/components/workspace";
import { DEFAULT_MAPPING, type BackOfficeMapping } from "@/lib/backoffice-import/mapping";
import { kindLabel } from "@/lib/backoffice-import/labels";
import type { LastRun } from "@/lib/backoffice-import/prisma-deps";
import { IMPORT_TABS, runLine, type ImportTabKey } from "@/lib/backoffice-import/tabs";
import { MappingEditor } from "./mapping-editor";
import { RunSummary, type SummaryData } from "./run-summary";
import { PreviewPane, UploadForm, useUploadFlow } from "./upload-panel";

type RunRow = Omit<LastRun, "startedAt" | "finishedAt"> & { startedAt: string; finishedAt: string | null };
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "outline"> = { SUCCESS: "success", PARTIAL: "warning", FAILED: "destructive" };
const TAB_KEYS = IMPORT_TABS.map((t) => t.key);

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

/** The back-office importer as a tabbed workspace: Upload, Preview, Runs, Mapping. One section at a time; the rail keeps the nightly status and last import in view. */
export function ImportView({ mapping, runs, directoryConfigured, nightlyHourUtc }: { mapping: BackOfficeMapping; runs: RunRow[]; directoryConfigured: boolean; nightlyHourUtc: number }) {
  const { tab, select, hrefFor } = useUrlTab(TAB_KEYS, "upload");
  const flow = useUploadFlow(() => select("preview"));
  const real = runs.find((r) => !r.dryRun);
  const fields = {
    clients: Object.keys(DEFAULT_MAPPING.clients),
    holdings: Object.keys(DEFAULT_MAPPING.holdings),
    transactions: Object.keys(DEFAULT_MAPPING.transactions),
  };
  const nightly = directoryConfigured ? `Runs once a night at ${String(nightlyHourUtc).padStart(2, "0")}:00 UTC.` : "Uploads still work. Ask your administrator to set BACKOFFICE_IMPORT_DIR for the nightly import.";
  const tabs = IMPORT_TABS.map((t) => ({ key: t.key, label: t.label, count: t.key === "runs" ? runs.length : t.key === "preview" && flow.result?.ok ? 1 : null }));

  return (
    <WorkspaceShell
      hasRail
      header={<WorkspaceHeading title="Back-office import" description="Load client, holdings and transaction files from the back office. Preview first: a dry run changes nothing." />}
      tabs={<WorkspaceTabs tabs={tabs} active={tab} idPrefix="bo" label="Importer sections" hrefFor={hrefFor} onSelect={(k) => select(k as ImportTabKey)} />}
      rail={
        <StickyRail
          label="Import status"
          facts={
            <>
              <RailFact label="Nightly folder import" index={0} tone={directoryConfigured ? "success" : "default"} hint={nightly}>{directoryConfigured ? "On" : "No drop folder set"}</RailFact>
              <RailFact label="Last import" index={1} hint={real ? `${when(real.startedAt)} · ${real.trigger === "CRON" ? "nightly job" : "uploaded"}` : undefined}>{real ? kindLabel(real.kind) : "None yet"}</RailFact>
              <RailFact label="Runs on record" index={2}><CountUp value={runs.length} label="Runs on record" /></RailFact>
            </>
          }
        >
          <RailCard title="Before you import" labelId="bo-rules" index={3}>
            <ul className="flex list-disc flex-col gap-1.5 pl-4 text-xs text-muted-foreground">
              <li>Preview shows what would be created, updated or refused.</li>
              <li>Nothing is saved until you import.</li>
              <li>Clients are only ever matched on client code or PAN, and no client is created from a file.</li>
            </ul>
          </RailCard>
        </StickyRail>
      }
    >
      <WorkspacePanel tab={tab} idPrefix="bo">
        {tab === "upload" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Upload a file</CardTitle>
              <CardDescription>Preview shows what would be created, updated or refused. Nothing is saved until you import. Clients are only ever matched on client code or PAN, and no client is created from a file.</CardDescription>
            </CardHeader>
            <CardContent>
              <UploadForm flow={flow} />
            </CardContent>
          </Card>
        )}

        {tab === "preview" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preview</CardTitle>
              <CardDescription>What the file would do. A dry run changes nothing.</CardDescription>
            </CardHeader>
            <CardContent>
              <PreviewPane flow={flow} onBack={() => select("upload")} />
            </CardContent>
          </Card>
        )}

        {tab === "runs" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Runs</CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-2">
                <Badge variant={directoryConfigured ? "success" : "outline"}>{directoryConfigured ? "Nightly folder import on" : "No drop folder set"}</Badge>
                {nightly}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {runs.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing has been imported yet.</p>
              ) : (
                runs.map((r, i) => (
                  <details key={r.id} open={i === 0} className="group rounded-lg border">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                      <Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status === "SKIPPED_DUPLICATE" ? "Skipped" : r.status === "PARTIAL" ? "Row problems" : r.status.charAt(0) + r.status.slice(1).toLowerCase()}</Badge>
                      <span className="font-medium">{kindLabel(r.kind)}</span>
                      <span className="text-muted-foreground">{runLine(r.dryRun, r.trigger)} · {when(r.startedAt)}</span>
                      <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{r.fileName}</span>
                    </summary>
                    <div className="border-t px-3 py-3">
                      <RunSummary data={asSummary(r)} />
                    </div>
                  </details>
                ))
              )}
            </CardContent>
          </Card>
        )}

        {tab === "mapping" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Column mapping</CardTitle>
              <CardDescription>Tell the importer which column in your files holds each field. The defaults are the names in docs/backoffice-import.md, so a file in that layout needs no changes.</CardDescription>
            </CardHeader>
            <CardContent>
              <MappingEditor initial={mapping as never} fields={fields} />
            </CardContent>
          </Card>
        )}
      </WorkspacePanel>
    </WorkspaceShell>
  );
}
