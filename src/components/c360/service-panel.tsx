"use client";

import { useId, useState, useTransition } from "react";
import { Handshake, LifeBuoy, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { motion } from "@/components/workspace";
import { commitmentStepAction, complaintStepAction, registerCommitmentAction, registerComplaintAction, suggestCommitmentsAction, type ServiceActionResult } from "@/app/(dashboard)/clients/[id]/360/service-actions";
import type { CommitmentView, ComplaintView } from "@/lib/service/view";
import { cn } from "@/lib/utils";

import { Empty } from "./rail-views";

const SELECT_CLASS = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export type ServicePanelData = {
  headline: string;
  tone: "calm" | "watch" | "critical";
  empty: boolean;
  canManage: boolean;
  complaints: ComplaintView[];
  commitments: CommitmentView[];
  candidates: { kind: "insight" | "ticket"; id: string; label: string; severity: string | null }[];
  people: Record<string, string>;
  suggestedCommitments: number;
};

const SEVERITY_VARIANT = { CRITICAL: "destructive", HIGH: "destructive", MEDIUM: "warning", LOW: "secondary" } as const;
const SLA_TEXT = { ok: "Within its deadline", at_risk: "Deadline close", breached: "Deadline missed", met: "Met", missed: "Missed" } as const;
const SLA_VARIANT = { ok: "secondary", at_risk: "warning", breached: "destructive", met: "success", missed: "destructive" } as const;
const COMMIT_TEXT = { open: "Open", due_soon: "Due soon", overdue: "Overdue", kept: "Kept", kept_late: "Kept late", broken: "Broken", cancelled: "Cancelled" } as const;
const COMMIT_VARIANT = { open: "secondary", due_soon: "warning", overdue: "destructive", kept: "success", kept_late: "warning", broken: "destructive", cancelled: "secondary" } as const;

function useRunner() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ServiceActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Saved");
      else toast.error(r.error);
    });
  return { pending, run };
}

function TextDialog({ open, onOpenChange, title, description, fields, submitLabel, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; fields: { name: string; label: string; kind?: "text" | "area" | "date" | "select"; options?: [string, string][]; required?: boolean; defaultValue?: string }[]; submitLabel: string; onSubmit: (v: Record<string, string>) => Promise<ServiceActionResult> }) {
  const uid = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = (form: FormData) =>
    start(async () => {
      setError(null);
      const v: Record<string, string> = {};
      for (const f of fields) v[f.name] = String(form.get(f.name) ?? "");
      const r = await onSubmit(v);
      if (r.ok) {
        toast.success(r.message ?? "Saved");
        onOpenChange(false);
      } else setError(r.error);
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-3">
          {fields.map((f) => (
            <div key={f.name} className="flex flex-col gap-1.5">
              <label htmlFor={`${uid}-${f.name}`} className="text-sm font-medium">{f.label}</label>
              {f.kind === "area" ? <Textarea id={`${uid}-${f.name}`} name={f.name} rows={3} maxLength={500} required={f.required} defaultValue={f.defaultValue} />
                : f.kind === "select" ? <select id={`${uid}-${f.name}`} name={f.name} className={SELECT_CLASS} defaultValue={f.defaultValue ?? f.options?.[0]?.[0]}>{f.options?.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                : <Input id={`${uid}-${f.name}`} name={f.name} type={f.kind === "date" ? "datetime-local" : "text"} maxLength={300} required={f.required} defaultValue={f.defaultValue} />}
            </div>
          ))}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const SEVERITY_OPTIONS: [string, string][] = [["LOW", "Low (5 days)"], ["MEDIUM", "Medium (3 days)"], ["HIGH", "High (2 days)"], ["CRITICAL", "Critical (1 day)"]];

function ComplaintCard({ c, clientId, canManage, people }: { c: ComplaintView; clientId: string; canManage: boolean; people: Record<string, string> }) {
  const { pending, run } = useRunner();
  const [dialog, setDialog] = useState<null | "resolve" | "reopen">(null);
  const step = (s: Parameters<typeof complaintStepAction>[2]) => run(() => complaintStepAction(clientId, c.id, s));
  const live = c.status === "OPEN" || c.status === "IN_PROGRESS" || c.status === "REOPENED";
  return (
    <li className="flex flex-col gap-1.5 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-sm font-medium break-words">{c.title}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={SEVERITY_VARIANT[c.severity]}>{c.severity.toLowerCase()}</Badge>
          <Badge variant="outline">{c.status.replace("_", " ").toLowerCase()}</Badge>
          <Badge variant={SLA_VARIANT[c.slaState]}>{SLA_TEXT[c.slaState]}</Badge>
          {c.reopened && <Badge variant="warning">Reopened {c.reopenedCount}x</Badge>}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Opened {c.openedAgo}. Owner: {c.ownerId ? (people[c.ownerId] ?? "assigned") : "nobody yet"}. {c.ackState === "overdue" ? "Not yet acknowledged, and it should have been." : c.ackState === "pending" ? "Waiting to be acknowledged." : "Acknowledged."} Resolve by {new Date(c.slaDueAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.
      </p>
      {canManage && live && (
        <div className="flex flex-wrap gap-1.5">
          {c.ackState !== "done" && <Button size="xs" variant="outline" disabled={pending} onClick={() => step({ type: "acknowledge" })}>Acknowledge</Button>}
          {c.status !== "IN_PROGRESS" && <Button size="xs" variant="outline" disabled={pending || !c.ownerId} onClick={() => step({ type: "start" })}>Start work</Button>}
          <Button size="xs" disabled={pending} onClick={() => setDialog("resolve")}>Resolve</Button>
        </div>
      )}
      {canManage && c.status === "RESOLVED" && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" variant="outline" disabled={pending} onClick={() => step({ type: "close" })}>Close</Button>
          <Button size="xs" variant="outline" disabled={pending} onClick={() => setDialog("reopen")}>Reopen</Button>
        </div>
      )}
      <TextDialog open={dialog === "resolve"} onOpenChange={(o) => setDialog(o ? "resolve" : null)} title="Resolve this complaint" description="Say what was done. The linked task is closed with it." submitLabel="Resolve"
        fields={[{ name: "resolutionCode", label: "Outcome", kind: "select", options: [["EXPLAINED", "Explained to the customer"], ["FIXED", "Fixed the problem"], ["REFUNDED", "Refund or compensation"], ["NOT_UPHELD", "Not upheld"], ["OTHER", "Other"]] }, { name: "resolution", label: "What was done", kind: "area", required: true }]}
        onSubmit={(v) => complaintStepAction(clientId, c.id, { type: "resolve", resolutionCode: v.resolutionCode, resolution: v.resolution })} />
      <TextDialog open={dialog === "reopen"} onOpenChange={(o) => setDialog(o ? "reopen" : null)} title="Reopen this complaint" description="Restarts the deadline from now. Allowed for 30 days after resolution." submitLabel="Reopen"
        fields={[{ name: "reason", label: "Why is it being reopened?", kind: "area", required: true }]} onSubmit={(v) => complaintStepAction(clientId, c.id, { type: "reopen", reason: v.reason })} />
    </li>
  );
}

function CommitmentRow({ m, clientId, canManage, people }: { m: CommitmentView; clientId: string; canManage: boolean; people: Record<string, string> }) {
  const { pending, run } = useRunner();
  const [dialog, setDialog] = useState<null | "break" | "cancel">(null);
  const step = (s: Parameters<typeof commitmentStepAction>[2]) => run(() => commitmentStepAction(clientId, m.id, s));
  return (
    <li className="flex flex-col gap-1.5 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-sm font-medium break-words">{m.text}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {m.suggested ? <Badge variant="warning">Suggested</Badge> : <Badge variant={COMMIT_VARIANT[m.state]}>{COMMIT_TEXT[m.state]}{m.overdueBy ? ` by ${m.overdueBy}` : ""}</Badge>}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {m.promisedByType === "AI_AGENT" ? "Promised by an AI agent" : `Promised by ${m.promisedByType === "ALLVEST" ? "Allvest" : "the RM"}`} to the customer, due {new Date(m.dueAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}. Owner: {m.ownerId ? (people[m.ownerId] ?? "assigned") : "nobody yet"}.
        {m.suggested && " Read from a conversation: it does not count as late until you accept it."}
      </p>
      {canManage && (
        <div className="flex flex-wrap gap-1.5">
          {m.suggested ? <Button size="xs" disabled={pending} onClick={() => step({ type: "accept" })}>Accept</Button> : <>
            <Button size="xs" disabled={pending} onClick={() => step({ type: "keep" })}>Mark kept</Button>
            <Button size="xs" variant="outline" disabled={pending} onClick={() => setDialog("break")}>Mark broken</Button>
            <Button size="xs" variant="outline" disabled={pending} onClick={() => setDialog("cancel")}>Cancel</Button>
          </>}
        </div>
      )}
      <TextDialog open={dialog === "break"} onOpenChange={(o) => setDialog(o ? "break" : null)} title="Mark as broken" description="Say what happened. It stays on the record." submitLabel="Mark broken" fields={[{ name: "note", label: "What happened?", kind: "area", required: true }]} onSubmit={(v) => commitmentStepAction(clientId, m.id, { type: "break", note: v.note })} />
      <TextDialog open={dialog === "cancel"} onOpenChange={(o) => setDialog(o ? "cancel" : null)} title="Cancel this promise" description="Use this when it is no longer needed." submitLabel="Cancel promise" fields={[{ name: "note", label: "Why?", kind: "area", required: true }]} onSubmit={(v) => commitmentStepAction(clientId, m.id, { type: "cancel", note: v.note })} />
    </li>
  );
}

/** The Customer 360 Service tab: complaints (severity, owner, SLA clock, resolve, reopen) and promises (who promised what by when). `clientId` is authorised by the page; every action re-checks on the server. */
export function ServicePanel({ clientId, data }: { clientId: string; data: ServicePanelData }) {
  const [dialog, setDialog] = useState<null | "complaint" | "commitment" | { kind: "insight" | "ticket"; id: string; label: string; severity: string | null }>(null);
  const { pending, run } = useRunner();
  const toneClass = data.tone === "critical" ? "border-destructive/40" : data.tone === "watch" ? "border-warning/40" : "";
  return (
    <div className="flex flex-col gap-3">
      <Card className={cn(motion.enter, toneClass)}>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base"><LifeBuoy className="size-4 text-muted-foreground" aria-hidden /> Service</CardTitle>
            <CardDescription>{data.headline}.</CardDescription>
          </div>
          {data.canManage && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => suggestCommitmentsAction(clientId))}><Sparkles aria-hidden /> Find promises in conversations</Button>
              <Button size="sm" variant="outline" onClick={() => setDialog("commitment")}><Handshake aria-hidden /> Record a promise</Button>
              <Button size="sm" onClick={() => setDialog("complaint")}><Plus aria-hidden /> Register a complaint</Button>
            </div>
          )}
        </CardHeader>
      </Card>

      {data.empty && <Empty title="No open complaints and no promises on record." hint="Complaints and promises appear here when someone registers them or when a conversation suggests one." />}

      {data.candidates.length > 0 && data.canManage && (
        <Card role="region" aria-labelledby="svc-candidates" className={cn(motion.enter)}>
          <CardHeader>
            <CardTitle id="svc-candidates" className="text-base">Possible complaints, not yet registered</CardTitle>
            <CardDescription>A ticket or a conversation reads like a complaint. Register it to start the clock, or leave it.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {data.candidates.map((cand) => (
                <li key={`${cand.kind}-${cand.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <p className="min-w-0 text-sm break-words">{cand.label} <span className="text-xs text-muted-foreground">({cand.kind === "ticket" ? "support ticket" : "from a conversation"})</span></p>
                  <Button size="xs" variant="outline" onClick={() => setDialog(cand)}>Register</Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {data.complaints.length > 0 && (
        <Card role="region" aria-labelledby="svc-complaints" className={cn(motion.enter)}>
          <CardHeader><CardTitle id="svc-complaints" className="text-base">Complaints <span className="font-normal text-muted-foreground">({data.complaints.length})</span></CardTitle></CardHeader>
          <CardContent><ul className="divide-y divide-border">{data.complaints.map((c) => <ComplaintCard key={c.id} c={c} clientId={clientId} canManage={data.canManage} people={data.people} />)}</ul></CardContent>
        </Card>
      )}

      {data.commitments.length > 0 && (
        <Card role="region" aria-labelledby="svc-commitments" className={cn(motion.enter)}>
          <CardHeader><CardTitle id="svc-commitments" className="text-base">Promises <span className="font-normal text-muted-foreground">({data.commitments.length})</span></CardTitle></CardHeader>
          <CardContent><ul className="divide-y divide-border">{data.commitments.map((m) => <CommitmentRow key={m.id} m={m} clientId={clientId} canManage={data.canManage} people={data.people} />)}</ul></CardContent>
        </Card>
      )}

      <TextDialog open={dialog === "complaint" || (typeof dialog === "object" && dialog !== null)} onOpenChange={(o) => !o && setDialog(null)} title="Register a complaint" description="Starts the resolution clock and gives the owner a task. Link a ticket or conversation instead of pasting it." submitLabel="Register"
        fields={[{ name: "title", label: "What is the complaint about?", required: true, defaultValue: typeof dialog === "object" && dialog ? dialog.label : "" }, { name: "severity", label: "How serious is it?", kind: "select", options: SEVERITY_OPTIONS, defaultValue: typeof dialog === "object" && dialog?.severity ? dialog.severity.toUpperCase() : "MEDIUM" }, { name: "summary", label: "Short note (optional, no personal details)", kind: "area" }]}
        onSubmit={(v) => registerComplaintAction(clientId, { title: v.title, severity: v.severity, summary: v.summary, ...(typeof dialog === "object" && dialog ? { source: { type: dialog.kind === "ticket" ? "TICKET" as const : "INSIGHT" as const, ref: dialog.id } } : {}) })} />
      <TextDialog open={dialog === "commitment"} onOpenChange={(o) => !o && setDialog(null)} title="Record a promise" description="Who promised what, by when. It becomes a task and counts as late if it is not kept." submitLabel="Record"
        fields={[{ name: "text", label: "What was promised?", required: true }, { name: "dueAt", label: "By when", kind: "date", required: true }, { name: "promisedByType", label: "Promised by", kind: "select", options: [["RM", "The RM"], ["CRM", "The CRM team"], ["ALLVEST", "Allvest"]] }]}
        onSubmit={(v) => registerCommitmentAction(clientId, { text: v.text, dueAt: v.dueAt ? new Date(v.dueAt).toISOString() : "", promisedByType: v.promisedByType })} />
    </div>
  );
}
