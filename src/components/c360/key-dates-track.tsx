"use client";

import type { KeyDates } from "@/lib/c360/key-dates";
import { cn } from "@/lib/utils";

import { useInView } from "./use-motion";

const fmt = (iso: string) => {
  const d = new Date(Date.parse(iso) + 330 * 60_000);
  return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** Signup to first transaction as a vertical progress track; the fill animates to the last completed step. */
export function KeyDatesTrack({ data, staticRender = false }: { data: KeyDates; staticRender?: boolean }) {
  const [ref, inView] = useInView<HTMLOListElement>();
  return (
    <ol ref={ref} data-in={inView ? "true" : "false"} data-static={staticRender ? "true" : undefined} className="relative grid gap-4 pl-7" aria-label="Key dates">
      <span aria-hidden="true" className="absolute top-2 bottom-2 left-[9px] w-0.5 rounded-full bg-border" />
      <span aria-hidden="true" className="c360-vfill absolute top-2 left-[9px] w-0.5 rounded-full bg-primary" style={{ "--h": `calc((100% - 1rem) * ${data.fillPct / 100})` } as React.CSSProperties} />
      {data.steps.map((s) => (
        <li key={s.key} className="relative">
          <span
            aria-hidden="true"
            className={cn("absolute top-1 -left-7 size-[18px] rounded-full border-2", s.state === "done" && "border-primary bg-primary", s.state === "current" && "border-primary bg-card", s.state === "pending" && "border-border bg-card")}
          />
          <p className={cn("text-sm font-medium", s.state === "pending" && "text-muted-foreground")}>
            {s.label}
            <span className="sr-only"> ({s.state === "done" ? "done" : s.state === "current" ? "next" : "pending"})</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {s.date ? fmt(s.date) : s.state === "current" ? (s.waiting ?? "Next step") : "Not yet"}
            {s.elapsed ? ` · ${s.elapsed}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
