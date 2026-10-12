import { cn } from "@/lib/utils";
import type { PeriodDelta } from "@/lib/reports/period-comparison";

const TONE: Record<PeriodDelta["tone"], string> = {
  good: "text-success",
  bad: "text-destructive",
  flat: "text-muted-foreground",
};

/** "▲ 12% vs prev." under a KPI, naming the exact period compared with on hover. Renders nothing when there's nothing to compare. */
export function PeriodDeltaHint({ delta, against }: { delta: PeriodDelta | null; against: string }) {
  if (!delta) return null;
  return (
    <span title={`Compared with ${against}`}>
      <span className={cn("font-medium", TONE[delta.tone])}>{delta.text}</span> vs prev.
      <span className="sr-only"> (compared with {against})</span>
    </span>
  );
}
