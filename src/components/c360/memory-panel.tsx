"use client";

import { useId, useState, useTransition } from "react";
import { BookOpenCheck, Lock, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { motion } from "@/components/workspace";
import { confirmMemoryAction, disputeMemoryAction, editMemoryAction, recordMemoryAction, rejectMemoryAction, suggestMemoryAction, type MemoryActionResult } from "@/app/(dashboard)/clients/[id]/360/memory-actions";
import type { MemoryItemView } from "@/lib/memory/view";
import { cn } from "@/lib/utils";

import { PhoneFold } from "./phone-fold";
import { Empty } from "./rail-views";

const SELECT_CLASS = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export type MemoryPanelData = {
  asOfAgo: string | null;
  empty: boolean;
  canManage: boolean;
  doNotDo: MemoryItemView[];
  needsConfirmation: MemoryItemView[];
  groups: { class: string; label: string; items: MemoryItemView[] }[];
  counts: { confirmed: number; unconfirmed: number; disputed: number; expired: number; stale: number };
  household: { inHousehold: boolean; householdCode: string | null; otherMemberCount: number; hiddenMemberCount: number; ownMembers: { clientId: string; name: string; clientCode: string }[] } | null;
};

const STATE_VARIANT = { CONFIRMED: "success", UNCONFIRMED: "warning", DISPUTED: "destructive", EXPIRED: "secondary", REJECTED: "secondary", SUPERSEDED: "secondary" } as const;
const CLASS_CHOICES = [
  ["FACT", "A fact (employer, dependants, holdings elsewhere)"],
  ["PREFERENCE", "A preference (language, channel, call time)"],
  ["INTEREST", "An interest"],
  ["OBJECTION", "An objection or worry"],
  ["GOAL", "A goal they mentioned"],
  ["PRODUCT_STANCE", "Their stance on a product (declined, wants to wait)"],
  ["DO_NOT_DO", "Something not to do (no calls before 11, do not discuss X)"],
] as const;

/** Reason dialog shared by reject, dispute and edit. A reason is required and recorded. */
function ReasonDialog({ open, onOpenChange, title, description, label, submitLabel, withText, initialText, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; label: string; submitLabel: string; withText?: boolean; initialText?: string; onSubmit: (reason: string, text: string) => Promise<MemoryActionResult> }) {
  const uid = useId();
  const [reason, setReason] = useState("");
  const [text, setText] = useState(initialText ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      setError(null);
      const r = await onSubmit(reason, text);
      if (r.ok) {
        toast.success(r.message ?? "Saved");
        onOpenChange(false);
        setReason("");
      } else setError(r.error);
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {withText && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${uid}-text`} className="text-sm font-medium">What is correct</label>
              <Input id={`${uid}-text`} value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-reason`} className="text-sm font-medium">{label}</label>
            <Textarea id={`${uid}-reason`} value={reason} maxLength={300} rows={3} onChange={(e) => setReason(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? `${uid}-err` : undefined} />
          </div>
          {error && <p id={`${uid}-err`} role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !reason.trim() || (withText && !text.trim())}>{submitLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ItemRow({ item, clientId }: { item: MemoryItemView; clientId: string }) {
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<null | "reject" | "dispute" | "edit">(null);
  const run = (fn: () => Promise<MemoryActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Saved");
      else toast.error(r.error);
    });
  const a = item.actions;
  const evidenceId = `ev-${item.id}`;
  return (
    <li className="flex flex-col gap-1.5 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-sm font-medium break-words">{item.text}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={STATE_VARIANT[item.state]}>{item.stateLabel}</Badge>
          <Badge variant="outline">Confidence: {item.confidence}</Badge>
          {item.sensitive && <Badge variant="outline"><Lock aria-hidden /> Sensitive</Badge>}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {item.source}. {item.ageLine}.
      </p>
      {item.conflictNote && <p className="text-xs text-destructive">{item.conflictNote} Confirm the right one to settle it.</p>}
      {item.state === "EXPIRED" && <p className="text-xs text-muted-foreground">Out of date, so nothing uses it. Ask the customer again and add it fresh.</p>}
      {item.evidence.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-controls={evidenceId}>Evidence ({item.evidence.length})</summary>
          <ul id={evidenceId} className="mt-1 flex flex-col gap-1 border-l border-border pl-3">
            {item.evidence.map((e, i) => (
              <li key={i} className="text-muted-foreground">
                {e.summary} <span className="whitespace-nowrap">({e.observedAgo})</span>
                {e.href && <> · <a className="underline underline-offset-2 hover:text-foreground" href={e.href}>Open the call</a></>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {(a.canConfirm || a.canEdit || a.canReject || a.canDispute) && (
        <div className="flex flex-wrap gap-1.5">
          {a.canConfirm && <Button size="xs" disabled={pending} onClick={() => run(() => confirmMemoryAction(clientId, item.id))}>Confirm</Button>}
          {a.canEdit && <Button size="xs" variant="outline" disabled={pending} onClick={() => setDialog("edit")}>Edit</Button>}
          {a.canDispute && <Button size="xs" variant="outline" disabled={pending} onClick={() => setDialog("dispute")}>Dispute</Button>}
          {a.canReject && <Button size="xs" variant="outline" disabled={pending} onClick={() => setDialog("reject")}>Reject</Button>}
        </div>
      )}
      <ReasonDialog open={dialog === "reject"} onOpenChange={(o) => setDialog(o ? "reject" : null)} title="Reject this item" description="It will be hidden, and will not be suggested again for 90 days." label="Why is it wrong?" submitLabel="Reject" onSubmit={(reason) => rejectMemoryAction(clientId, item.id, reason)} />
      <ReasonDialog open={dialog === "dispute"} onOpenChange={(o) => setDialog(o ? "dispute" : null)} title="Dispute this item" description="Nothing will rely on it until it is settled." label="What does not add up?" submitLabel="Mark disputed" onSubmit={(reason) => disputeMemoryAction(clientId, item.id, reason)} />
      <ReasonDialog open={dialog === "edit"} onOpenChange={(o) => setDialog(o ? "edit" : null)} title="Correct this item" description="The old entry is kept as replaced, with your name and reason." label="Why the change?" submitLabel="Save correction" withText initialText={item.text} onSubmit={(reason, text) => editMemoryAction(clientId, item.id, text, reason)} />
    </li>
  );
}

function AddDialog({ clientId, open, onOpenChange }: { clientId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const uid = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const submit = (form: FormData) =>
    start(async () => {
      setError(null);
      const r = await recordMemoryAction(clientId, { class: String(form.get("class")), topic: String(form.get("topic")), text: String(form.get("text")), note: String(form.get("note") ?? "") });
      if (r.ok) {
        toast.success(r.message ?? "Saved");
        onOpenChange(false);
      } else setError(r.error);
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add what you know</DialogTitle>
          <DialogDescription>Entered by you, so it starts as confirmed. Health, religion, caste, orientation and politics are never recorded.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-class`} className="text-sm font-medium">Kind</label>
            <select id={`${uid}-class`} name="class" className={SELECT_CLASS} defaultValue="FACT">
              {CLASS_CHOICES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-topic`} className="text-sm font-medium">Topic</label>
            <Input id={`${uid}-topic`} name="topic" required maxLength={60} placeholder="For example, employer or call time" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-text`} className="text-sm font-medium">What you know</label>
            <Input id={`${uid}-text`} name="text" required maxLength={300} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-note`} className="text-sm font-medium">Where it came from (optional)</label>
            <Input id={`${uid}-note`} name="note" maxLength={280} placeholder="For example, told me in the branch" />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The Customer 360 Memory panel. `clientId` is already authorised by the page; every action re-checks on the server. */
export function MemoryPanel({ clientId, data }: { clientId: string; data: MemoryPanelData }) {
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const suggest = () =>
    start(async () => {
      const r = await suggestMemoryAction(clientId);
      if (r.ok) toast.success(r.message ?? "Done");
      else toast.error(r.error);
    });
  const c = data.counts;
  return (
    <div className="flex flex-col gap-3">
      <Card className={cn(motion.enter)}>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base"><BookOpenCheck className="size-4 text-muted-foreground" aria-hidden /> What we know</CardTitle>
            <CardDescription>
              {data.empty ? "Nothing recorded yet." : `${c.confirmed} confirmed, ${c.unconfirmed} to confirm${c.disputed ? `, ${c.disputed} disputed` : ""}${c.expired ? `, ${c.expired} out of date` : ""}.`}
              {data.asOfAgo ? ` Latest observation ${data.asOfAgo}.` : ""}
            </CardDescription>
          </div>
          {data.canManage && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={suggest} disabled={pending}><Sparkles aria-hidden /> Suggest from conversations</Button>
              <Button size="sm" onClick={() => setAdding(true)}><Plus aria-hidden /> Add what you know</Button>
            </div>
          )}
        </CardHeader>
      </Card>

      {data.empty && (
        <Empty title="We have not recorded anything about this customer yet." hint={data.canManage ? "Add what you know, or ask us to look through their recent conversations for suggestions. Suggestions always wait for your confirmation." : "Nothing has been recorded yet."} />
      )}

      {c.stale > 0 && !data.empty && (
        <p role="status" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground max-lg:hidden">
          {c.stale} item{c.stale === 1 ? " is" : "s are"} out of date. Nothing relies on them until they are confirmed again.
        </p>
      )}

      {data.doNotDo.length > 0 && (
        <Card role="region" aria-labelledby="mem-dnd" className={cn(motion.enter, "border-warning/40")}>
          <CardHeader>
            <CardTitle id="mem-dnd" className="text-base">Do not do</CardTitle>
            <CardDescription className="max-lg:hidden">Pinned so nobody misses it. Applies to every message and call.</CardDescription>
          </CardHeader>
          <CardContent><ul className="divide-y divide-border">{data.doNotDo.map((i) => <ItemRow key={i.id} item={i} clientId={clientId} />)}</ul></CardContent>
        </Card>
      )}

      {data.needsConfirmation.length > 0 && (
        <PhoneFold className={cn(motion.enter, "rounded-xl border border-border bg-card text-card-foreground")} summary={<span>Needs your confirmation <span className="font-normal text-muted-foreground">({data.needsConfirmation.length})</span></span>}>
          <div className="px-4 pb-3">
            <p className="pb-1 text-sm text-muted-foreground">Read from conversations by AI. They change nothing until you confirm them.</p>
            <ul className="divide-y divide-border">{data.needsConfirmation.map((i) => <ItemRow key={i.id} item={i} clientId={clientId} />)}</ul>
          </div>
        </PhoneFold>
      )}

      {data.groups.length > 0 && (
        <PhoneFold className={cn(motion.enter, "rounded-xl border border-border bg-card text-card-foreground")} summary={<span>Everything we know, by kind <span className="font-normal text-muted-foreground">({data.groups.reduce((n, g) => n + g.items.length, 0)})</span></span>}>
          <div className="flex flex-col gap-2 px-3 pb-3">
            {data.household?.inHousehold && data.household.otherMemberCount > 0 && (
              <p className="text-xs text-muted-foreground">
              Part of household {data.household.householdCode} with {data.household.otherMemberCount} other member{data.household.otherMemberCount === 1 ? "" : "s"}.
              {data.household.hiddenMemberCount > 0 && ` ${data.household.hiddenMemberCount} ${data.household.hiddenMemberCount === 1 ? "is" : "are"} looked after by another relationship manager, so only the relationship is shown.`}
              {data.household.ownMembers.length > 0 && <> Your customers in it: {data.household.ownMembers.map((m, i) => <span key={m.clientId}>{i > 0 && ", "}<a className="underline underline-offset-2 hover:text-foreground" href={`/clients/${m.clientId}/360?tab=memory`}>{m.name}</a></span>)}.</>}
            </p>
            )}
      {data.groups.map((g, gi) => (
          <details key={g.class} className={cn(motion.enter, "group/mem rounded-xl border border-border bg-card text-card-foreground")} style={{ ["--i" as string]: gi + 1 }}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-base font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <span>{g.label} <span className="font-normal text-muted-foreground">({g.items.length})</span></span>
              <span className="text-xs font-normal text-muted-foreground">{g.items.filter((i) => i.state === "UNCONFIRMED").length ? `${g.items.filter((i) => i.state === "UNCONFIRMED").length} to confirm` : "Show"}</span>
            </summary>
            <div className="px-4 pb-3"><ul className="divide-y divide-border">{g.items.map((i) => <ItemRow key={i.id} item={i} clientId={clientId} />)}</ul></div>
          </details>
        ))}
          </div>
        </PhoneFold>
      )}
      <AddDialog clientId={clientId} open={adding} onOpenChange={setAdding} />
    </div>
  );
}
