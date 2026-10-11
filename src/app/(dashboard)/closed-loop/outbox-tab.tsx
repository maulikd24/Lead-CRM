import Link from "next/link";

import { Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { ShowFirstBlock } from "@/components/workspace";
import { EVENT_LABEL } from "@/lib/closedloop/events";
import { REASON_TEXT, type BlockReason } from "@/lib/closedloop/gate";
import { tabLink } from "@/lib/closedloop/tabs";
import { DESTINATION_LABEL } from "@/lib/closedloop/types";
import { loadOutbox, OUTBOX_FILTERS, type OutboxFilter, type OutboxView } from "@/lib/closedloop/views-db";

import { RetryButton } from "./retry-button";

const FILTER_LABEL: Record<OutboxFilter, string> = { all: "All", waiting: "Waiting", sent: "Sent", failed: "Retrying", dead: "Failed for good", skipped: "Not sent" };
const TONE: Record<string, "success" | "warning" | "destructive" | "outline"> = { SENT: "success", PENDING: "outline", SENDING: "outline", FAILED: "warning", DEAD: "destructive", SKIPPED: "outline" };
const STATUS_LABEL: Record<string, string> = { SENT: "Sent", PENDING: "Waiting", SENDING: "Sending", FAILED: "Retrying", DEAD: "Failed", SKIPPED: "Not sent" };


const PHONE_ROWS = 6;

const table = (rows: OutboxView[]) => (
    <Table scrollLabel="Outbox events, scrollable">
      <TableHeader>
        <TableRow>
          <TableHead>Event</TableHead>
          <TableHead>Code</TableHead>
          <TableHead>Destination</TableHead>
          <TableHead>When</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Detail</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody striped>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="text-sm">{EVENT_LABEL[r.eventType]}</TableCell>
            <TableCell className="font-mono text-xs">{r.ref}</TableCell>
            <TableCell className="text-sm">{DESTINATION_LABEL[r.destination]}</TableCell>
            <TableCell className="text-sm">{fmt(r.occurredAt)}</TableCell>
            <TableCell><Badge variant={TONE[r.status] ?? "outline"}>{STATUS_LABEL[r.status] ?? r.status}</Badge></TableCell>
            <TableCell className="whitespace-normal text-sm text-muted-foreground">
              {r.status === "SKIPPED" && r.reason ? (REASON_TEXT[r.reason as BlockReason] ?? (r.reason === "TOO_OLD" ? "Too old for the platform to accept." : r.reason)) : null}
              {r.status === "FAILED" ? `Try ${r.attempts}, next ${fmt(r.nextAttemptAt)}. ${r.reason ?? ""}` : null}
              {r.status === "DEAD" ? `${r.reason ?? "Rejected"} after ${r.attempts} tries.` : null}
              {r.status === "SENT" ? (r.matched === null ? `Sent ${fmt(r.sentAt)}` : `Sent ${fmt(r.sentAt)}, ${r.matched ? "matched" : "not matched"}`) : null}
              {(r.status === "DEAD" || r.status === "FAILED") && <RetryButton id={r.id} />}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
);

const fmt = (d: Date | null) => (d ? d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "");

/** One row per event, identified by a short code (never the customer). Failures show a short reason and can be retried. */
export async function OutboxTab({ status }: { status: OutboxFilter }) {
  const { rows, total } = await loadOutbox(status);
  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Filter the outbox" className="flex flex-wrap gap-2">
        {OUTBOX_FILTERS.map((f) => (
          <Link key={f} href={tabLink("outbox", f === "all" ? "" : `?status=${f}`)} aria-current={f === status ? "true" : undefined} className={`rounded-full border px-3 py-1 text-sm ${f === status ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
            {FILTER_LABEL[f]}
          </Link>
        ))}
      </nav>
      <Card>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState icon={Inbox} title="No events here" description="Events appear after the job finds a consented customer with a completed KYC or first funding." />
          ) : (
            <ShowFirstBlock name="outbox" title="Outbox" total={rows.length} noun="events" limit={PHONE_ROWS} preview={table(rows.slice(0, PHONE_ROWS))} full={table(rows)} />
          )}
        </CardContent>
      </Card>
      {total > rows.length && <p className="text-sm text-muted-foreground">Showing the latest {rows.length} of {total}.</p>}
    </div>
  );
}
