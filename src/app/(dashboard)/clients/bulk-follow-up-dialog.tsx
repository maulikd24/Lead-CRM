"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { REASON_LABEL, type SimResult } from "@/lib/simulate/engine";
import type { BulkFollowUpParams } from "@/lib/simulate/bulk-tasks";
import { createBulkFollowUpTasksAction, simulateBulkFollowUpAction } from "./simulate-actions";

const SELECT = "h-9 w-full rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";
const rupees = (minor: number) => (minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });

/**
 * Bulk follow-up tasks with a dry run first: "Preview" runs simulate() and shows who would get a task, who is held back and why, the
 * channel split and the AI cost. Nothing is created until "Create" is pressed, and only for the customers the preview said were eligible.
 */
export function BulkFollowUpDialog({ selectedCount, clientIds, onDone }: { selectedCount: number; clientIds: string[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [params, setParams] = useState<BulkFollowUpParams>({ title: "Follow up", channel: "call", kind: "service", dueInDays: 2 });
  const [preview, setPreview] = useState<{ result: SimResult; outOfScope: number; params: BulkFollowUpParams } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const stale = preview !== null && JSON.stringify(preview.params) !== JSON.stringify(params);
  const edit = (patch: Partial<BulkFollowUpParams>) => setParams((p) => ({ ...p, ...patch }));

  const runPreview = () =>
    start(async () => {
      setError(null);
      try {
        const r = await simulateBulkFollowUpAction(clientIds, params);
        if (r.ok) setPreview({ result: r.result, outOfScope: r.outOfScope, params });
        else {
          setPreview(null);
          setError(r.error);
        }
      } catch {
        setError("Could not run the preview. Try again.");
      }
    });

  const create = () =>
    start(async () => {
      try {
        const r = await createBulkFollowUpTasksAction(clientIds, params);
        if (r.ok) {
          toast.success(`${r.created} task(s) created${r.alreadyOpen ? `, ${r.alreadyOpen} already open` : ""}${r.suppressed ? `, ${r.suppressed} held back` : ""}.`);
          setOpen(false);
          setPreview(null);
          onDone();
        } else setError(r.error);
      } catch {
        setError("Could not create the tasks. Try again.");
      }
    });

  const r = preview?.result;
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setPreview(null); setError(null); } }}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Follow-up tasks ({selectedCount})</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Follow-up tasks for {selectedCount} customer(s)</DialogTitle>
          <DialogDescription>Preview first: see who would get a task and who is held back, and why. Nothing is created until you confirm.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="bf-title">Task title</Label>
            <Input id="bf-title" value={params.title} maxLength={120} onChange={(e) => edit({ title: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="bf-channel">Channel</Label>
              <select id="bf-channel" className={SELECT} value={params.channel} onChange={(e) => edit({ channel: e.target.value as BulkFollowUpParams["channel"] })}>
                <option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="any">Any available</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="bf-kind">Purpose</Label>
              <select id="bf-kind" className={SELECT} value={params.kind} onChange={(e) => edit({ kind: e.target.value as BulkFollowUpParams["kind"] })}>
                <option value="service">Service</option><option value="sales">Sales</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="bf-due">Due in (days)</Label>
              <Input id="bf-due" type="number" min={1} max={90} value={params.dueInDays} onChange={(e) => edit({ dueInDays: Number(e.target.value) })} />
            </div>
          </div>
          <div><Button type="button" size="sm" variant="outline" disabled={pending} onClick={runPreview}>{pending && !r ? "Checking" : r ? "Preview again" : "Preview"}</Button></div>
          {error && <p role="alert" className="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive">{error}</p>}
          {r && (
            <section aria-label="Preview result" className="flex flex-col gap-2 rounded-xl border border-border px-3 py-2 text-sm" aria-live="polite">
              <p className="font-medium"><span className="tabular-nums">{r.eligible.length}</span> of <span className="tabular-nums">{r.total}</span> would get a task; <span className="tabular-nums">{r.suppressed.length}</span> held back.</p>
              {r.suppressed.length > 0 && (
                <ul className="flex list-disc flex-col gap-0.5 pl-5 text-xs text-muted-foreground">
                  {Object.entries(r.reasonCounts).map(([k, n]) => <li key={k}>{n} held back: {REASON_LABEL[k as keyof typeof REASON_LABEL]}</li>)}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">Channels: {r.channelSplit.call} call, {r.channelSplit.whatsapp} WhatsApp, {r.channelSplit.email} email. AI: {r.estimate.aiCalls} call(s), about {rupees(r.estimate.costMinor)} rupees ({r.estimate.note})</p>
              {r.suppressed.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer font-medium">Who is held back</summary>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {r.suppressed.slice(0, 12).map((s) => <li key={s.id}>{s.label}: {s.reasons.map((x) => REASON_LABEL[x]).join(", ")}</li>)}
                    {r.suppressed.length > 12 && <li>and {r.suppressed.length - 12} more</li>}
                  </ul>
                </details>
              )}
              {preview && preview.outOfScope > 0 && <p className="text-xs text-muted-foreground">{preview.outOfScope} selected customer(s) are outside your list and were left out.</p>}
              <p className="text-xs text-muted-foreground">{r.label}</p>
              {stale && <p role="status" className="text-xs text-warning">You changed the request. Preview again before creating.</p>}
            </section>
          )}
        </div>
        <DialogFooter>
          <Button type="button" disabled={pending || !r || stale || r.eligible.length === 0} onClick={create}>{pending && r ? "Creating" : `Create ${r?.eligible.length ?? 0} task(s)`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
