import { slaProgress, type SlaState } from "@/lib/integrations/freshdesk/sla";

/** CSS-only motion for the support views. Everything animated is wrapped in no-preference, so a visitor who asks for
 * reduced motion gets the final state immediately. Colours are theme tokens only. */
export function SlaStyles() {
  return (
    <style>{`
@property --fd-n { syntax: "<integer>"; initial-value: 0; inherits: false; }
.fd-count { --fd-n: var(--fd-to); counter-reset: fd-n var(--fd-n); font-variant-numeric: tabular-nums; }
.fd-count::after { content: counter(fd-n); }
.fd-bar > span { width: var(--fd-w); }
.fd-ring-arc { stroke-dasharray: calc(var(--fd-w) * 2.64px) 264px; }
.fd-dot { position: relative; }
@media (prefers-reduced-motion: no-preference) {
  .fd-count { animation: fd-count 300ms cubic-bezier(.2,.7,.2,1) both; }
  .fd-bar > span { animation: fd-bar 280ms cubic-bezier(.2,.7,.2,1) both; }
  .fd-ring-arc { animation: fd-ring 300ms cubic-bezier(.2,.7,.2,1) both; }
  .fd-enter { animation: fd-enter 260ms ease-out both; }
  .fd-dot::after { content: ""; position: absolute; inset: 0; border-radius: 9999px; background: inherit; animation: fd-pulse 300ms ease-out 1 both; }
  @keyframes fd-count { from { --fd-n: 0; } to { --fd-n: var(--fd-to); } }
  @keyframes fd-bar { from { width: 0; } }
  @keyframes fd-ring { from { stroke-dasharray: 0px 264px; } }
  @keyframes fd-enter { from { opacity: 0; transform: translateY(6px); } }
  @keyframes fd-pulse { from { opacity: .6; transform: scale(1); } to { opacity: 0; transform: scale(2.6); } }
}
`}</style>
  );
}

const TONE: Record<SlaState, string> = {
  ok: "var(--primary)",
  at_risk: "var(--warning)",
  breached: "var(--destructive)",
  met: "var(--success)",
};

export function formatRemaining(ms: number): string {
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60_000);
  const text = mins < 60 ? `${Math.max(mins, 1)}m` : mins < 2880 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${Math.round(mins / 1440)}d`;
  return ms >= 0 ? `due in ${text}` : `overdue by ${text}`;
}

const STATE_LABEL: Record<SlaState, string> = { ok: "On track", at_risk: "At risk", breached: "Breached", met: "Met" };

/** A thin progress bar for one SLA window, with its state in words (never colour alone). */
export function SlaBar({ label, start, due, now, doneAt }: { label: string; start: Date; due: Date; now: Date; doneAt?: Date | null }) {
  const p = slaProgress(start, due, now, doneAt);
  return (
    <div className="flex flex-col gap-1" data-sla-state={p.state}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
        <span className="whitespace-nowrap text-muted-foreground">{label}</span>
        <span className="whitespace-nowrap font-medium" style={{ color: TONE[p.state] }}>
          {STATE_LABEL[p.state]}
          <span className="font-normal text-muted-foreground">{doneAt ? "" : ` · ${formatRemaining(p.remainingMs)}`}</span>
        </span>
      </div>
      <div className="fd-bar h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${label} SLA`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.pct} style={{ ["--fd-w" as string]: `${p.pct}%` }}>
        <span className="block h-full rounded-full" style={{ background: TONE[p.state] }} />
      </div>
    </div>
  );
}

/** A number that counts up from zero (CSS only). The real value is always in the text for assistive tech. */
export function CountUp({ value, suffix = "", className }: { value: number; suffix?: string; className?: string }) {
  return (
    <span className={className}>
      <span className="fd-count" aria-hidden="true" style={{ ["--fd-to" as string]: Math.round(value) }} />
      <span aria-hidden="true">{suffix}</span>
      <span className="sr-only">{`${Math.round(value)}${suffix}`}</span>
    </span>
  );
}

/** Ring showing SLA compliance. Null = nothing to measure yet, shown as an empty ring with a dash. */
export function SlaRing({ pct, label = "SLA compliance" }: { pct: number | null; label?: string }) {
  const value = pct ?? 0;
  const tone = pct === null ? "var(--muted)" : pct >= 90 ? "var(--success)" : pct >= 70 ? "var(--warning)" : "var(--destructive)";
  return (
    <div className="relative size-32 shrink-0" role="img" aria-label={pct === null ? `${label}: no data yet` : `${label}: ${pct} percent`}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r="42" fill="none" strokeWidth="9" stroke="var(--muted)" />
        {pct !== null && <circle className="fd-ring-arc" cx="50" cy="50" r="42" fill="none" strokeWidth="9" strokeLinecap="round" stroke={tone} style={{ ["--fd-w" as string]: value }} />}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {pct === null ? <span className="font-heading text-2xl text-muted-foreground">–</span> : <CountUp value={value} suffix="%" className="font-heading text-3xl" />}
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}
