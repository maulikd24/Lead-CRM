"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { RANGE_OPTIONS } from "@/lib/insights/range";
import { cn } from "@/lib/utils";

/** Pure: the links carry the open tab so changing the range keeps you where you were. */
export function RangeControl({ days, tab }: { days: number; tab?: string | null }) {
  return (
    <nav aria-label="Date range" className="inline-flex rounded-lg border border-border p-0.5">
      {RANGE_OPTIONS.map((o) => (
        <Link
          key={o.days}
          href={`/agents/insights?days=${o.days}${tab ? `&tab=${encodeURIComponent(tab)}` : ""}`}
          aria-current={o.days === days ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            o.days === days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}

/** The same control reading the open tab from the URL (`?tab=`), which tab clicks keep current. */
export function LiveRangeControl({ days }: { days: number }) {
  return <RangeControl days={days} tab={useSearchParams().get("tab")} />;
}
