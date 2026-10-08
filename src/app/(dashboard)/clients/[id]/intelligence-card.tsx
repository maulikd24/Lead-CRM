"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ASSET_CLASSES, CUSTOMER_CATEGORIES, LEVEL_LABEL, OUTCOMES, OUTCOME_CHANNELS } from "@/lib/intelligence/constants";
import type { IntelligenceView } from "@/lib/intelligence/view";
import { logOutcomeAction, previewAgentBriefingAction, resolveInsightAction, saveEstimatesAction, setAcceptanceAction, setCustomerCategoryAction } from "./intelligence-actions";

const LEVEL_VARIANT = { HIGH: "success", MEDIUM: "warning", LOW: "outline" } as const;
const PRIORITY_VARIANT = { High: "destructive", Medium: "warning", Low: "outline" } as const;
const SEVERITY_VARIANT = { high: "destructive", medium: "warning", info: "outline" } as const;
const KIND_LABEL: Record<string, string> = { INTEREST: "Interested", OBJECTION: "Objection", CONCERN: "Concern", QUESTION: "Asked", DECLINED: "Declined", EXTERNAL_HOLDING: "Holds elsewhere", COMPLAINT: "Complaint", INCORRECT_INFO: "Incorrect information", COMPLIANCE_CONCERN: "Compliance concern", MISSED_OPPORTUNITY: "Missed opportunity" };

const inr = (value: number | null) => (value === null ? "—" : value >= 10_000_000 ? `₹${(value / 10_000_000).toFixed(2)} Cr` : value >= 100_000 ? `₹${(value / 100_000).toFixed(1)} L` : `₹${Math.round(value).toLocaleString("en-IN")}`);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function IntelligenceCard({ clientId, view, canPreviewBriefing }: { clientId: string; view: IntelligenceView; canPreviewBriefing: boolean }) {
  const [pending, startTransition] = useTransition();
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [estimatesOpen, setEstimatesOpen] = useState(false);
  const [briefing, setBriefing] = useState<string | null>(null);

  function run(action: () => Promise<unknown>, success?: string) {
    startTransition(async () => {
      try {
        await action();
        if (success) toast.success(success);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Something went wrong");
      }
    });
  }

  const { nba } = view;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Customer intelligence</CardTitle>
            <CardDescription>Who to contact, what to discuss and why — updated from this customer&apos;s data and conversations.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{view.lifecycle}</Badge>
            <Select value={view.category ?? ""} onValueChange={(v) => run(() => setCustomerCategoryAction(clientId, v ?? ""))} disabled={pending}>
              <SelectTrigger size="sm" className="w-auto min-w-36 text-xs">
                <SelectValue placeholder="Category">{(v: string) => v || "Set category"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CUSTOMER_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canPreviewBriefing && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(async () => setBriefing(await previewAgentBriefingAction(clientId)))}>
                AI briefing
              </Button>
            )}
            <Button size="sm" onClick={() => setOutcomeOpen(true)}>
              Log outcome
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={PRIORITY_VARIANT[nba.priority as keyof typeof PRIORITY_VARIANT] ?? "outline"}>{nba.priority} priority</Badge>
            <p className="text-sm font-semibold">{nba.programme}</p>
            {nba.topic && <span className="text-sm text-muted-foreground">· {nba.topic}</span>}
          </div>
          <p className="mt-1 text-sm">{nba.reason}</p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            <Badge variant="outline">Action: {nba.action}</Badge>
            <Badge variant="outline">Owner: {nba.owner}</Badge>
            <Badge variant="outline">When: {nba.timing}</Badge>
          </div>
          {nba.talkingPoints.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-sm text-muted-foreground">
              {nba.talkingPoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          )}
          {nba.doNotDiscuss.length > 0 && (
            <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
              <p className="font-medium">Don&apos;t raise right now</p>
              <ul className="list-disc pl-4 text-muted-foreground">
                {nba.doNotDiscuss.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {view.situations.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {view.situations.map((s) => (
              <Badge key={s.key} variant={SEVERITY_VARIANT[s.severity as keyof typeof SEVERITY_VARIANT] ?? "outline"} title={s.detail}>
                {s.label}
              </Badge>
            ))}
          </div>
        )}

        <div>
          <p className="mb-2 text-sm font-medium">Asset class acceptance</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {view.acceptance.map((a) => (
              <div key={a.assetClass} className="rounded-md border p-2" title={`${a.reason}${a.isManual ? "" : ` (${a.source})`}`}>
                <p className="text-xs text-muted-foreground">{a.assetClass}</p>
                <div className="mt-1 flex items-center justify-between gap-1">
                  <Badge variant={LEVEL_VARIANT[a.level]}>{LEVEL_LABEL[a.level]}</Badge>
                  <Select value={a.isManual ? a.level : "AUTO"} onValueChange={(v) => v && run(() => setAcceptanceAction(clientId, a.assetClass, v as "HIGH" | "MEDIUM" | "LOW" | "AUTO"))} disabled={pending}>
                    <SelectTrigger size="sm" className="h-6 w-auto gap-1 px-1.5 text-[10px]">
                      <SelectValue>{(v: string) => (v === "AUTO" ? "Auto" : "Mine")}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AUTO">Automatic</SelectItem>
                      <SelectItem value="HIGH">Set High</SelectItem>
                      <SelectItem value="MEDIUM">Set Medium</SelectItem>
                      <SelectItem value="LOW">Set Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{a.reason}</p>
              </div>
            ))}
          </div>
        </div>

        {(view.commitments.length > 0 || view.issues.length > 0) && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Needs follow-through</p>
            {[...view.commitments.map((c) => ({ id: c.id, kind: "COMMITMENT", text: c.text, note: c.dueAtIso ? `${c.overdue ? "Overdue · " : "Due "}${day(c.dueAtIso)}` : "", severe: c.overdue })), ...view.issues.map((i) => ({ id: i.id, kind: i.kind, text: i.text, note: day(i.dateIso), severe: i.severity === "high" }))].map((row) => (
              <div key={row.id} className="flex items-start justify-between gap-2 rounded-md border p-2 text-sm">
                <div>
                  <Badge variant={row.severe ? "destructive" : "outline"}>{row.kind === "COMMITMENT" ? "Promise" : (KIND_LABEL[row.kind] ?? row.kind)}</Badge>
                  <span className="ml-2">{row.text}</span>
                  {row.note && <span className="ml-2 text-xs text-muted-foreground">{row.note}</span>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => resolveInsightAction(row.id, "DONE"), "Marked done")}>
                    Done
                  </Button>
                  <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => resolveInsightAction(row.id, "DISMISSED"))}>
                    Dismiss
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {view.said.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">What the customer has told us</p>
            <ul className="flex flex-col gap-1 text-sm">
              {view.said.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline gap-2">
                  <Badge variant="outline">{KIND_LABEL[s.kind] ?? s.kind}</Badge>
                  <span>{s.text}</span>
                  <span className="text-xs text-muted-foreground">{day(s.dateIso)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
          <div>
            <p className="font-medium">Outside Allvest <span className="font-normal text-muted-foreground">(estimates)</span></p>
            <p className="text-muted-foreground">
              Portfolio {inr(view.estimates.externalPortfolio)} · Mutual funds to transfer {inr(view.estimates.mfTransfer)} · Idle cash {inr(view.estimates.idleCash)}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setEstimatesOpen(true)}>
            Edit
          </Button>
        </div>
      </CardContent>

      <Dialog open={briefing !== null} onOpenChange={(open) => !open && setBriefing(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>What an AI agent would know before contacting this customer</DialogTitle>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs">{briefing}</pre>
        </DialogContent>
      </Dialog>
      <OutcomeDialog clientId={clientId} open={outcomeOpen} onOpenChange={setOutcomeOpen} />
      <EstimatesDialog clientId={clientId} open={estimatesOpen} onOpenChange={setEstimatesOpen} view={view} />
    </Card>
  );
}

function OutcomeDialog({ clientId, open, onOpenChange }: { clientId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<string>("INTERESTED");
  const [channel, setChannel] = useState<string>("CALL");
  const [assetClass, setAssetClass] = useState<string>("");

  async function submit(formData: FormData) {
    setPending(true);
    try {
      await logOutcomeAction({
        clientId,
        outcome: outcome as "INTERESTED",
        channel: channel as "CALL",
        assetClass: assetClass as "PMS" | "",
        note: String(formData.get("note") ?? ""),
        followUpAt: String(formData.get("followUpAt") ?? ""),
      });
      toast.success("Outcome saved");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the outcome");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>How did it go?</DialogTitle>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel>Outcome</FieldLabel>
            <Select value={outcome} onValueChange={(v) => v && setOutcome(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => OUTCOMES.find((o) => o.value === v)?.label ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {OUTCOMES.filter((o) => o.value !== "RM_HANDOVER").map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel>Channel</FieldLabel>
              <Select value={channel} onValueChange={(v) => v && setChannel(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace("_", " ")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {OUTCOME_CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c.charAt(0) + c.slice(1).toLowerCase().replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>About (optional)</FieldLabel>
              <Select value={assetClass} onValueChange={(v) => setAssetClass(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Any">{(v: string) => v || "Any"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ASSET_CLASSES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="outcome-note">{outcome === "SERVICE_ISSUE" ? "What went wrong" : "Note (optional)"}</FieldLabel>
            <Textarea id="outcome-note" name="note" rows={3} required={outcome === "SERVICE_ISSUE"} />
          </Field>
          {outcome === "FOLLOW_UP" && (
            <Field>
              <FieldLabel htmlFor="outcome-followup">Follow up on</FieldLabel>
              <Input id="outcome-followup" name="followUpAt" type="date" />
            </Field>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save outcome"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EstimatesDialog({ clientId, open, onOpenChange, view }: { clientId: string; open: boolean; onOpenChange: (open: boolean) => void; view: IntelligenceView }) {
  const [pending, setPending] = useState(false);
  const STATUS = [["", "Not set"], ["NOT_STARTED", "Not started"], ["IN_PROGRESS", "In progress"], ["COMPLETED", "Completed"]];
  const [demat, setDemat] = useState(view.estimates.dematTransferStatus ?? "");
  const [mf, setMf] = useState(view.estimates.mfTransferStatus ?? "");

  async function submit(formData: FormData) {
    setPending(true);
    try {
      await saveEstimatesAction(clientId, {
        externalPortfolio: String(formData.get("externalPortfolio") ?? ""),
        mfTransfer: String(formData.get("mfTransfer") ?? ""),
        idleCash: String(formData.get("idleCash") ?? ""),
        dematTransferStatus: demat,
        mfTransferStatus: mf,
      });
      toast.success("Saved");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Held outside Allvest</DialogTitle>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">Rough figures in rupees are fine. They drive transfer and idle-cash suggestions and are marked as estimates.</p>
          <Field>
            <FieldLabel htmlFor="ext">Total invested elsewhere (₹)</FieldLabel>
            <Input id="ext" name="externalPortfolio" type="number" min="0" defaultValue={view.estimates.externalPortfolio ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="mf">Mutual funds that could be transferred (₹)</FieldLabel>
            <Input id="mf" name="mfTransfer" type="number" min="0" defaultValue={view.estimates.mfTransfer ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="cash">Idle cash (₹)</FieldLabel>
            <Input id="cash" name="idleCash" type="number" min="0" defaultValue={view.estimates.idleCash ?? ""} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {[["Demat transfer", demat, setDemat], ["MF transfer", mf, setMf]].map(([label, value, setter]) => (
              <Field key={label as string}>
                <FieldLabel>{label as string}</FieldLabel>
                <Select value={value as string} onValueChange={(v) => (setter as (v: string) => void)(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: string) => STATUS.find(([k]) => k === v)?.[1] ?? "Not set"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS.map(([k, l]) => (
                      <SelectItem key={k || "none"} value={k}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ))}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
