"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ChevronDown, MessageCircle, MessageSquareText, Users, UserRound } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AudienceOptions, StudioTemplate } from "@/lib/marketing/broadcast/audience";
import { CHANNEL_LABEL, EMPTY_DRAFT, FIRST_NAME_TOKEN, LIFECYCLE_STATUSES, type BroadcastChannel, type BroadcastDraft } from "@/lib/marketing/broadcast/schema";
import { STUDIO_STEPS, furthestReachable, parseStep, stepIssues, type StepNumber } from "@/lib/marketing/broadcast/steps";
import { substitute } from "@/lib/messaging/template-vars";
import { cn } from "@/lib/utils";

import { estimateAudienceAction, submitBroadcastDraftAction } from "../actions";

type Estimate = { matched: number; consented: number; approximate: boolean };

const num = (n: number) => new Intl.NumberFormat("en-IN").format(n);
const SAMPLE_FIRST_NAME = "Priya";
const SELECT = "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const storageKey = (userId: string) => `studio-draft:${userId}`;
function readSaved(userId: string): BroadcastDraft | null {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<BroadcastDraft>;
    return { ...EMPTY_DRAFT, ...d, audience: { ...EMPTY_DRAFT.audience, ...(d.audience ?? {}) }, variables: d.variables ?? {} };
  } catch {
    return null;
  }
}
/** Nothing entered yet: not worth keeping, and not worth a "we kept your draft" note. */
const isBlank = (d: BroadcastDraft) => JSON.stringify(d) === JSON.stringify(EMPTY_DRAFT);

function writeSaved(userId: string, d: BroadcastDraft | null) {
  try {
    if (d && !isBlank(d)) window.localStorage.setItem(storageKey(userId), JSON.stringify(d));
    else window.localStorage.removeItem(storageKey(userId));
  } catch {
    /* storage unavailable: the draft autosave is a convenience only */
  }
}

/**
 * Campaign Studio: one decision per step, the step in the URL (?step=), the live audience count always in view, and nothing that
 * sends. The last step submits a draft for a colleague's approval (BROADCAST_DRAFT).
 */
export function StudioWizard({ options, templates, userId, canManageTemplates }: { options: AudienceOptions; templates: StudioTemplate[]; userId: string; canManageTemplates: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [draft, setDraft] = useState<BroadcastDraft>(EMPTY_DRAFT);
  const [restored, setRestored] = useState(false);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const loaded = useRef(false);

  // Restore an unsent draft once, after mount (storage is per browser and may be unavailable).
  useEffect(() => {
    const saved = readSaved(userId);
    loaded.current = true;
    if (!saved || isBlank(saved)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from browser storage after hydration
    setDraft(saved);
    setRestored(true);
  }, [userId]);
  useEffect(() => {
    if (loaded.current) writeSaved(userId, draft);
  }, [draft, userId]);

  // Live audience count, debounced; an older answer never overwrites a newer question.
  const audienceKey = JSON.stringify([draft.audience, draft.channel]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const r = await estimateAudienceAction(draft.audience, draft.channel).catch(() => ({ ok: false as const, error: "Couldn't count this audience right now." }));
      if (!live) return;
      if (r.ok) {
        setEstimate({ matched: r.matched, consented: r.consented, approximate: r.approximate });
        setEstimateError(null);
      } else setEstimateError(r.error);
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // audienceKey stands for draft.audience and draft.channel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceKey]);

  const template = templates.find((t) => t.id === draft.templateId && t.channel === draft.channel) ?? null;
  const ctx = useMemo(() => ({ consented: estimateError ? 0 : estimate?.consented ?? null, templateVariables: template?.variables ?? null, now: new Date() }), [estimate, estimateError, template]);
  const reachable = furthestReachable(draft, ctx);
  const requested = parseStep(search.get("step"));
  const step: StepNumber = Math.min(requested, reachable) as StepNumber;
  const issues = stepIssues(step, draft, ctx);

  const goTo = useCallback(
    (n: StepNumber) => {
      const usp = new URLSearchParams(search.toString());
      usp.set("step", String(n));
      // Shallow: the native history API syncs useSearchParams without re-running the server page (and its queries); Back steps back.
      window.history.pushState(null, "", `${pathname}?${usp.toString()}`);
    },
    [pathname, search],
  );

  const set = <K extends keyof BroadcastDraft>(k: K, v: BroadcastDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setAudience = (k: keyof BroadcastDraft["audience"], v: string) => setDraft((d) => ({ ...d, audience: { ...d.audience, [k]: v } }));
  const setChannel = (c: BroadcastChannel) => setDraft((d) => (d.channel === c ? d : { ...d, channel: c, templateId: "", variables: {} }));

  const preview = template ? substitute(template.body, Object.fromEntries(template.variables.map((k) => [k, draft.variables[k] === FIRST_NAME_TOKEN ? SAMPLE_FIRST_NAME : draft.variables[k] || `{{${k}}}`]))) : null;

  function startOver() {
    setDraft(EMPTY_DRAFT);
    setRestored(false);
    goTo(1);
  }

  function submit() {
    startSubmit(async () => {
      const r = await submitBroadcastDraftAction(draft);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      writeSaved(userId, null);
      loaded.current = false;
      toast.success("Broadcast sent for approval");
      router.push("/marketing/studio");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New broadcast"
        description="Four short steps. It goes to a colleague for approval; nothing sends from here."
        actions={
          <Button variant="ghost" render={<Link href="/marketing/studio" />}>
            <ArrowLeft aria-hidden /> All broadcasts
          </Button>
        }
      />

      {restored && (
        <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          We kept your unsent draft from last time.
          <button type="button" onClick={startOver} className="font-medium underline underline-offset-2 hover:text-foreground">Start over</button>
        </p>
      )}

      <Stepper current={step} reachable={reachable} onSelect={goTo} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="studio-step-title" className="rounded-xl border bg-card p-4 sm:p-6">
          {/* Keyed so each step enters once: 200ms fade + 8px slide, none under reduced motion (docs/ux/design-system.md). */}
          <div key={step} className="flex flex-col gap-5 animate-in fade-in-0 slide-in-from-right-2 duration-200 ease-out motion-reduce:animate-none">
            <h2 id="studio-step-title" className="font-heading text-base font-semibold">{STUDIO_STEPS[step - 1].label}</h2>

            {step === 1 && (
              <>
                <Field label="Who">
                  <Segmented value={draft.audience.status} onChange={(v) => setAudience("status", v)} options={LIFECYCLE_STATUSES.map((s) => ({ value: s.value, label: s.label }))} label="Lifecycle" />
                </Field>
                {options.segments.length > 0 && (
                  <Field label="Segment" hint="Optional. One saved segment.">
                    <div className="flex flex-wrap gap-2">
                      {options.segments.map((s) => (
                        <Chip key={s.key} active={draft.audience.segment === s.key} onClick={() => setAudience("segment", draft.audience.segment === s.key ? "" : s.key)}>
                          {s.key} <span className="tabular-nums text-muted-foreground">{num(s.count)}</span>
                        </Chip>
                      ))}
                    </div>
                  </Field>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Stage" htmlFor="studio-stage">
                    <select id="studio-stage" className={SELECT} value={draft.audience.stage} onChange={(e) => setAudience("stage", e.target.value)}>
                      <option value="">Any stage</option>
                      {options.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Lead source" htmlFor="studio-source">
                    <select id="studio-source" className={SELECT} value={draft.audience.leadSource} onChange={(e) => setAudience("leadSource", e.target.value)}>
                      <option value="">Any source</option>
                      {options.leadSources.map((s) => <option key={s.key} value={s.key}>{s.key} ({num(s.count)})</option>)}
                    </select>
                  </Field>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <Field label="Channel">
                  <Segmented value={draft.channel} onChange={(v) => setChannel(v as BroadcastChannel)} options={[{ value: "whatsapp", label: "WhatsApp" }, { value: "sms", label: "SMS" }]} label="Channel" />
                </Field>
                <Field label="Template" hint="Only approved templates can be broadcast.">
                  {templates.filter((t) => t.channel === draft.channel).length === 0 ? (
                    <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      No approved {CHANNEL_LABEL[draft.channel]} template yet.{" "}
                      {canManageTemplates ? <Link href="/settings/templates" className="font-medium text-foreground underline underline-offset-2">Add one in Templates</Link> : "Ask an admin to approve one."}
                    </p>
                  ) : (
                    <div role="radiogroup" aria-label="Template" className="grid gap-2 sm:grid-cols-2">
                      {templates.filter((t) => t.channel === draft.channel).map((t) => {
                        const on = t.id === draft.templateId;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => setDraft((d) => ({ ...d, templateId: t.id, variables: Object.fromEntries(t.variables.map((k) => [k, d.variables[k] ?? ""])) }))}
                            className={cn("flex flex-col gap-1 rounded-lg border p-3 text-left transition-[border-color,background-color,box-shadow] duration-150 hover:border-foreground/30 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none", on && "border-primary bg-primary/5 ring-1 ring-primary")}
                          >
                            <span className="flex items-center justify-between gap-2 text-sm font-medium">
                              {t.name}
                              {on && <Check className="size-4 text-[var(--primary-ink)]" aria-hidden />}
                            </span>
                            <span className="line-clamp-2 text-xs text-muted-foreground">{t.body}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </Field>
              </>
            )}

            {step === 3 && template && (
              template.variables.length === 0 ? (
                <p className="text-sm text-muted-foreground">This template has nothing to fill in. Check the preview and continue.</p>
              ) : (
                template.variables.map((k) => {
                  const personal = draft.variables[k] === FIRST_NAME_TOKEN;
                  return (
                    <Field key={k} label={`{{${k}}}`} htmlFor={`var-${k}`}>
                      <div className="flex gap-2">
                        <Input id={`var-${k}`} value={personal ? "" : draft.variables[k] ?? ""} placeholder={personal ? "Each customer's first name" : "Text for every customer"} disabled={personal} onChange={(e) => set("variables", { ...draft.variables, [k]: e.target.value })} />
                        <Button type="button" variant="outline" aria-pressed={personal} className={cn(personal && "border-primary bg-primary/10 text-[var(--primary-ink)] hover:bg-primary/15")} onClick={() => set("variables", { ...draft.variables, [k]: personal ? "" : FIRST_NAME_TOKEN })}>
                          {personal ? <Check aria-hidden /> : <UserRound aria-hidden />} First name
                        </Button>
                      </div>
                    </Field>
                  );
                })
              )
            )}

            {step === 4 && (
              <>
                <Field label="Name" htmlFor="studio-name" hint="For you and the approver; customers never see it.">
                  <Input id="studio-name" value={draft.name} maxLength={80} placeholder="e.g. Diwali SIP top-up nudge" onChange={(e) => set("name", e.target.value)} />
                </Field>
                <dl className="grid gap-3 rounded-lg bg-muted/40 p-4 text-sm sm:grid-cols-3">
                  <Fact label="Recipients" value={estimate ? `${estimate.approximate ? "≈ " : ""}${num(estimate.consented)}` : "…"} />
                  <Fact label="Channel" value={CHANNEL_LABEL[draft.channel]} />
                  <Fact label="Template" value={template?.name ?? "—"} />
                </dl>
                <details className="group rounded-lg border">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium">
                    Advanced
                    <ChevronDown className="size-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
                  </summary>
                  <div className="flex flex-col gap-4 border-t px-4 py-4">
                    <Field label="Send on" htmlFor="studio-when" hint="Optional. Leave empty to send once it is approved and sending is switched on.">
                      <Input id="studio-when" type="datetime-local" value={draft.scheduledFor} onChange={(e) => set("scheduledFor", e.target.value)} />
                    </Field>
                    <Field label="Note for the approver" htmlFor="studio-note">
                      <Textarea id="studio-note" rows={3} maxLength={500} value={draft.note} onChange={(e) => set("note", e.target.value)} placeholder="Why now, and anything they should check." />
                    </Field>
                  </div>
                </details>
              </>
            )}
          </div>

          <div className="mt-6 flex flex-col gap-3 border-t pt-4">
            <p aria-live="polite" className="min-h-5 text-sm text-muted-foreground">{(step === 1 && estimateError) || issues[0] || (step === 4 ? "A colleague approves it before anything can go out." : null)}
              {/* Below xl the summary column sits under the card: keep the one number that matters in view here. */}
              {!issues[0] && !estimateError && step < 4 && estimate && <span className="xl:hidden">{estimate.approximate ? "≈ " : ""}{num(estimate.consented)} can receive this on {CHANNEL_LABEL[draft.channel]}.</span>}
            </p>
            <div className="flex justify-end gap-2">
              {step > 1 && (
                <Button variant="outline" onClick={() => goTo((step - 1) as StepNumber)}>
                  <ArrowLeft aria-hidden /> Back
                </Button>
              )}
              {step < 4 ? (
                <Button onClick={() => goTo((step + 1) as StepNumber)} disabled={issues.length > 0}>
                  Continue <ArrowRight aria-hidden />
                </Button>
              ) : (
                <Button onClick={submit} disabled={issues.length > 0 || submitting}>
                  {submitting ? "Submitting…" : "Submit for approval"}
                </Button>
              )}
            </div>
          </div>
        </section>

        <aside aria-label="Broadcast summary" className="grid gap-4 sm:grid-cols-2 xl:sticky xl:top-4 xl:grid-cols-1 xl:self-start">
          <div className="rounded-xl border bg-card p-4">
            <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Users className="size-3.5" aria-hidden /> Can receive this</p>
            <p className="mt-1 font-heading text-3xl font-semibold tabular-nums" aria-live="polite">
              {estimateError ? "—" : estimate ? `${estimate.approximate ? "≈ " : ""}${num(estimate.consented)}` : "…"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {estimateError ?? (estimate ? `${num(estimate.matched)} match · ${num(Math.max(0, estimate.matched - estimate.consented))} without marketing consent on ${CHANNEL_LABEL[draft.channel]}` : "Counting…")}
            </p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              {draft.channel === "whatsapp" ? <MessageCircle className="size-3.5" aria-hidden /> : <MessageSquareText className="size-3.5" aria-hidden />} Preview
            </p>
            {preview ? (
              <p className="mt-2 rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{preview}</p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Pick a template to see the message.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Stepper({ current, reachable, onSelect }: { current: StepNumber; reachable: StepNumber; onSelect: (n: StepNumber) => void }) {
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label="Steps">
      {STUDIO_STEPS.map((s) => {
        const done = s.n < current;
        const active = s.n === current;
        const open = s.n <= reachable;
        return (
          <li key={s.n}>
            <button
              type="button"
              disabled={!open}
              onClick={() => onSelect(s.n)}
              aria-current={active ? "step" : undefined}
              className="group flex w-full flex-col gap-2 text-left disabled:cursor-not-allowed focus-visible:outline-none"
            >
              <span className={cn("h-1 rounded-full bg-muted transition-colors duration-200 motion-reduce:transition-none", (done || active) && "bg-primary")} />
              <span className={cn("flex items-center gap-1.5 text-xs font-medium text-muted-foreground group-focus-visible:underline", active && "text-foreground")}>
                {done ? <Check className="size-3.5 text-[var(--primary-ink)]" aria-hidden /> : <span className="tabular-nums">{s.n}</span>}
                <span className="truncate max-sm:sr-only">{s.label}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {htmlFor ? <Label htmlFor={htmlFor}>{label}</Label> : <p className="text-sm font-medium">{label}</p>}
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Segmented({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-fit rounded-lg bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value || "all"}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-[background-color,color,box-shadow] duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none", value === o.value && "bg-background text-foreground shadow-sm")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-[border-color,background-color] duration-150 hover:border-foreground/30 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none", active && "border-primary bg-primary/10")}
    >
      {children}
    </button>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums">{value}</dd>
    </div>
  );
}
