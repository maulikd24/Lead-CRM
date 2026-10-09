"use client";

import { useMemo, useState } from "react";
import { CalendarCheck, IndianRupee, Mail, MessageCircle, MessageSquare, Phone, Sparkles, StickyNote, Workflow } from "lucide-react";

import { FILTERS, filterTimeline, formatClock, groupByDay, isFresh, type FilterKey, type TimelineChannel, type TimelineEvent } from "@/lib/c360/timeline";
import { cn } from "@/lib/utils";

const ICONS: Record<TimelineChannel, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  whatsapp: MessageCircle,
  sms: MessageSquare,
  message: MessageSquare,
  email: Mail,
  meeting: CalendarCheck,
  note: StickyNote,
  system: Workflow,
  ai: Sparkles,
  money: IndianRupee,
};
const CHANNEL_LABEL: Record<TimelineChannel, string> = { call: "Call", whatsapp: "WhatsApp", sms: "SMS", message: "Message", email: "Email", meeting: "Meeting", note: "Note", system: "System", ai: "AI", money: "Transaction" };
const PAGE = 40;

/** Filterable, day-grouped timeline. Receives plain serialisable events and a fixed `nowIso` (so server and client agree). */
export function TimelineView({ events, nowIso }: { events: TimelineEvent[]; nowIso: string }) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [limit, setLimit] = useState(PAGE);
  const now = useMemo(() => new Date(nowIso), [nowIso]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, filterTimeline(events, f.key).length])) as Record<FilterKey, number>, [events]);
  const visible = useMemo(() => filterTimeline(events, filter).slice(0, limit), [events, filter, limit]);
  const groups = useMemo(() => groupByDay(visible, now), [visible, now]);
  const total = counts[filter];

  return (
    <div>
      <div role="group" aria-label="Filter timeline" className="mb-5 flex flex-wrap gap-1.5">
        {FILTERS.filter((f) => f.key === "all" || counts[f.key] > 0).map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => {
              setFilter(f.key);
              setLimit(PAGE);
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              filter === f.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label} <span className="tabular-nums opacity-70">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {events.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No activity yet. Calls, messages, notes and outcomes will appear here as they happen.</p>
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nothing matches this filter.</p>
      ) : (
        <div className="grid gap-6" aria-live="polite">
          {groups.map((group) => (
            <section key={group.key} aria-label={group.label}>
              <h3 className="mb-3 font-heading text-xs font-medium tracking-wide text-muted-foreground uppercase">{group.label}</h3>
              <ol className="relative grid gap-4 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-px before:bg-border">
                {group.events.map((e, i) => {
                  const Icon = ICONS[e.channel];
                  const fresh = isFresh(e.at, now);
                  return (
                    <li key={e.id} className="c360-rise relative flex gap-3" style={{ "--i": i } as React.CSSProperties}>
                      <span
                        className={cn(
                          "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border bg-card",
                          fresh && "c360-pulse border-primary",
                          e.tone === "positive" && !fresh && "border-success/50",
                          e.tone === "warning" && "border-warning/60",
                          e.tone === "negative" && "border-destructive/50",
                        )}
                      >
                        <Icon className={cn("size-4", fresh ? "text-primary" : "text-muted-foreground")} />
                        <span className="sr-only">{CHANNEL_LABEL[e.channel]}</span>
                      </span>
                      <div className="min-w-0 flex-1 pb-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <p className="text-sm font-medium">{e.title}</p>
                          {fresh && <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-foreground">New</span>}
                          <span className="ml-auto text-xs tabular-nums text-muted-foreground">{formatClock(e.at)}</span>
                        </div>
                        {e.detail && <p className="mt-0.5 text-sm break-words text-muted-foreground">{e.detail}</p>}
                        {e.actor && <p className="mt-0.5 text-xs text-muted-foreground">by {e.actor}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          {total > limit && (
            <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="mx-auto rounded-full border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              Show {Math.min(PAGE, total - limit)} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
