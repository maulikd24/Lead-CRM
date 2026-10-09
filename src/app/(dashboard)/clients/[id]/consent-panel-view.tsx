import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { MODE_LABEL, PURPOSE_LABEL, sourceLabel, type PanelRow } from "@/lib/consent/view";
import type { ConsentState } from "@/lib/consent/decision";
import styles from "@/components/consent/consent.module.css";
import { ConsentActionDialog } from "./consent-action-dialog";

export type HistoryItem = {
  id: string;
  at: Date;
  purpose: string;
  channel: string | null;
  status: string;
  source: string;
  by: string | null;
  reason: string | null;
};

const BADGE: Record<ConsentState, "success" | "destructive" | "warning" | "outline"> = {
  GRANTED: "success",
  WITHDRAWN: "destructive",
  DO_NOT_CONTACT: "destructive",
  EXPIRED: "warning",
  UNKNOWN: "outline",
};

const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/** Presentational and data-free, so it can be rendered in tests. The loader is consent-panel.tsx. */
export function ConsentPanelView({ rows, history, canEdit, clientId }: { rows: PanelRow[]; history: HistoryItem[]; canEdit: boolean; clientId: string }) {
  return (
    <Card aria-labelledby="consent-heading">
      <CardHeader className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <CardTitle id="consent-heading" className="text-base">Consent</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">What this customer has agreed to, and when. A withdrawal is a new entry; nothing is overwritten.</p>
        </div>
        {canEdit && <ConsentActionDialog clientId={clientId} />}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Purpose</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Notice</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody striped>
            {rows.map((r, i) => (
              <TableRow key={`${r.purpose}|${r.channel ?? ""}`} className={styles.rise} style={{ ["--i" as string]: i }}>
                <TableCell className="text-sm">
                  <span className="font-medium">{r.label}</span>
                  {r.mode && <span className="block text-xs text-muted-foreground">{MODE_LABEL[r.mode]}</span>}
                </TableCell>
                <TableCell>
                  <Badge variant={BADGE[r.state]}>{r.stateLabel}</Badge>
                  <span className="ml-2 text-xs text-muted-foreground">{r.channel ?? "all channels"}</span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {sourceLabel(r.source)}
                  {r.legacy && <span className="block text-xs">read from the lead-form tick</span>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.at ? fmt(r.at) : ""}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.noticeVersion ?? ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <details className="group rounded-md border border-border">
          <summary className="cursor-pointer select-none rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            History ({history.length})
          </summary>
          {history.length === 0 ? (
            <p className="px-3 pb-3 text-sm text-muted-foreground">Nothing has been recorded for this customer yet.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-border">
              {history.map((h) => (
                <li key={h.id} className={cn("flex flex-col gap-0.5 px-3 py-2 text-sm", styles.rise)}>
                  <span>
                    <span className="font-medium">{h.status === "GRANTED" ? "Granted" : "Withdrawn"}</span>{" "}
                    {PURPOSE_LABEL[h.purpose] ?? h.purpose} <span className="text-muted-foreground">({h.channel ?? "all channels"})</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {fmt(h.at)} · {sourceLabel(h.source)}
                    {h.by ? ` · ${h.by}` : ""}
                    {h.reason ? ` · ${h.reason}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </details>
      </CardContent>
    </Card>
  );
}
