import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CountUp, motion } from "@/components/workspace";
import { STATIC_COPY } from "@/lib/outcomes/copy";
import type { OutcomesViewModel } from "@/lib/outcomes/view-model";
import { cn } from "@/lib/utils";

import { WhyTooltip } from "./why-tooltip";

const BAND_VARIANT = { high: "warning", medium: "accent", low: "outline" } as const;

/** The attention score with its working shown: a short "why" on hover or focus, and every factor, weight and input listed below. */
export function AttentionScoreCard({ score }: { score: OutcomesViewModel["score"] }) {
  return (
    <Card className={cn(motion.enter)} style={{ ["--i" as string]: 0 }}>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <CardTitle className="text-base">{STATIC_COPY.riskTitle}</CardTitle>
        <WhyTooltip id="attention-why" label="Why this score" align="end">
          <p className="mb-1 font-medium">Biggest contributions</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {score.topReasons.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </WhyTooltip>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-end gap-3">
          <span className="font-heading text-4xl font-semibold leading-none">
            <CountUp value={score.value} label="Attention score out of 100" />
          </span>
          <span className="pb-1 text-sm text-muted-foreground">out of 100</span>
          <Badge variant={BAND_VARIANT[score.band]} className="mb-1">
            {score.bandLabel}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{STATIC_COPY.riskNote}</p>
        <details className="group text-sm">
          <summary className="cursor-pointer rounded-sm text-xs font-medium text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">Show the working</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[20rem] text-left text-xs">
              <caption className="sr-only">Each factor in the attention score, its weight, the points it added and what it looked at</caption>
              <thead className="text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1 pr-2 font-medium">Factor</th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">Weight</th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">Points</th>
                  <th scope="col" className="py-1 font-medium">What it looked at</th>
                </tr>
              </thead>
              <tbody>
                {score.factors.map((f) => (
                  <tr key={f.label} className="border-t border-border align-top">
                    <th scope="row" className="py-1.5 pr-2 font-medium">{f.label}</th>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{f.weight}</td>
                    <td className={cn("py-1.5 pr-2 text-right tabular-nums", f.points > 0 && "font-semibold")}>{f.points}</td>
                    <td className="py-1.5 text-muted-foreground">{f.input}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
