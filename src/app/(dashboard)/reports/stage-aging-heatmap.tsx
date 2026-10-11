import { Fragment } from "react";

import { ScrollRegion } from "@/components/ui/scroll-region";
import { AGING_BUCKETS, type StageAgingRow, type AgingBucket } from "@/lib/reports/stage-aging";

const BUCKET_COLOR: Record<AgingBucket, string> = {
  "0-24h": "var(--chart-2)",
  "24-48h": "var(--chart-4)",
  "48-72h": "var(--chart-3)",
  "72h+": "var(--destructive)",
};

function cellStyle(bucket: AgingBucket, count: number, maxInRow: number) {
  // The shade is a layer of its own, so the count keeps full strength. --heat-scale (globals.css) keeps the dark theme's strongest
  // shades dark enough for the light count to stay at 4.5:1.
  if (count === 0) return { backgroundColor: "var(--muted)", opacity: 0.4 };
  const intensity = maxInRow > 0 ? Math.min(1, 0.35 + (count / maxInRow) * 0.65) : 0.35;
  return { backgroundColor: BUCKET_COLOR[bucket], opacity: `calc(${intensity} * var(--heat-scale, 1))` };
}

export function StageAgingHeatmap({ rows }: { rows: StageAgingRow[] }) {
  if (rows.length === 0 || rows.every((r) => r.total === 0)) {
    return <p className="text-sm text-muted-foreground py-6 text-center">No active clients right now.</p>;
  }

  return (
    <ScrollRegion>
      <div className="grid gap-1" style={{ gridTemplateColumns: `minmax(140px, 1fr) repeat(${AGING_BUCKETS.length}, 90px)` }}>
        <div />
        {AGING_BUCKETS.map((bucket) => (
          <div key={bucket} className="text-xs text-muted-foreground text-center pb-1 font-medium">
            {bucket}
          </div>
        ))}

        {rows.map((row) => {
          const maxInRow = Math.max(...AGING_BUCKETS.map((b) => row.buckets[b]));
          return (
            <Fragment key={row.stageId}>
              <div className="text-sm flex items-center">{row.stageName}</div>
              {AGING_BUCKETS.map((bucket) => (
                <div
                  key={`${row.stageId}-${bucket}`}
                  className="relative flex items-center justify-center rounded text-sm font-medium h-10 text-foreground"
                >
                  <span aria-hidden className="absolute inset-0 rounded" style={cellStyle(bucket, row.buckets[bucket], maxInRow)} />
                  <span className="relative">{row.buckets[bucket] > 0 ? row.buckets[bucket] : ""}</span>
                </div>
              ))}
            </Fragment>
          );
        })}
      </div>
    </ScrollRegion>
  );
}
