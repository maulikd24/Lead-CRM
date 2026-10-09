"use client";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatCount, formatMoney, formatPercent, formatRatio } from "@/lib/marketing/view-model";

import styles from "./marketing.module.css";
import { useCountUp } from "./use-count-up";

export type KpiKind = "money" | "count" | "percent" | "ratio";
export type Kpi = {
  key: string;
  label: string;
  value: number | null;
  kind: KpiKind;
  /** One short line under the number, e.g. what the number is divided by. */
  hint: string;
  tone?: "default" | "success" | "warning";
};

function format(kind: KpiKind, value: number | null, currency: string | null): string {
  if (kind === "money") return formatMoney(value, currency);
  if (kind === "percent") return formatPercent(value);
  if (kind === "ratio") return formatRatio(value);
  return formatCount(value);
}

function Tile({ kpi, index, currency }: { kpi: Kpi; index: number; currency: string | null }) {
  const shown = useCountUp(kpi.value);
  const final = format(kpi.kind, kpi.value, currency);
  return (
    <Card size="sm" className={styles.enter} style={{ ["--i" as string]: index }}>
      <CardContent className="flex flex-col gap-1.5 px-4">
        <p className="text-xs text-muted-foreground">{kpi.label}</p>
        {/* The animated number is decorative; assistive tech reads the final value once. */}
        <p aria-hidden className={cn("font-heading text-2xl font-semibold tabular-nums tracking-tight", kpi.tone === "success" && "text-success", kpi.tone === "warning" && "text-warning")}>
          {format(kpi.kind, shown, currency)}
        </p>
        <span className="sr-only">{`${kpi.label}: ${final}`}</span>
        <p className="text-xs text-muted-foreground">{kpi.hint}</p>
      </CardContent>
    </Card>
  );
}

export function KpiTiles({ kpis, currency }: { kpis: Kpi[]; currency: string | null }) {
  return (
    <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {kpis.map((kpi, i) => (
        <Tile key={kpi.key} kpi={kpi} index={i} currency={currency} />
      ))}
    </section>
  );
}
