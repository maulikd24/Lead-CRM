"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { decideInboxAction, type InboxResult } from "./actions";
import { shortcutAction, type DetailData } from "./view-model";

const TICK_TEXT: Record<string, string> = {
  confirmed: "I have read this, including any disclosures.",
  acknowledged: "I have read the wording above and I agree to it.",
};

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** One item's evidence and its decision controls. Approve and reject each call the legacy path through the server action; nothing here decides anything. */
export function DecisionPanel({ d }: { d: DetailData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [problem, setProblem] = useState<{ error: string; reasons?: string[] } | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const openRef = useRef<HTMLAnchorElement>(null);
  const reasonId = useId();
  const a = d.actions;
  const needs = a.needs.filter((n) => n === "confirmed" || n === "acknowledged");
  const ready = needs.every((n) => ticks[n]);
  const canDecideHere = !d.readOnly && (a.canApprove || a.canReject);

  function run(decision: "approve" | "reject") {
    setProblem(null);
    start(async () => {
      let res: InboxResult;
      try {
        res = await decideInboxAction(d.ref, decision, { reason, params: ticks });
      } catch {
        res = { ok: false, code: "ERROR", error: "Something went wrong. Nothing was changed." };
      }
      if (res.ok) {
        toast.success(res.message);
        setReason("");
        router.refresh();
      } else {
        setProblem({ error: res.error, reasons: res.reasons });
        toast.error(res.error);
      }
    });
  }

  // Keyboard: a approve, r reason, o open. Only for the item on screen, never while typing.
  useEffect(() => {
    if (!canDecideHere) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const act = shortcutAction({ key: e.key, typing: isTyping(e.target), meta: e.metaKey || e.ctrlKey || e.altKey, canApprove: a.canApprove, inline: a.inlineApprove, ready, hasLink: !!d.href });
      if (!act) return;
      e.preventDefault();
      if (act === "approve") run("approve");
      else if (act === "reason") reasonRef.current?.focus();
      else openRef.current?.click();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // run closes over the current ticks and reason, so it is re-bound with them
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canDecideHere, a.canApprove, a.inlineApprove, ready, d.href, d.ref, reason, ticks]);

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {d.kindLabel && <p className="text-xs text-muted-foreground">{d.kindLabel}</p>}
          <h2 className="font-heading text-lg font-semibold leading-tight">{d.title}</h2>
        </div>
        <Badge variant={d.stateVariant}>{d.stateLabel}</Badge>
      </div>

      {d.summary && <p className="text-muted-foreground">{d.summary}</p>}

      {d.evidence.length > 0 && (
        <dl className="flex flex-col gap-3 border-l border-border pl-3" aria-label="What you are deciding on">
          {d.evidence.map((e) => (
            <div key={e.key} className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">{e.label}</dt>
              <dd className="whitespace-pre-wrap break-words">{e.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground" aria-label="Who and when">
        {d.meta.map((m) => <li key={m}>{m}</li>)}
        {d.autonomy && <li>{d.autonomy}. Nothing happens until a person decides.</li>}
        {d.decisionReason && <li>Reason: {d.decisionReason}</li>}
      </ul>

      {canDecideHere && (
        <div className="sticky bottom-0 z-10 flex flex-col gap-3 border-t border-border bg-background pb-1 pt-4">
          {a.blocked && <p className="text-xs text-warning" role="status">{a.blocked}</p>}
          {a.canApprove && needs.map((n) => (
            <div key={n} className="flex items-start gap-2">
              <Checkbox id={`${reasonId}-${n}`} checked={!!ticks[n]} onCheckedChange={(v) => setTicks((t) => ({ ...t, [n]: v === true }))} className="mt-0.5" />
              <Label htmlFor={`${reasonId}-${n}`} className="text-sm font-normal leading-snug">{TICK_TEXT[n]}</Label>
            </div>
          ))}
          {a.canReject && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={reasonId} className="text-xs text-muted-foreground">Reason (needed to reject)</Label>
              <Textarea id={reasonId} ref={reasonRef} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} className="min-h-0" />
            </div>
          )}
          {problem && (
            <div role="alert" className="text-xs text-destructive">
              <p>{problem.error}</p>
              {problem.reasons && problem.reasons.length > 0 && <ul className="mt-1 list-disc pl-4">{problem.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {a.canApprove && (a.inlineApprove ? (
              <Button onClick={() => run("approve")} disabled={pending || !ready}>{pending ? "Working…" : "Approve"}</Button>
            ) : d.href ? (
              <Button render={<a href={d.href} ref={openRef} />}>{d.hrefLabel}</Button>
            ) : null)}
            {a.canReject && <Button variant="outline" onClick={() => run("reject")} disabled={pending || reason.trim().length < 2}>Reject</Button>}
            {d.href && !(a.canApprove && !a.inlineApprove) && <Button variant="ghost" render={<a href={d.href} ref={openRef} />}>{d.hrefLabel}</Button>}
          </div>
          <p className="hidden text-xs text-muted-foreground lg:block">
            <kbd className="rounded border border-border px-1">A</kbd> approve · <kbd className="rounded border border-border px-1">R</kbd> reason · <kbd className="rounded border border-border px-1">O</kbd> open · <kbd className="rounded border border-border px-1">↑</kbd> <kbd className="rounded border border-border px-1">↓</kbd> move
          </p>
        </div>
      )}

      {!canDecideHere && d.href && (
        <div><Button variant="outline" render={<a href={d.href} />}>{d.hrefLabel}</Button></div>
      )}
      {!canDecideHere && !d.readOnly && a.blocked && <p className="text-xs text-warning" role="status">{a.blocked}</p>}
    </div>
  );
}
