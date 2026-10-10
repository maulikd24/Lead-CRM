import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { AdChannel } from "@/lib/marketing/channels";
import type { DateRange } from "@/lib/marketing/view-model";
import { workspaceHref, type TabKey } from "@/lib/marketing/workspace-params";

const PRESETS = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
] as const;

/** Presets are plain links and the custom range is a plain GET form in a disclosure, so it all works without client JavaScript. */
export function RangeControl({ range, today, tab, channel }: { range: DateRange; today: string; tab: TabKey; channel: AdChannel | "all" }) {
  const input = "h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Date range presets" className="flex gap-1">
        {PRESETS.map((p) => (
          <Button key={p.key} size="sm" variant={range.preset === p.key ? "default" : "outline"} aria-current={range.preset === p.key ? "true" : undefined} render={<Link href={workspaceHref({ tab, channel, range: { from: range.from, to: range.to, preset: p.key } })} scroll={false} />}>
            {p.label}
          </Button>
        ))}
      </nav>
      <details className="group relative" open={range.preset === "custom" ? true : undefined}>
        <summary className="flex h-8 cursor-pointer list-none items-center rounded-md border border-border px-2.5 text-[0.8rem] font-semibold text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          {range.preset === "custom" ? `${range.from} to ${range.to}` : "Custom dates"}
        </summary>
        <form method="get" action="/marketing" aria-label="Custom date range" className="absolute right-0 z-30 mt-1 flex w-72 flex-col gap-2 rounded-lg border bg-popover p-3 shadow-lg">
          {tab !== "overview" && <input type="hidden" name="tab" value={tab} />}
          {channel !== "all" && <input type="hidden" name="channel" value={channel} />}
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            From
            <input type="date" name="from" defaultValue={range.from} max={today} required className={input} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            To
            <input type="date" name="to" defaultValue={range.to} max={today} required className={input} />
          </label>
          <Button type="submit" size="sm">Apply</Button>
          <p className="text-xs text-muted-foreground">Up to 90 days. Days are counted in the ad account&apos;s timezone.</p>
        </form>
      </details>
    </div>
  );
}
