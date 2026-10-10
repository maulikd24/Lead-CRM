"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { m } from "motion/react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CountUp } from "@/components/motion/count-up";
import { Pulse, PulseRing } from "@/components/motion/pulse";
import { useMounted } from "@/components/motion/use-mounted";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";
import { DURATION, EASE, FUNNEL_STEP } from "@/components/motion/tokens";
import { formatNumber } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { buildFunnelStages, risenStages, type FunnelTotals } from "@/lib/dashboard/live-funnel";
import { useLiveCounts } from "./use-live-counts";

type Props = { initial: FunnelTotals; lifecycle: Record<string, number>; scopeLabel: string; className?: string };

export function LiveFunnel({ initial, lifecycle, scopeLabel, className }: Props) {
  const reduced = useReducedMotion();
  const mounted = useMounted();
  const animate = mounted && !reduced;
  const uid = useId();
  const router = useRouter();
  const [totals, setTotals] = useState(initial);
  const [pulses, setPulses] = useState<Record<string, number>>({});
  const [announce, setAnnounce] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const stages = useMemo(() => buildFunnelStages(totals, lifecycle), [totals, lifecycle]);

  const status = useLiveCounts((data) => {
    const risen = risenStages(totals, data.totals);
    setTotals(data.totals);
    if (risen.length === 0) return;
    setPulses((p) => ({ ...p, ...Object.fromEntries(risen.map((k) => [k, (p[k] ?? 0) + 1])) }));
    if (risen.includes("leads")) setAnnounce(`${data.totals.leads - totals.leads} new ${data.totals.leads - totals.leads === 1 ? "lead" : "leads"}`);
    else if (risen.includes("funded")) setAnnounce("A customer was just funded");
    if (risen.includes("funded")) router.refresh(); // pulls the celebration data for the new customer
  });

  const detail = active !== null ? stages[active] : null;
  const describe = (st: (typeof stages)[number]) => `${formatNumber(st.count)} customers, ${st.share}% of all leads${st.conversion !== null ? `, ${st.conversion}% reached from the previous stage` : ""}.`;

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>Live funnel</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">{scopeLabel}</p>
        </div>
        <Pulse status={status} label={status === "live" ? "Live" : status === "paused" ? "Paused" : "Reconnecting"} />
      </CardHeader>
      <CardContent>
        <p role="status" aria-live="polite" className="sr-only">
          {announce}
        </p>
        {totals.leads === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No leads in your view yet. New leads will appear here as they arrive.</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {stages.map((stage, i) => (
              <li key={stage.key} className="flex flex-col">
                {stage.conversion !== null && (
                  <m.p
                    key={animate ? "a" : "s"}
                    className="ml-1 flex items-center gap-1.5 py-0.5 text-[11px] text-muted-foreground"
                    initial={animate ? { opacity: 0, y: -4 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: animate ? DURATION.base : 0, delay: animate ? Math.max(0, i * FUNNEL_STEP - 0.08) : 0 }}
                  >
                    <span aria-hidden="true">↓</span>
                    <span className="tabular-nums">
                      <CountUp value={stage.conversion} format="percent" delay={i * FUNNEL_STEP} /> reach next stage
                    </span>
                  </m.p>
                )}
                <PulseRing trigger={pulses[stage.key] ?? 0} className="rounded-lg">
                  <div
                    tabIndex={0}
                    role="group"
                    aria-label={`${stage.label}: ${formatNumber(stage.count)}`}
                    aria-describedby={`${uid}-${stage.key}`}
                    onMouseEnter={() => setActive(i)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    className={cn("rounded-lg px-2 py-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", active === i && "bg-muted/60")}
                  >
                    <p id={`${uid}-${stage.key}`} className="sr-only">
                      {describe(stage)}
                    </p>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm text-muted-foreground">{stage.label}</span>
                      <span className="font-heading text-xl font-semibold">
                        <CountUp value={stage.count} delay={i * FUNNEL_STEP} />
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <m.div
                        key={animate ? "a" : "s"}
                        className="funnel-fill h-full origin-left rounded-full bg-primary"
                        initial={animate ? { width: 0 } : false}
                        animate={{ width: `${Math.max(stage.share, stage.count > 0 ? 2 : 0)}%` }}
                        transition={{ duration: animate ? DURATION.slow : 0, delay: animate ? i * FUNNEL_STEP : 0, ease: EASE.out as unknown as [number, number, number, number] }}
                      />
                    </div>
                  </div>
                </PulseRing>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 min-h-4 text-xs text-muted-foreground">{detail ? describe(detail) : "Hover or focus a stage for details."}</p>
      </CardContent>
    </Card>
  );
}
