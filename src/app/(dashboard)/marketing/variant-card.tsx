"use client";

import { useId, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, MinusCircle, Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BrandProfile } from "@/lib/creative/brand";
import { evaluateVariant } from "@/lib/creative/evaluate";
import { AD_FORMATS, charCount, counterState, type FieldValues } from "@/lib/creative/formats";
import { VARIANT_STATUS_LABEL, approvalBlockedReason } from "@/lib/creative/variant-workflow";
import { cn } from "@/lib/utils";

import { AdPreview } from "./ad-preview";
import { saveVariantAction, transitionVariantAction } from "./creative-actions";
import { Labelled, StatusLine, areaClass, fieldClass, useAction } from "./creative-ui";
import type { BriefView, VariantView } from "@/lib/creative/briefs-db";

const VERDICT = { scale: { label: "Scale", variant: "success" }, iterate: { label: "Iterate", variant: "warning" }, rewrite: { label: "Rewrite", variant: "destructive" } } as const;
const COUNTER_TONE = { ok: "text-muted-foreground", near: "text-warning", over: "text-destructive font-medium" } as const;

function Counter({ length, max }: { length: number; max: number }) {
  return <span className={cn("text-[11px] tabular-nums", COUNTER_TONE[counterState(length, max)])} aria-label={`${length} of ${max} characters`}>{length}/{max}</span>;
}

function FieldsEditor({ variant, fields, setFields, disabled }: { variant: VariantView; fields: FieldValues; setFields: (f: FieldValues) => void; disabled: boolean }) {
  const uid = useId();
  return (
    <div className="flex flex-col gap-3">
      {AD_FORMATS[variant.format].fields.map((spec) => {
        const values = fields[spec.key] ?? [];
        const rows = values.length === 0 && spec.count.min > 0 ? [""] : values;
        const set = (i: number, v: string) => setFields({ ...fields, [spec.key]: rows.map((x, j) => (j === i ? v : x)) });
        return (
          <fieldset key={spec.key} className="flex min-w-0 flex-col gap-1.5">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">{spec.label}{spec.hint ? ` (${spec.hint.toLowerCase()})` : ""}</legend>
            {rows.map((v, i) => {
              const id = `${uid}-${spec.key}-${i}`;
              return (
                <div key={i} className="flex items-start gap-1.5">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {spec.max > 60 ? <textarea id={id} aria-label={`${spec.label} ${i + 1}`} rows={2} className={areaClass} disabled={disabled} value={v} onChange={(e) => set(i, e.target.value)} /> : <input id={id} aria-label={`${spec.label} ${i + 1}`} className={fieldClass} disabled={disabled} value={v} onChange={(e) => set(i, e.target.value)} />}
                    <div className="flex justify-end"><Counter length={charCount(v)} max={spec.max} /></div>
                  </div>
                  {spec.count.max > 1 && rows.length > spec.count.min && !disabled && (
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${spec.label} ${i + 1}`} onClick={() => setFields({ ...fields, [spec.key]: rows.filter((_, j) => j !== i) })}>
                      <X aria-hidden className="size-4" />
                    </Button>
                  )}
                </div>
              );
            })}
            {spec.count.max > 1 && rows.length < spec.count.max && !disabled && (
              <Button type="button" size="xs" variant="ghost" className="self-start" onClick={() => setFields({ ...fields, [spec.key]: [...rows, ""] })}>
                <Plus aria-hidden className="size-3.5" /> Add {spec.label.toLowerCase()}
              </Button>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}

function Checklist({ checks }: { checks: ReturnType<typeof evaluateVariant>["checks"] }) {
  const ordered = [...checks.filter((c) => c.status === "fail"), ...checks.filter((c) => c.status === "pass"), ...checks.filter((c) => c.status === "not_applicable")];
  return (
    <ul aria-label="Compliance checklist" className="flex flex-col gap-1">
      {ordered.map((c) => (
        <li key={c.id} className="flex items-start gap-2 text-xs">
          {c.status === "fail" ? <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-destructive" /> : c.status === "pass" ? <CheckCircle2 aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" /> : <MinusCircle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
          <span className="min-w-0">
            <span className={cn("font-medium", c.status === "fail" && "text-destructive")}><span className="sr-only">{c.status === "fail" ? "Fail: " : c.status === "pass" ? "Pass: " : "Not applicable: "}</span>{c.label}</span>
            {c.status === "fail" && (
              <span className="block text-muted-foreground">
                {c.matched && <span>Matched: <q className="font-medium text-foreground">{c.matched}</q>. </span>}
                {c.message}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function VariantCard({ variant, brief, profile, referenceCopies, viewerId }: { variant: VariantView; brief: BriefView; profile: BrandProfile; referenceCopies: string[]; viewerId: string }) {
  const { run, pending, message } = useAction();
  const [fields, setFields] = useState<FieldValues>(variant.fields);
  const [disclaimer, setDisclaimer] = useState(variant.disclaimer);
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const dirty = JSON.stringify(fields) !== JSON.stringify(variant.fields) || disclaimer !== variant.disclaimer;

  // Live check with the same functions the server runs at every gate. The server's own result decides.
  const live = useMemo(() => evaluateVariant({ format: variant.format, fields, disclaimer, language: variant.language, topic: brief.topic, profile, referenceCopies }), [variant.format, fields, disclaimer, variant.language, brief.topic, profile, referenceCopies]);
  const verdict = VERDICT[live.verdict];
  const blocked = approvalBlockedReason({ source: variant.source, authorId: variant.authorId }, viewerId);
  const failing = live.checks.filter((c) => c.status === "fail").length;

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3" aria-label={`${AD_FORMATS[variant.format].label} variant`}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading text-sm font-semibold">{AD_FORMATS[variant.format].label}</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {variant.source === "AI" && <Badge variant="secondary">AI draft</Badge>}
          <Badge variant={variant.status === "APPROVED" ? "success" : variant.status === "NEEDS_REVIEW" ? "warning" : "outline"}>{VARIANT_STATUS_LABEL[variant.status]}</Badge>
          <Badge variant={live.complianceStatus === "PASS" ? "success" : "destructive"}>Compliance: {live.complianceStatus === "PASS" ? "Pass" : "Fail"}</Badge>
          <Badge variant={verdict.variant}>{verdict.label} · {live.score}</Badge>
        </div>
      </header>
      <p className="text-xs text-muted-foreground">{AD_FORMATS[variant.format].note}</p>
      {variant.reviewNote && variant.status === "DRAFT" && <p role="status" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs"><strong className="font-medium">Changes requested:</strong> {variant.reviewNote}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <FieldsEditor variant={variant} fields={fields} setFields={setFields} disabled={pending} />
          <Labelled label="Disclaimer (shown in the creative's fine print or on the landing page)" htmlFor={`${variant.id}-disc`}>
            <textarea id={`${variant.id}-disc`} rows={3} className={areaClass} disabled={pending} value={disclaimer} onChange={(e) => setDisclaimer(e.target.value)} />
          </Labelled>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <AdPreview format={variant.format} fields={fields} disclaimer={disclaimer} />
          <section aria-label="Checklist">
            <h4 className="mb-1 text-xs font-semibold">Checklist: {failing === 0 ? "every rule passes" : `${failing} to fix`}</h4>
            <Checklist checks={live.checks} />
          </section>
          <section aria-label="Scoring rubric">
            <h4 className="mb-1 text-xs font-semibold">Rubric: {verdict.label}{live.rubric.overridden ? " (compliance overrides the score)" : ""}</h4>
            <ul className="grid grid-cols-1 gap-0.5 text-xs">
              {live.rubric.criteria.map((c) => (
                <li key={c.id} className="flex items-baseline justify-between gap-2"><span className="min-w-0 truncate" title={c.note}>{c.label}</span><span className="tabular-nums text-muted-foreground">{c.points}/{c.max}</span></li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <footer className="flex flex-col gap-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <Button size="sm" disabled={pending} onClick={() => run(() => saveVariantAction(variant.id, { fields, disclaimer }), variant.status !== "DRAFT" ? "Saved. The copy is back in Draft and needs review again." : "Saved.")}>Save changes</Button>}
          {variant.status === "DRAFT" && !dirty && (
            <Button size="sm" variant="outline" disabled={pending || variant.complianceStatus !== "PASS"} onClick={() => run(() => transitionVariantAction(variant.id, "submit"), "Sent for review.")} title={variant.complianceStatus !== "PASS" ? "Fix the failing rules first" : undefined}>Submit for review</Button>
          )}
        </div>
        {variant.status === "NEEDS_REVIEW" && !dirty && (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-2.5">
            {blocked ? <p role="note" className="text-xs text-muted-foreground">{blocked}</p> : (
              <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I have read this copy and its checklist, and it is fit to go to the firm&apos;s ad-approval process.</label>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={pending || Boolean(blocked) || !confirmed || variant.complianceStatus !== "PASS"} onClick={() => run(() => transitionVariantAction(variant.id, "approve", { confirmed }), "Approved.")}>Approve</Button>
              <input aria-label="What needs to change" className={cn(fieldClass, "max-w-56")} placeholder="What needs to change" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button size="sm" variant="outline" disabled={pending || !note.trim()} onClick={() => run(() => transitionVariantAction(variant.id, "request_changes", { note }), "Sent back with your note.")}>Request changes</Button>
            </div>
          </div>
        )}
        {variant.status === "APPROVED" && <p className="text-xs text-muted-foreground">Approved. Editing the copy withdraws the approval. Nothing is published from here: use the printable annexure for the firm&apos;s ad-approval process.</p>}
        <StatusLine message={message} />
        {variant.events.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">History</summary>
            <ol className="mt-1 flex flex-col gap-0.5">{variant.events.map((e, i) => <li key={i}>{new Date(e.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} · {e.action.replace(/_/g, " ")}{e.note ? ` · ${e.note}` : ""}</li>)}</ol>
          </details>
        )}
      </footer>
    </article>
  );
}
