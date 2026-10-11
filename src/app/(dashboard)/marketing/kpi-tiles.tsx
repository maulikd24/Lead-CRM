import { Coins, IndianRupee, Percent, TrendingUp, UserCheck, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { KpiStrip } from "@/components/workspace";
import { KpiCard } from "@/components/wow";
import { computeDelta, splitHalves } from "@/components/wow/wow-logic";
import type { BlendedDay } from "@/lib/marketing/blend";

import { formatCount, formatMoney, formatPercent, formatRatio } from "@/lib/marketing/view-model";

import { AnimatedNumber, type NumberKind } from "./animated-number";

/** The figure as text, only to tell whether it is long enough to need the smaller type (the client component does the real formatting). */
const asText = (kind: NumberKind, value: number | null, currency: string | null) => (kind === "money" ? formatMoney(value, currency) : kind === "percent" ? formatPercent(value) : kind === "ratio" ? formatRatio(value) : formatCount(value));

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

const ICON: Record<string, LucideIcon> = { spend: IndianRupee, leads: Users, cpl: Coins, funded: UserCheck, revenue: TrendingUp, roas: Percent };

/** Which daily series (from the blended report) backs a figure. Revenue and ratios have no stored daily history, so they show no trend. */
function seriesFor(key: string, daily: BlendedDay[]): { values: number[]; goodWhen: "up" | "down" | "neutral" } | null {
  if (key === "spend") return { values: daily.map((d) => d.spend), goodWhen: "neutral" };
  if (key === "leads") return { values: daily.map((d) => d.crmLeads), goodWhen: "up" };
  if (key === "funded") return { values: daily.map((d) => d.funded), goodWhen: "up" };
  return null;
}

/** Later half of the range against the earlier half for cost per lead: spend over leads in each half. */
function cplDelta(daily: BlendedDay[]) {
  const spend = splitHalves(daily.map((d) => d.spend));
  const leads = splitHalves(daily.map((d) => d.crmLeads));
  if (!spend || !leads || leads.current === 0 || leads.previous === 0) return null;
  return computeDelta(spend.current / leads.current, spend.previous / leads.previous);
}

export function KpiTiles({ kpis, currency, daily = [] }: { kpis: Kpi[]; currency: string | null; daily?: BlendedDay[] }) {
  return (
    <KpiStrip label="Key numbers">
      {kpis.map((kpi, i) => {
        const s = seriesFor(kpi.key, daily);
        const halves = s ? splitHalves(s.values) : null;
        const delta = kpi.key === "cpl" ? cplDelta(daily) : halves ? computeDelta(halves.current, halves.previous) : null;
        const goodWhen = kpi.key === "cpl" ? "down" : (s?.goodWhen ?? "up");
        return (
          <KpiCard
            key={kpi.key}
            label={kpi.label}
            icon={ICON[kpi.key]}
            index={i}
            tone={kpi.tone ?? "default"}
            hint={kpi.hint}
            dense={asText(kpi.kind, kpi.value, currency).length > 8}
            valueNode={<AnimatedNumber value={kpi.value} kind={kpi.kind} currency={currency} label={kpi.label} />}
            series={s?.values}
            seriesLabel={s ? `${kpi.label} per day across the range` : undefined}
            delta={delta}
            deltaLabel="vs earlier half"
            goodWhen={goodWhen}
          />
        );
      })}
    </KpiStrip>
  );
}
