import { ChartCard } from "@/components/wow/chart-card";
import type { Delta } from "@/components/wow/wow-logic";
import type { buildOverviewVM } from "@/lib/partners/view-models";

type Chart = ReturnType<typeof buildOverviewVM>["chart"];

/**
 * Earnings by month as the shared chart card: soft area, dotted grid, hover or keyboard crosshair with the month's figure, and (when
 * the source reports it) a toggle to new referred users. The last point can be a month still in progress; the card says so.
 */
export function EarningsChartCard({ chart, title = "Earnings by month", delta }: { chart: Chart; title?: string; delta?: Delta | null }) {
  const { points } = chart;
  if (points.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No monthly figures yet.</p>;
  const referees = points.map((p) => p.referees);
  const hasReferees = referees.every((r): r is number => typeof r === "number");
  return (
    <ChartCard
      title={title}
      description={`${points[0].label} to ${points[points.length - 1].label}`}
      labels={points.map((p) => p.label)}
      series={[
        { key: "earnings", label: "Earnings", values: points.map((p) => p.earnings), format: { kind: "inr" }, ...(delta !== undefined ? { delta } : {}) },
        ...(hasReferees ? [{ key: "referred", label: "New referred", values: referees as number[], format: { kind: "count" as const } }] : []),
      ]}
      deltaLabel="last month vs month before"
      footer="The latest month may still be in progress."
      height={210}
    />
  );
}
