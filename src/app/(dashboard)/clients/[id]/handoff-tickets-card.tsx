import { ExternalLink, LifeBuoy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SlaBar, SlaStyles } from "@/components/support/sla-visuals";
import { isOpenStatus, type HandoffTicketView } from "@/lib/integrations/freshdesk/ticket-view";
import { formatDateTime } from "@/lib/utils/format";

type Variant = "success" | "warning" | "outline" | "secondary" | "destructive";
const STATUS_VARIANT = (status: string): Variant => (!isOpenStatus(status) ? "success" : status.toLowerCase() === "open" ? "warning" : "secondary");
const PRIORITY_VARIANT: Record<string, Variant> = { urgent: "destructive", high: "warning", medium: "outline", low: "outline" };

/**
 * Support hand-offs on this customer: status, priority, the AI agent's summary and live SLA bars, with a link out to
 * Freshdesk. A separate component so it works alongside (and does not depend on) any other ticket list. Renders
 * nothing when the customer has no hand-offs.
 */
export function HandoffTicketsCard({ tickets, now }: { tickets: HandoffTicketView[]; now: Date }) {
  if (tickets.length === 0) return null;
  return (
    <Card>
      <SlaStyles />
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-heading">
          <LifeBuoy className="size-4 text-primary" aria-hidden="true" /> Support hand-offs
        </CardTitle>
        <CardDescription>Chats the support assistant passed to a person. Clocks start when the hand-off arrived.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {tickets.map((t) => (
          <section key={t.activityId} aria-label={`Ticket ${t.ticketId}`} className="fd-enter flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{t.subject || `Ticket #${t.ticketId}`}</span>
              <Badge variant={STATUS_VARIANT(t.status)}>{t.status}</Badge>
              <Badge variant={PRIORITY_VARIANT[t.priority] ?? "outline"}>{t.priority}</Badge>
              {t.sentiment === "negative" && <Badge variant="destructive">unhappy customer</Badge>}
              {t.link && (
                <a href={t.link} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-primary">
                  Open in Freshdesk <ExternalLink className="size-3" aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              )}
            </div>
            {t.summary && <p className="text-sm text-muted-foreground">{t.summary}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <SlaBar label="First response" start={t.handoffAt} due={t.firstResponseDueAt} now={now} />
              <SlaBar label="Resolution" start={t.handoffAt} due={t.resolutionDueAt} now={now} doneAt={t.resolvedAt} />
            </div>
            <p className="text-xs text-muted-foreground">Handed off {formatDateTime(t.handoffAt)}{t.intent ? ` · ${t.intent}` : ""} · #{t.ticketId}</p>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
