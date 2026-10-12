import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { AnimatedNumber, type NumberKind } from "./animated-number";
import { motion } from "@/components/workspace";

export type KpiKind = NumberKind;
export type Kpi = {
  key: string;
  label: string;
  value: number | null;
  kind: KpiKind;
  /** One short line under the number, e.g. what the number is divided by. */
  hint: string;
  tone?: "default" | "success" | "warning";
};

export function KpiTiles({ kpis, currency }: { kpis: Kpi[]; currency: string | null }) {
  return (
    <section aria-label="Key numbers" tabIndex={0} className="flex snap-x gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none] max-lg:-mx-1 max-lg:px-1 lg:grid lg:grid-cols-3 lg:overflow-visible lg:pb-0 xl:grid-cols-6">
      {kpis.map((kpi, i) => (
        <Card key={kpi.key} size="sm" className={cn(motion.enter, motion.lift, "max-lg:w-40 max-lg:shrink-0 max-lg:snap-start")} style={{ ["--i" as string]: i }}>
          <CardContent className="flex flex-col gap-1 px-3.5">
            <p className="text-xs text-muted-foreground">{kpi.label}</p>
            <p className={cn("font-heading text-xl font-semibold tabular-nums tracking-tight", kpi.tone === "success" && "text-success", kpi.tone === "warning" && "text-warning")}>
              <AnimatedNumber value={kpi.value} kind={kpi.kind} currency={currency} label={kpi.label} />
            </p>
            <p className="truncate text-xs text-muted-foreground">{kpi.hint}</p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
