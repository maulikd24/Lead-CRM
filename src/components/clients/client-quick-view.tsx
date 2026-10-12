"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { CalendarPlus, ExternalLink, Mail, MessageSquare, Phone } from "lucide-react";
import { toast } from "sonner";

import { Sheet } from "@/components/workspace/sheet";
import { MotionNumber } from "@/components/motion/motion-number";
import { ActivityTimeline } from "@/components/timeline/activity-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { formatDateTime, formatInrCompact } from "@/lib/utils/format";
import { CLIENT_STATUS_VARIANT, SLA_VARIANT } from "@/lib/status-badge-config";
import { getClientQuickViewAction, scheduleFollowUpAction, type ClientQuickView } from "@/app/(dashboard)/clients/quick-view-actions";
import { useClientCall } from "@/components/click-to-call/call-widget";

const QuickViewContext = createContext<(clientId: string) => void>(() => {});

/** A click that should open the quick view: a plain left click. Cmd/Ctrl/Shift/middle clicks keep the link's own behaviour (a new tab). */
export function isPlainClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/** Opens the quick view for a client. Any row or card inside a ClientQuickViewProvider can call it. */
export function useClientQuickView() {
  return useContext(QuickViewContext);
}

/**
 * A side panel (a bottom sheet on a phone) with a client's essentials: who and where they are, value, open opportunities, and the
 * timeline with a note box — so a row on the clients list or a card on the board can be worked without leaving the page.
 * "Open full profile" goes to the client's page for everything else.
 */
export function ClientQuickViewProvider({ children }: { children: ReactNode }) {
  const [clientId, setClientId] = useState<string | null>(null);
  return (
    <QuickViewContext.Provider value={setClientId}>
      {children}
      <ClientQuickViewSheet clientId={clientId} onClose={() => setClientId(null)} />
    </QuickViewContext.Provider>
  );
}

function ClientQuickViewSheet({ clientId, onClose }: { clientId: string | null; onClose: () => void }) {
  const [view, setView] = useState<{ id: string; data: ClientQuickView } | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  const load = useCallback((id: string) => {
    getClientQuickViewAction(id)
      .then((data) => setView({ id, data }))
      .catch(() => setFailedId(id));
  }, []);

  useEffect(() => {
    if (clientId) load(clientId);
  }, [clientId, load]);

  const data = view && view.id === clientId ? view.data : null;
  const title = data?.client.name ?? "Client";

  return (
    <Sheet
      name="client-quick-view"
      open={!!clientId}
      onClose={onClose}
      title={title}
      description={data ? `${data.client.clientCode} · ${data.client.stageName} · ${data.client.assignedTo?.name ?? "Unassigned"}` : undefined}
    >
      {!clientId ? null : failedId === clientId ? (
        <p className="text-sm text-destructive">Couldn&apos;t load this client.</p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <QuickViewBody data={data} onChanged={() => load(data.client.id)} />
      )}
    </Sheet>
  );
}

function QuickViewBody({ data, onChanged }: { data: ClientQuickView; onChanged: () => void }) {
  const { client } = data;
  const call = useClientCall();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {client.mobile && (
          <Button size="sm" variant="outline" onClick={() => void call.start(client.id)} disabled={call.busy}>
            <Phone className="size-3.5" /> Call
          </Button>
        )}
        <Button size="sm" render={<Link href={`/clients/${client.id}`} />}>
          <ExternalLink className="size-3.5" /> Open full profile
        </Button>
        <Button size="sm" variant="outline" render={<Link href={`/clients/${client.id}?tab=activity`} />}>
          <MessageSquare className="size-3.5" /> Message
        </Button>
        {client.email && (
          <Button size="sm" variant="outline" render={<a href={`mailto:${client.email}`} />}>
            <Mail className="size-3.5" /> Email
          </Button>
        )}
        <FollowUpButton clientId={client.id} onDone={onChanged} />
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <Stat label="Expected investment" value={client.expectedInvestment ? <MotionNumber value={client.expectedInvestment} format="inr-compact" /> : "—"} />
        <Stat label="Open opportunities" value={data.opportunities.length ? <MotionNumber value={data.openOpportunityValue} format="inr-compact" /> : "—"} />
        <Stat
          label="Status"
          value={
            <span className="flex flex-wrap gap-1">
              <Badge variant={CLIENT_STATUS_VARIANT[client.status]}>{client.status.replace(/_/g, " ").toLowerCase()}</Badge>
              {client.slaStatus === "OVERDUE" || client.slaStatus === "DUE_SOON" ? (
                <Badge variant={SLA_VARIANT[client.slaStatus]}>{client.slaStatus === "OVERDUE" ? "Overdue" : "Due soon"}</Badge>
              ) : null}
            </span>
          }
        />
        <Stat label="Last touch" value={data.lastTouchAt ? formatDistanceToNow(new Date(data.lastTouchAt), { addSuffix: true }) : "Never"} />
        {data.lifetimeRevenue !== null && <Stat label="Lifetime revenue" value={data.lifetimeRevenue > 0 ? <MotionNumber value={data.lifetimeRevenue} format="inr-compact" /> : "—"} />}
      </dl>

      <section className="flex flex-col gap-1 text-sm">
        <h3 className="text-xs font-medium text-muted-foreground">Contact</h3>
        <p>{client.mobile ?? "No mobile"}</p>
        <p className="truncate">{client.email ?? "No email"}</p>
        {client.nextActionTitle && (
          <p className="text-muted-foreground">
            Next: {client.nextActionTitle}
            {client.nextActionDueAt ? ` · ${formatDateTime(new Date(client.nextActionDueAt))}` : ""}
          </p>
        )}
      </section>

      {data.opportunities.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">Open opportunities</h3>
          <ul className="flex flex-col divide-y rounded-lg border">
            {data.opportunities.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{label(o.product)}</span>
                  <span className="text-xs text-muted-foreground">{label(o.stage)}</span>
                </span>
                <span className="tabular-nums">{formatInrCompact(o.estimatedValue)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">Activity</h3>
        <ActivityTimeline activities={data.activities} clientId={client.id} showAddNote currentUserRole={data.role} onNoteAdded={onChanged} />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function FollowUpButton({ clientId, onDone }: { clientId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    try {
      await scheduleFollowUpAction(clientId, { title: String(formData.get("title") ?? ""), dueAt: String(formData.get("dueAt") ?? "") });
      toast.success("Follow-up scheduled");
      setOpen(false);
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't schedule the follow-up");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <CalendarPlus className="size-3.5" /> Follow-up
      </Button>
    );
  }
  return (
    <form action={submit} className="flex w-full flex-col gap-2 rounded-lg border p-3">
      <Field>
        <FieldLabel htmlFor="qv-followup-title">Follow-up</FieldLabel>
        <Input id="qv-followup-title" name="title" required defaultValue="Follow up" />
      </Field>
      <Field>
        <FieldLabel htmlFor="qv-followup-due">Due</FieldLabel>
        <Input id="qv-followup-due" name="dueAt" type="datetime-local" required />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Schedule"}
        </Button>
      </div>
    </form>
  );
}

const label = (value: string) => value.charAt(0) + value.slice(1).replace(/_/g, " ").toLowerCase();
