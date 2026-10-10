import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { DateRange } from "@/lib/marketing/view-model";

const PRESETS = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
] as const;

/** Presets are plain links and the custom range is a plain GET form, so it works without client JavaScript. */
export function RangeControl({ range, today }: { range: DateRange; today: string }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <nav aria-label="Date range presets" className="flex gap-1">
        {PRESETS.map((p) => (
          <Button key={p.key} size="sm" variant={range.preset === p.key ? "default" : "outline"} aria-current={range.preset === p.key ? "true" : undefined} render={<Link href={`/marketing?range=${p.key}`} />}>
            {p.label}
          </Button>
        ))}
      </nav>
      <form method="get" action="/marketing" className="flex flex-wrap items-end gap-2" aria-label="Custom date range">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From
          <input type="date" name="from" defaultValue={range.from} max={today} required className="native-control h-8" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <input type="date" name="to" defaultValue={range.to} max={today} required className="native-control h-8" />
        </label>
        <Button type="submit" size="sm" variant={range.preset === "custom" ? "default" : "outline"}>Apply</Button>
      </form>
    </div>
  );
}
