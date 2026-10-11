import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { PhoneSheet, ShowFirst } from "@/components/workspace";
import type { DataHealthData, DataHealthItemView } from "@/lib/data-health/read-db";
import type { Severity } from "@/lib/data-health/model";
import type { Tone } from "@/lib/system/control-plane-model";
import { AcknowledgeItemButton, RetryDeadLetterButton, RunChecksButton } from "./data-health-controls";
import { StatusChip, Tile, ago } from "./control-plane-view";

const SEVERITY: Record<Severity, { tone: Tone; word: string }> = { HIGH: { tone: "bad", word: "High" }, WARN: { tone: "warn", word: "Warning" }, INFO: { tone: "idle", word: "Info" } };

const readable = (detail: DataHealthItemView["detail"]) =>
  Object.entries(detail).filter(([k]) => k !== "code").map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()} ${v}`).join(" · ");

function lag(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

function ItemRow({ item, now }: { item: DataHealthItemView; now: Date }) {
  const s = SEVERITY[item.severity];
  const acked = item.status === "ACKNOWLEDGED";
  const subject = item.clientId && item.clientCode ? <Link href={`/clients/${item.clientId}`} className="font-mono underline-offset-2 hover:underline">{item.clientCode}</Link> : <span className="font-mono">{item.subjectType === "event" ? "event" : item.subjectId}</span>;
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2">
      <p className="min-w-0 text-sm">
        <StatusChip tone={s.tone} word={s.word} className="mr-2" />
        <span className="font-medium">{item.title}</span>
        {acked && <Badge variant="outline" className="ml-2">Acknowledged</Badge>}
        <span className="block text-xs text-muted-foreground">{subject}{readable(item.detail) ? ` · ${readable(item.detail)}` : ""} · first seen {ago(item.firstSeenAt, now)}</span>
      </p>
      {!acked && <AcknowledgeItemButton itemId={item.id} label={item.title} />}
    </div>
  );
}

export function DataHealthView({ data, now }: { data: DataHealthData; now: Date }) {
  const open = data.summary.high + data.summary.warn + data.summary.info;
  const worst: Tone = data.summary.high > 0 ? "bad" : data.summary.warn > 0 ? "warn" : open > 0 ? "idle" : "ok";
  const checks = data.checks.filter((c) => c.open + c.acknowledged > 0);
  return (
    <div className="flex flex-col gap-3">
      {!data.enabled && (
        <p role="status" className="rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground">
          Customer events are off (CUSTOMER_EVENTS_ENABLED). The checks and the event consumers do not run; anything listed below is from the last time they did.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile label="Open work items" tone={worst} word={open === 0 ? "All clear" : data.summary.high > 0 ? "High" : data.summary.warn > 0 ? "Warning" : "Info"} value={open}
          detail={`${data.summary.high} high, ${data.summary.warn} warning, ${data.summary.info} info${data.summary.acknowledged ? `; ${data.summary.acknowledged} acknowledged` : ""}`} />
        <Tile label="Last checked" tone={data.lastRunAt ? "ok" : "idle"} word={data.lastRunAt ? "Ran" : "Not yet"} value={data.lastRunAt ? ago(data.lastRunAt, now) : "Never"} detail="The sweep runs hourly with the cron tick." />
        <Tile label="Event consumers" tone={data.consumers.some((c) => c.lagSeconds > 900) ? "warn" : data.consumers.some((c) => c.lastRunAt) ? "ok" : "idle"} word={data.consumers.some((c) => c.lagSeconds > 900) ? "Lagging" : data.consumers.some((c) => c.lastRunAt) ? "Keeping up" : "Not run yet"}
          value={`lag ${lag(Math.max(0, ...data.consumers.map((c) => c.lagSeconds)))}`} detail={`${data.consumers.reduce((n, c) => n + c.pending, 0)} events waiting across ${data.consumers.length} consumers`} />
        <Tile label="Dead letters and failed emits" tone={data.deadLetters.length || data.emitFailuresOpen ? "warn" : "ok"} word={data.deadLetters.length || data.emitFailuresOpen ? "Needs a look" : "None"}
          value={`${data.deadLetters.length} + ${data.emitFailuresOpen}`} detail="Events a consumer gave up on, and events that could not be stored." />
      </div>
      <div className="flex justify-end"><RunChecksButton /></div>

      {checks.length > 0 && (
        <PhoneSheet name="dh-checks" title="By check" summary={`${checks.length} checks with findings`}>
          <section aria-label="Findings by check" className="rounded-xl border border-border bg-card px-3 py-2">
            <h3 className="text-sm font-medium">By check</h3>
            <ul className="divide-y divide-border text-sm">
              {checks.map((c) => (
                <li key={c.key} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                  <span className="min-w-0"><StatusChip tone={SEVERITY[c.severity].tone} word={SEVERITY[c.severity].word} className="mr-2" />{c.title}
                    <span className="block text-xs text-muted-foreground">{c.fix}</span></span>
                  <span className="tabular-nums text-sm">{c.open}{c.acknowledged ? <span className="text-xs text-muted-foreground"> (+{c.acknowledged} ack.)</span> : null}</span>
                </li>
              ))}
            </ul>
          </section>
        </PhoneSheet>
      )}

      <section aria-label="Work items" className="rounded-xl border border-border bg-card px-3 py-1">
        {data.items.length === 0
          ? <p className="py-3 text-sm text-muted-foreground"><StatusChip tone="ok" word="OK" className="mr-2" />No open data-health work items.</p>
          : <ShowFirst name="dh-items" title="Work items" items={data.items.map((i) => <ItemRow key={i.id} item={i} now={now} />)} limit={5} as="div" flush noun="work items" />}
      </section>

      {data.deadLetters.length > 0 && (
        <section aria-label="Dead-lettered events" className="rounded-xl border border-border bg-card px-3 py-1">
          <h3 className="pt-2 text-sm font-medium">Dead-lettered events</h3>
          <ShowFirst name="dh-dead" title="Dead-lettered events" limit={3} as="div" flush noun="dead letters" items={data.deadLetters.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <p className="min-w-0 text-sm"><span className="font-medium">{d.eventType}</span>
                <span className="block text-xs text-muted-foreground">{d.consumer} · {d.attempts} attempts · <span className="font-mono">{d.errorClass ?? "Error"}</span> · {ago(d.lastFailedAt, now)}</span></p>
              <RetryDeadLetterButton id={d.id} label={`${d.eventType} for ${d.consumer}`} />
            </div>
          ))} />
        </section>
      )}
    </div>
  );
}
