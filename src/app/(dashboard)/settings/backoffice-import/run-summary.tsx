import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CountUp } from "@/components/workspace";
import { errorLabel, failureLabel, kindLabel } from "@/lib/backoffice-import/labels";

type Counts = Record<string, number>;
export type SummaryData = {
  kind: string;
  status: string;
  dryRun: boolean;
  fileName?: string;
  counts: Record<string, unknown>;
  errors: { line: number; code: string; fields: string[] }[];
  errorsTruncated?: boolean;
  failureCode?: string;
  missingFields?: string[];
  reason?: string;
};

const STATUS: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "outline" }> = {
  SUCCESS: { label: "Completed", variant: "success" },
  PARTIAL: { label: "Completed with row problems", variant: "warning" },
  FAILED: { label: "Failed", variant: "destructive" },
  SKIPPED_DUPLICATE: { label: "Skipped", variant: "outline" },
  RUNNING: { label: "Running", variant: "outline" },
};

const FEED_COLUMNS = ["created", "updated", "unchanged", "stale", "failed"] as const;
const CLIENT_COLUMNS = ["matched", "updated", "unchanged", "unmatched", "ambiguous", "invalid"] as const;
const num = (c: unknown, key: string) => (typeof (c as Counts | undefined)?.[key] === "number" ? (c as Counts)[key] : 0);

/** Counts and per-row problems for one run (dry run or real). Never shows file contents: only line numbers, field names and codes. */
export function RunSummary({ data }: { data: SummaryData }) {
  const status = STATUS[data.status] ?? { label: data.status, variant: "outline" as const };
  const feed = (["holdings", "transactions"] as const).filter((k) => data.counts[k]);
  const clients = data.counts.clients as (Counts & { fieldsChanged?: Record<string, number> }) | undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={status.variant}>{status.label}</Badge>
        {data.dryRun && <Badge variant="outline">Dry run: nothing was changed</Badge>}
        <span className="text-sm text-muted-foreground">
          {kindLabel(data.kind)}
          {data.fileName ? ` · ${data.fileName}` : ""}
        </span>
      </div>

      {data.status === "SKIPPED_DUPLICATE" && (
        <p className="text-sm text-muted-foreground" role="status">
          {data.reason === "in_progress" ? "This exact file is being imported right now." : "This exact file has already been imported, so nothing was done. Use the re-import option if you really want to apply it again."}
        </p>
      )}
      {data.failureCode && (
        <p className="text-sm text-destructive" role="alert">
          {failureLabel(data.failureCode)}.{data.missingFields?.length ? ` Missing for: ${data.missingFields.join(", ")}.` : ""}
        </p>
      )}

      {clients && (
        <Table aria-label="Client master result">
          <TableHeader>
            <TableRow>
              <TableHead>Rows</TableHead>
              {CLIENT_COLUMNS.map((c) => (
                <TableHead key={c} className="text-right capitalize">{data.dryRun && c === "updated" ? "would update" : c}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-heading"><CountUp value={num(clients, "received")} /></TableCell>
              {CLIENT_COLUMNS.map((c) => (
                <TableCell key={c} className="text-right font-heading"><CountUp value={num(clients, c)} /></TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      )}
      {clients?.fieldsChanged && Object.keys(clients.fieldsChanged).length > 0 && (
        <p className="text-sm text-muted-foreground">
          {data.dryRun ? "Would fill or change" : "Filled or changed"}: {Object.entries(clients.fieldsChanged).map(([f, n]) => `${f} (${n})`).join(", ")}.
        </p>
      )}

      {feed.length > 0 && (
        <Table aria-label="Portfolio rows result">
          <TableHeader>
            <TableRow>
              <TableHead>Rows</TableHead>
              {FEED_COLUMNS.map((c) => (
                <TableHead key={c} className="text-right capitalize">{data.dryRun && c === "created" ? "would create" : data.dryRun && c === "updated" ? "would update" : c}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {feed.map((k) => (
              <TableRow key={k}>
                <TableCell className="capitalize">{k}</TableCell>
                {FEED_COLUMNS.map((c) => (
                  <TableCell key={c} className="text-right font-heading"><CountUp value={num(data.counts[k], c)} /></TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {data.counts.customers !== undefined && (
        <p className="text-sm text-muted-foreground">
          Clients in the file: {num(data.counts.customers, "received")}, matched {num(data.counts.customers, "matched")}, not found {num(data.counts.customers, "unmatched")}, ambiguous {num(data.counts.customers, "ambiguous")}, invalid {num(data.counts.customers, "invalid")}.
        </p>
      )}

      {data.errors.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-heading text-sm font-semibold">Rows that need attention</h3>
          <div className="max-h-72 overflow-auto rounded-lg border">
            <Table aria-label="Per-row problems">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Line</TableHead>
                  <TableHead>Problem</TableHead>
                  <TableHead>Fields</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody striped>
                {data.errors.map((e, i) => (
                  <TableRow key={`${e.line}-${e.code}-${i}`}>
                    <TableCell className="tabular-nums">{e.line}</TableCell>
                    <TableCell className="whitespace-normal text-sm">{errorLabel(e.code)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.fields.join(", ")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {data.errorsTruncated && <p className="text-xs text-muted-foreground">Showing the first {data.errors.length} problems. The counts above are complete.</p>}
        </div>
      )}
    </div>
  );
}
