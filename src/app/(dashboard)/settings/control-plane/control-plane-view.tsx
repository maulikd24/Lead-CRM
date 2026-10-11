import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { PhoneSheet, ShowFirst } from "@/components/workspace";
import { cn } from "@/lib/utils";
import { buildAlertEmailDraft } from "@/lib/system/alerts";
import type { IntegrationRow, JobRow, Tone } from "@/lib/system/control-plane-model";
import type { AlertRow, JobsData, Panel, StripData, readHealth } from "@/lib/system/control-plane-read";
import { DIAGNOSIS, type Coverage } from "@/lib/system/diagnosis";
import type { DataRisk, FailureGroup } from "@/lib/system/failures";
import { AcknowledgeButton, EmailDraftBlock, RefreshButton, RetryJobButton, RetryLeadsButton } from "./controls";

/* ---- small, shared pieces -------------------------------------------------------------------------------------------------------- */
const TONE_ICON = { ok: CheckCircle2, warn: AlertTriangle, bad: XCircle, idle: CircleDashed } as const;
const TONE_CLASS = { ok: "text-success", warn: "text-warning", bad: "text-destructive", idle: "text-muted-foreground" } as const;
const BASE = "/settings/control-plane";

/** State is always an icon AND a word, never colour alone. */
export function StatusChip({ tone, word, className }: { tone: Tone; word: string; className?: string }) {
  const Icon = TONE_ICON[tone];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium", TONE_CLASS[tone], className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {word}
    </span>
  );
}

export function ago(date: Date | null, now: Date): string {
  if (!date) return "never";
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
export function inFuture(date: Date | null, now: Date): string {
  if (!date) return "on request";
  const m = Math.round((date.getTime() - now.getTime()) / 60_000);
  if (m <= 0) return "due now";
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `in ${h} h` : `in ${Math.round(h / 24)} days`;
}
export const duration = (ms: number | null): string => (ms === null ? "n/a" : ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`);
export const pct = (rate: number | null): string => (rate === null ? "n/a" : `${Math.round(rate * 100)}%`);
const clock = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });

export function PanelError({ name, error }: { name: string; error: Extract<Panel<unknown>, { ok: false }> }) {
  return (
    <p role="status" className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">
      Could not read {name} ({error.errorClass}). The other panels are unaffected. Use Refresh to try again.
    </p>
  );
}

function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <span className="text-xs text-muted-foreground">n/a</span>;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 60},${16 - (v / max) * 14}`).join(" ");
  return (
    <svg viewBox="0 0 60 16" width="60" height="16" role="img" aria-label={label} className="text-muted-foreground">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ---- the strip above every tab ----------------------------------------------------------------------------------------------------- */
export function StripView({ data, now }: { data: StripData; now: Date }) {
  const { strip } = data;
  const sentence = strip.needsAttention === 0 ? "All clear" : `${strip.needsAttention} ${strip.needsAttention === 1 ? "thing needs" : "things need"} attention`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <p className="flex items-center gap-2 font-heading text-base font-semibold lg:text-lg">
        <StatusChip tone={strip.tone} word={strip.tone === "ok" ? "OK" : strip.tone === "warn" ? "Attention" : "Critical"} />
        <span>{sentence}</span>
      </p>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Updated {clock(data.generatedAt)} ({ago(data.generatedAt, now)})</span>
        <RefreshButton />
      </p>
    </div>
  );
}

/* ---- Health ------------------------------------------------------------------------------------------------------------------------- */
type Health = Awaited<ReturnType<typeof readHealth>>;

function Tile({ label, value, detail, tone, word, href }: { label: string; value: ReactNode; detail?: ReactNode; tone?: Tone; word?: string; href?: string }) {
  const body = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        {tone && word && <StatusChip tone={tone} word={word} />}
      </div>
      <p className="font-heading text-lg font-semibold leading-tight tabular-nums">{value}</p>
      {detail && <p className="text-xs text-muted-foreground max-lg:line-clamp-2">{detail}</p>}
    </>
  );
  const cls = "flex min-w-0 flex-col gap-0.5 rounded-xl border border-border bg-card px-3 py-2";
  return href ? <Link href={href} className={cn(cls, "hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring")}>{body}</Link> : <div className={cls}>{body}</div>;
}

function Alerts({ alerts, now }: { alerts: AlertRow[]; now: Date }) {
  if (alerts.length === 0) return <p className="rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground">No open alerts.</p>;
  const rows = alerts.map((a) => {
    const draft = a.severity === "CRITICAL" ? buildAlertEmailDraft({ key: a.key, severity: a.severity, title: a.title, detail: a.detail, firstRaisedAt: a.firstRaisedAt }, BASE) : null;
    return (
      <div key={a.id} className="flex flex-col gap-1.5 py-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="min-w-0 text-sm">
            <StatusChip tone={a.severity === "CRITICAL" ? "bad" : "warn"} word={a.severity === "CRITICAL" ? "Critical" : "Warning"} className="mr-2" />
            <span className="font-medium">{a.title}</span>
            <span className="block text-xs text-muted-foreground">First seen {ago(a.firstRaisedAt, now)}{a.acknowledgedAt ? `, acknowledged ${ago(a.acknowledgedAt, now)}` : ""}</span>
          </p>
          {!a.acknowledgedAt && <AcknowledgeButton alertId={a.id} />}
        </div>
        {draft && <EmailDraftBlock subject={draft.subject} body={draft.body} mailto={draft.mailto} />}
      </div>
    );
  });
  return (
    <section aria-label="Open alerts" className="rounded-xl border border-border bg-card px-3">
      <ShowFirst name="alerts" title="Open alerts" items={rows} limit={2} as="div" flush noun="alerts" />
    </section>
  );
}

const COVERAGE_WORD: Record<Coverage, string> = { full: "Answered", partial: "Partly answered", link: "See", deferred: "Not built yet" };

function Diagnosis() {
  const counts = { full: DIAGNOSIS.filter((d) => d.coverage === "full").length, partial: DIAGNOSIS.filter((d) => d.coverage === "partial").length };
  return (
    <PhoneSheet name="diagnosis" title="30-second diagnosis" summary={`${counts.full} answered here, ${counts.partial} partly, the rest linked or not built yet`}>
      <section aria-label="Diagnosis questions" className="rounded-xl border border-border bg-card px-3 py-2">
        <h3 className="text-sm font-medium">30-second diagnosis</h3>
        <ul className="mt-1 divide-y divide-border text-sm">
          {DIAGNOSIS.map((d) => {
            const href = d.tab ? `${BASE}?tab=${d.tab}` : d.href;
            return (
              <li key={d.n} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
                <span className="min-w-0">
                  <span className="text-muted-foreground">{d.n}. </span>
                  {href ? <Link href={href} className="underline-offset-2 hover:underline">{d.question}</Link> : d.question}
                  <span className="block text-xs text-muted-foreground">{d.where}</span>
                </span>
                <Badge variant={d.coverage === "full" ? "success" : d.coverage === "deferred" ? "outline" : "secondary"}>{COVERAGE_WORD[d.coverage]}</Badge>
              </li>
            );
          })}
        </ul>
      </section>
    </PhoneSheet>
  );
}

export function HealthView({ health, now }: { health: Health; now: Date }) {
  const { status, tick, jobsLastTick, whatsapp, freshness, audit, alerts, release } = health;
  const tiles: ReactNode[] = [];

  if (tick.ok) {
    const t = tick.data;
    const bad = t.heartbeatState === "stale" || t.heartbeatState === "never" || t.abandoned > 0;
    const warn = t.skippedInARow >= 3 || (t.windowShare ?? 0) > 0.8;
    tiles.push(
      <Tile key="tick" label="Scheduler" href={`${BASE}?tab=jobs`}
        tone={bad ? "bad" : warn ? "warn" : t.heartbeatState === "ticking" ? "ok" : "idle"}
        word={t.heartbeatState === "ticking" ? (warn ? "Slow" : "Ticking") : t.heartbeatState === "stale" ? "Stale" : t.heartbeatState === "never" ? "Never ticked" : "Unknown"}
        value={t.heartbeatMinutes === null ? "No heartbeat" : `${t.heartbeatMinutes} min ago`}
        detail={t.last ? `Last tick ${duration(t.last.durationMs)}${t.windowShare !== null ? `, ${Math.round(t.windowShare * 100)}% of its window` : ""}${t.skippedInARow ? `, ${t.skippedInARow} skipped in a row` : ""}` : "No runs recorded yet. The next cron tick (due within 5 minutes) fills this in."} />,
    );
  } else tiles.push(<PanelError key="tick" name="Scheduler" error={tick} />);

  if (status.ok) {
    const s = status.data;
    const dbOk = s.database.connected;
    const migWarn = !!s.migrations && (s.migrations.failed.length > 0 || (s.migrations.pending ?? 0) > 0);
    tiles.push(
      <Tile key="db" label="Database" tone={!dbOk ? "bad" : migWarn ? "warn" : "ok"} word={!dbOk ? "Down" : migWarn ? "Check" : "OK"}
        value={dbOk ? `${s.database.latencyMs} ms` : "Unreachable"}
        detail={dbOk ? `Postgres ${s.database.serverVersion}; ${s.migrations ? `${s.migrations.applied} migrations applied, ${s.migrations.pending ?? "?"} pending` : "migrations unreadable"}` : "Check the connection settings"} />,
    );
    const attention = s.queues.filter((q) => q.level === "attention").length;
    tiles.push(
      <Tile key="queues" label="Queues" href="/settings/system/status" tone={attention ? "warn" : "ok"} word={attention ? "Waiting" : "Clear"}
        value={`${s.queues.reduce((n, q) => n + (q.key === "merge_open" ? 0 : q.depth), 0)} waiting`}
        detail={s.queues.filter((q) => q.depth > 0 && q.key !== "merge_open").map((q) => `${q.depth} ${q.label.toLowerCase()}${q.oldestMinutes !== null ? ` (oldest ${q.oldestMinutes} min)` : ""}`).slice(0, 2).join("; ") || "Nothing waiting"} />,
    );
    tiles.push(
      <Tile key="flags" label="Flags" href="/settings/system/status" tone="idle" word="Not checked"
        value={`${s.flags.on.length} on`} detail="The validity check arrives with the flag registry. Open System status for the full list." />,
    );
  } else {
    tiles.push(<PanelError key="status" name="Database, queues and flags" error={status} />);
  }

  if (jobsLastTick.ok) {
    const j = jobsLastTick.data;
    tiles.push(
      <Tile key="jobs" label="Jobs in the last tick" href={`${BASE}?tab=jobs`} tone={!j ? "idle" : j.failed ? "warn" : j.notReached ? "warn" : "ok"} word={!j ? "No data" : j.failed ? `${j.failed} failed` : j.notReached ? "Some not reached" : "OK"}
        value={j ? `${j.ok} OK` : "No runs recorded yet"}
        detail={j ? `${j.failed} failed, ${j.skipped} skipped, ${j.notReached} not reached; ${ago(j.ranAt, now)}` : "The next cron tick fills this in."} />,
    );
  } else tiles.push(<PanelError key="jobs" name="Jobs in the last tick" error={jobsLastTick} />);

  if (whatsapp.ok) {
    const w = whatsapp.data;
    tiles.push(
      <Tile key="wa" label="WhatsApp" href={`${BASE}?tab=integrations`} tone={w.accounts === 0 ? "idle" : w.withError ? "warn" : "ok"} word={w.accounts === 0 ? "No accounts" : w.withError ? "Errors" : "OK"}
        value={`${w.accounts} account${w.accounts === 1 ? "" : "s"}`} detail={`${w.withError} with an error; last inbound ${ago(w.lastInboundAt, now)}`} />,
    );
  } else tiles.push(<PanelError key="wa" name="WhatsApp" error={whatsapp} />);

  if (freshness.ok) {
    const seen = freshness.data.filter((f) => f.at).length;
    tiles.push(
      <Tile key="fresh" label="Data freshness" tone={seen === 0 ? "idle" : "ok"} word={seen === 0 ? "Not seen" : `${seen} of ${freshness.data.length}`}
        value={freshness.data.find((f) => f.at)?.name ?? "No syncs yet"}
        detail={freshness.data.map((f) => `${f.name} ${f.at ? ago(f.at, now) : "not seen"}`).join("; ")} />,
    );
  } else tiles.push(<PanelError key="fresh" name="Data freshness" error={freshness} />);

  if (audit.ok) {
    const a = audit.data;
    const bad = a.lastStatus === "FAILED" || a.lastStatus === "TIMEOUT";
    tiles.push(
      <Tile key="audit" label="Audit chain" tone={bad ? "bad" : a.lastStatus ? "ok" : "idle"} word={bad ? "Check failed" : a.lastStatus ? "Checked" : "Not run yet"}
        value={a.lastAt ? ago(a.lastAt, now) : "No check recorded"} detail={a.lastStatus ? `Last result: ${a.lastStatus.toLowerCase()}` : "The daily check records its result here."} />,
    );
  } else tiles.push(<PanelError key="audit" name="Audit chain" error={audit} />);

  tiles.push(
    <Tile key="release" label="Release" value={release.sha} detail={`${release.branch ?? "unknown branch"}, ${release.env}${release.tag ? `, ${release.tag}` : ""}`} />,
  );

  return (
    <div className="flex flex-col gap-3">
      {health.tablesMissing && (
        <p role="alert" className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          Control plane tables are not installed: run migrations. The panels that do not need them still work.
        </p>
      )}
      {alerts.ok ? <Alerts alerts={alerts.data} now={now} /> : <PanelError name="Open alerts" error={alerts} />}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">{tiles}</div>
      <Diagnosis />
    </div>
  );
}

/* ---- Jobs --------------------------------------------------------------------------------------------------------------------------- */
const JOB_STATE: Record<JobRow["state"], { tone: Tone; word: string }> = {
  failing: { tone: "bad", word: "Failing" }, late: { tone: "warn", word: "Late" }, "flag-off": { tone: "idle", word: "Flag off" },
  skipped: { tone: "idle", word: "Skipped" }, "not-seen": { tone: "idle", word: "Not seen yet" }, ok: { tone: "ok", word: "OK" },
};

function JobRowView({ job, now }: { job: JobRow; now: Date }) {
  const s = JOB_STATE[job.state];
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 py-2 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:gap-x-4">
      <p className="min-w-0 text-sm">
        <span className="font-medium">{job.label}</span>
        <span className="block truncate text-xs text-muted-foreground">{job.owner} · <span className="font-mono">{job.key}</span></span>
      </p>
      <StatusChip tone={s.tone} word={s.word} className="justify-self-end lg:order-last lg:justify-self-start" />
      {/* Phone: one summary line. Laptop: the columns below. */}
      <p className="col-span-2 text-xs text-muted-foreground lg:hidden">
        {job.lastRunAt ? <>Last {ago(job.lastRunAt, now)}, {duration(job.lastDurationMs)}</> : "No run recorded"} · 24 h {pct(job.rate24h)}
        {job.lastErrorClass && <span className="text-destructive"> · {job.lastErrorClass}{job.consecutiveFailures > 1 ? `, ${job.consecutiveFailures} in a row` : ""}</span>}
      </p>
      <p className="truncate text-xs text-muted-foreground max-lg:hidden">{job.cadence}</p>
      <p className="text-xs max-lg:hidden">
        {job.lastRunAt ? <>Last {ago(job.lastRunAt, now)}, {duration(job.lastDurationMs)}</> : "No run recorded"}
        {job.lastErrorClass && <span className="block text-destructive">{job.lastErrorClass}{job.consecutiveFailures > 1 ? `, ${job.consecutiveFailures} in a row` : ""}</span>}
      </p>
      <p className="text-xs max-lg:hidden">
        <span className="text-muted-foreground">24 h</span> {pct(job.rate24h)} <span className="text-muted-foreground">7 d</span> {pct(job.rate7d)}
      </p>
      <p className="flex items-center gap-2 text-xs text-muted-foreground max-lg:hidden">
        {job.kind === "CRON" ? <>Next {inFuture(job.nextDueAt, now)}</> : "Event driven"}
        <Sparkline values={job.durations} label={`Recent run times, ${job.trend}`} />
        {job.trend !== "steady" && <span>{job.trend}</span>}
      </p>
    </div>
  );
}

export function JobsView({ jobs, now }: { jobs: JobsData; now: Date }) {
  const head = (
    <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-x-4 border-b border-border pb-1 text-xs font-medium text-muted-foreground lg:grid" aria-hidden>
      <span>Job</span><span>Schedule</span><span>Last run</span><span>Success</span><span>Next due and trend</span><span className="w-20">State</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      {!jobs.tablesSeen && <p className="rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground">No runs recorded yet. The next cron tick (due within 5 minutes) fills this in. Every registered job is listed below as not seen yet.</p>}
      <section aria-label="Scheduled jobs" className="rounded-xl border border-border bg-card px-3 py-2">
        <h3 className="text-sm font-medium">Scheduled jobs <span className="font-normal text-muted-foreground">({jobs.cron.length})</span></h3>
        {head}
        <ShowFirst name="jobs" title="Scheduled jobs" items={jobs.cron.map((j) => <JobRowView key={j.key} job={j} now={now} />)} limit={5} as="div" flush noun="jobs" />
      </section>
      <section aria-label="Inbound webhooks" className="rounded-xl border border-border bg-card px-3 py-2">
        <h3 className="text-sm font-medium">Inbound webhooks and ingest routes <span className="font-normal text-muted-foreground">({jobs.webhooks.length})</span></h3>
        <ShowFirst name="hooks" title="Inbound webhooks" items={jobs.webhooks.map((j) => <JobRowView key={j.key} job={j} now={now} />)} limit={3} as="div" flush noun="routes" />
      </section>
    </div>
  );
}

/* ---- Failures ----------------------------------------------------------------------------------------------------------------------- */
const RISK: Record<DataRisk, { tone: Tone; word: string }> = {
  none: { tone: "ok", word: "not lost" }, unknown: { tone: "idle", word: "cannot be told here" }, "at-risk": { tone: "warn", word: "may be lost" },
};

function FailureRow({ g, now }: { g: FailureGroup; now: Date }) {
  const risk = RISK[g.dataRisk];
  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 text-sm">
          <StatusChip tone={g.stillFailing ? "bad" : "ok"} word={g.dead ? "Needs a person" : g.stillFailing ? "Still failing" : "Recovered"} className="mr-2" />
          <span className="font-medium">{g.label}</span>
          <span className="block text-xs text-muted-foreground"><span className="font-mono">{g.errorClass}</span> · {g.count} {g.count === 1 ? "failure" : "failures"} · first {ago(g.firstSeen, now)}, last {ago(g.lastSeen, now)}</span>
        </p>
        <div className="flex items-center gap-2">
          {g.retry?.kind === "job" && <RetryJobButton runId={g.retry.targetIds[0]} label={g.label} />}
          {g.retry?.kind === "lead-intake" && <RetryLeadsButton ids={g.retry.targetIds} label={g.label} />}
          {g.link && <Link href={g.link.href} className="text-xs underline-offset-2 hover:underline">{g.link.label}</Link>}
        </div>
      </div>
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span>Customer data:</span><StatusChip tone={risk.tone} word={risk.word} /><span>{g.dataNote}</span>
      </p>
    </div>
  );
}

export function FailuresView({ groups, now }: { groups: FailureGroup[]; now: Date }) {
  if (groups.length === 0) {
    return <p className="rounded-xl border border-border px-3 py-4 text-sm text-muted-foreground"><StatusChip tone="ok" word="OK" className="mr-2" />No failures in the last 7 days.</p>;
  }
  return (
    <section aria-label="Failures" className="rounded-xl border border-border bg-card px-3 py-1">
      <ShowFirst name="failures" title="Failures" items={groups.map((g) => <FailureRow key={g.key} g={g} now={now} />)} limit={5} as="div" flush noun="failure groups" />
    </section>
  );
}

/* ---- Integrations ------------------------------------------------------------------------------------------------------------------- */
const INTEGRATION_STATE: Record<IntegrationRow["state"], { tone: Tone; word: string }> = {
  HEALTHY: { tone: "ok", word: "Working" }, DEGRADED: { tone: "warn", word: "Needs a look" }, DOWN: { tone: "bad", word: "Down" }, UNTESTED: { tone: "idle", word: "Not tested" },
  MOCK: { tone: "idle", word: "Mock" }, FLAG_OFF: { tone: "idle", word: "Flag off" }, NOT_CONFIGURED: { tone: "warn", word: "Needs setup" }, DISABLED: { tone: "idle", word: "Switched off" },
};

/** Only a live integration has a success or an error worth showing: a mock or switched-off one makes no real calls. */
const LIVE = new Set<IntegrationRow["state"]>(["HEALTHY", "DEGRADED", "DOWN", "UNTESTED"]);

function IntegrationRowView({ r, now }: { r: IntegrationRow; now: Date }) {
  const s = INTEGRATION_STATE[r.state];
  return (
    <div className="flex flex-col gap-0.5 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm"><StatusChip tone={s.tone} word={s.word} className="mr-2" /><span className="font-medium">{r.label}</span></p>
        <Link href={r.settingsHref} className="text-xs underline-offset-2 hover:underline">Settings</Link>
      </div>
      <p className="text-xs text-muted-foreground">{r.reason}{r.note ? `. ${r.note}` : ""}</p>
      {LIVE.has(r.state) && (
        <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          <span>Last success {ago(r.lastSuccessAt, now)}</span>
          <span>Last error {r.lastErrorAt ? `${ago(r.lastErrorAt, now)}${r.lastErrorClass ? ` (${r.lastErrorClass})` : ""}` : "none"}</span>
          {r.issue && <Badge variant="warning">{r.issue === "rate-limit" ? "Rate limited" : "Sign-in problem"}</Badge>}
          {r.feeds.length > 0 && <span>Fed by {r.feeds.map((f, i) => <span key={f.job}>{i ? ", " : ""}<Link href={`${BASE}?tab=jobs`} className="underline-offset-2 hover:underline">{f.label}</Link></span>)}</span>}
        </p>
      )}
    </div>
  );
}

export function IntegrationsView({ rows, now }: { rows: IntegrationRow[]; now: Date }) {
  return (
    <section aria-label="Integrations" className="rounded-xl border border-border bg-card px-3 py-1">
      <ShowFirst name="integrations" title="Integrations" items={rows.map((r) => <IntegrationRowView key={r.key} r={r} now={now} />)} limit={5} as="div" flush noun="integrations" />
    </section>
  );
}
