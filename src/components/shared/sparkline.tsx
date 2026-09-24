import { cn } from "@/lib/utils";

/** Plain-div bar sparkline — no charting library, matching the Harbor reference's own approach. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className={cn("flex h-8 items-end gap-1", className)}>
      {values.map((v, i) => (
        <div
          key={i}
          className="w-1.5 rounded-sm bg-background/25"
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}
