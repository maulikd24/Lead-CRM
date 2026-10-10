"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { ExternalLink, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import { syncClientTicketsAction } from "../support-actions";
import { CLOSED_TICKET_STATES, isOpenTicket } from "@/lib/support/ticket-status";

export type SupportTicketView = {
  id: string;
  externalId: string;
  subject: string | null;
  status: string | null;
  priority: string | null;
  channel: string | null;
  createdIso: string | null;
  updatedIso: string | null;
  url: string | null;
};

const CLOSED = CLOSED_TICKET_STATES;

export { isOpenTicket };

function statusVariant(status: string | null): "success" | "warning" | "outline" | "secondary" {
  const s = (status ?? "").toLowerCase();
  if (CLOSED.has(s)) return "success";
  if (s === "open") return "warning";
  if (s.startsWith("waiting") || s === "pending") return "secondary";
  return "outline";
}

/** Every Freshdesk ticket linked to this client — from the ticket webhooks and the full-history sync (matched on any
 * format of their phone, or their email). Kept current as statuses change in Freshdesk. */
export function SupportTicketsCard({
  clientId,
  tickets,
  connected,
  lastSyncedIso,
}: {
  clientId: string;
  tickets: SupportTicketView[];
  connected: boolean;
  lastSyncedIso: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const open = tickets.filter((t) => isOpenTicket(t.status)).length;

  function sync() {
    startTransition(async () => {
      try {
        const result = await syncClientTicketsAction(clientId);
        toast.success(result.newTickets > 0 ? `Found ${result.newTickets} new ticket${result.newTickets === 1 ? "" : "s"}` : `Up to date — ${result.tickets} ticket${result.tickets === 1 ? "" : "s"} checked`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Sync failed");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">Support tickets</CardTitle>
          <CardDescription>
            {tickets.length === 0 ? "No Freshdesk tickets linked to this client yet." : `${tickets.length} ticket${tickets.length === 1 ? "" : "s"}, ${open} open`}
            {lastSyncedIso ? ` · history synced ${formatDateTime(new Date(lastSyncedIso))}` : connected ? " · history not synced yet" : ""}
          </CardDescription>
        </div>
        {connected && (
          <Button size="sm" variant="outline" disabled={pending} onClick={sync}>
            <RefreshCw aria-hidden />
            {pending ? "Syncing…" : "Sync from Freshdesk"}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!connected && tickets.length === 0 ? (
          <p className="text-sm text-muted-foreground">Freshdesk isn&apos;t connected. An Admin can set it up in Settings → Apps &amp; Integrations.</p>
        ) : tickets.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Opened</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="sr-only">Open in Freshdesk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody striped>
                {tickets.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="max-w-[22rem]">
                      <div className="truncate text-sm font-medium">{t.subject ?? "(no subject)"}</div>
                      <div className="text-xs text-muted-foreground">
                        #{t.externalId}
                        {t.priority ? ` · ${t.priority} priority` : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(t.status)}>{t.status ?? "Unknown"}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{t.channel ?? "—"}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{t.createdIso ? formatDate(new Date(t.createdIso)) : "—"}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{t.updatedIso ? formatDate(new Date(t.updatedIso)) : "—"}</TableCell>
                    <TableCell>
                      {t.url && (
                        <a href={t.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline">
                          Open <ExternalLink className="size-3" />
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
