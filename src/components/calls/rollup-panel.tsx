import "./calls.css";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FLAG_LABEL, scoreBand, type Rollup } from "@/lib/calls/view-model";
import { cn } from "@/lib/utils";
import { CountUp } from "./count-up";

const BAR: Record<"low" | "mid" | "high", string> = { low: "bg-destructive", mid: "bg-warning", high: "bg-success" };

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-heading text-3xl font-semibold">{children}</dd>
    </div>
  );
}

/** Manager rollup: how the calls in the current view scored, by RM, and which flags come up most. */
export function RollupPanel({ rollup }: { rollup: Rollup }) {
  const maxFlag = Math.max(1, ...rollup.topFlags.map((f) => f.count));
  return (
    <section aria-label="Team rollup" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>This view</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-5">
            <Stat label="Calls">
              <CountUp value={rollup.totalCalls} />
            </Stat>
            <Stat label="Average score">{rollup.averageScore === null ? "–" : <CountUp value={rollup.averageScore} />}</Stat>
            <Stat label="Scored">
              <CountUp value={rollup.scoredCalls} />
            </Stat>
            <Stat label="Reviewed">
              <CountUp value={rollup.reviewedCalls} />
            </Stat>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Average score by RM</CardTitle>
        </CardHeader>
        <CardContent>
          {rollup.byRm.length === 0 ? (
            <p className="text-sm text-muted-foreground">No calls in this view.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {rollup.byRm.slice(0, 8).map((rm, i) => {
                const band = scoreBand(rm.average);
                return (
                  <li key={rm.rmId ?? "none"} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 text-sm">
                    <span className="truncate">{rm.rmName}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-muted" role="presentation">
                      <span className={cn("calls-bar block h-full rounded-full", band ? BAR[band] : "bg-muted")} style={{ width: `${rm.average ?? 0}%`, "--i": i } as React.CSSProperties} />
                    </span>
                    <span className="w-24 text-right text-xs text-muted-foreground">
                      <span className="font-heading text-sm font-semibold text-foreground tabular-nums">{rm.average ?? "–"}</span> · {rm.calls} {rm.calls === 1 ? "call" : "calls"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top flags</CardTitle>
        </CardHeader>
        <CardContent>
          {rollup.topFlags.length === 0 ? (
            <p className="text-sm text-muted-foreground">No flags in this view.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {rollup.topFlags.map((f, i) => (
                <li key={f.kind} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
                  <span className="truncate">{FLAG_LABEL[f.kind]}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-muted" role="presentation">
                    <span className="calls-bar block h-full rounded-full bg-warning" style={{ width: `${(f.count / maxFlag) * 100}%`, "--i": i } as React.CSSProperties} />
                  </span>
                  <span className="font-heading font-semibold tabular-nums">
                    <CountUp value={f.count} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
