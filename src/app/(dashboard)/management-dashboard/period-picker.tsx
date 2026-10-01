"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { shiftPeriod, type PeriodGranularity } from "@/lib/reports/period-range";

const GRANULARITY_OPTIONS: { label: string; value: PeriodGranularity }[] = [
  { label: "Daily", value: "day" },
  { label: "Weekly", value: "week" },
  { label: "Monthly", value: "month" },
  { label: "Quarterly", value: "quarter" },
];

/** Page-wide calendar period control for the Manager Dashboard — distinct from the generic
 * SegmentedControl (dashboard/components/segmented-control.tsx), which is a single-param
 * Today/Week/Quarter selector with no Prev/Next/anchor concept. This drives `?period=`/`?anchor=`,
 * which every section on the page (KPIs, Pipeline View, Leads Activity, the merged performance
 * table) reads server-side via `parseManagementPeriodParams`. */
export function PeriodPicker({
  granularity,
  anchor,
  label,
  canGoNext,
  isCustom,
  fromValue,
  toValue,
}: {
  granularity: PeriodGranularity;
  anchor: string;
  label: string;
  canGoNext: boolean;
  isCustom: boolean;
  fromValue: string;
  toValue: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  // Local, not server-derived — clicking "Custom" must reveal the two date inputs immediately.
  // Relying on the server's `isCustom` (only true once BOTH from/to are set) would mean the very
  // first click navigates to ?period=custom with no dates yet, the server falls through to its
  // month-default branch, and the inputs needed to actually pick a range would never appear.
  const [customOpen, setCustomOpen] = useState(isCustom);

  function navigate(params: URLSearchParams) {
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  function setGranularity(value: PeriodGranularity) {
    setCustomOpen(false);
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", value);
    params.delete("anchor");
    params.delete("from");
    params.delete("to");
    navigate(params);
  }

  function setCustomDate(key: "from" | "to", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", "custom");
    params.delete("anchor");
    if (value) params.set(key, value);
    else params.delete(key);
    navigate(params);
  }

  function shift(direction: 1 | -1) {
    // format(), not toISOString().slice(0,10) — the latter converts to UTC first, which silently
    // drops a calendar day whenever local midnight has a positive UTC offset (e.g. IST), pushing
    // the anchor into the wrong month/quarter at a period boundary.
    const nextAnchor = shiftPeriod(granularity, new Date(`${anchor}T00:00:00`), direction);
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", granularity);
    params.set("anchor", format(nextAnchor, "yyyy-MM-dd"));
    navigate(params);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
        {GRANULARITY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setGranularity(option.value)}
            className={cn(
              "rounded px-3 py-1.5 text-xs font-semibold transition-colors",
              !customOpen && granularity === option.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustomOpen(true)}
          className={cn(
            "rounded px-3 py-1.5 text-xs font-semibold transition-colors",
            customOpen ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Custom
        </button>
      </div>
      {customOpen ? (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            defaultValue={fromValue}
            onChange={(e) => setCustomDate("from", e.target.value)}
            className="h-8 w-40 text-xs"
            aria-label="From date"
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            type="date"
            defaultValue={toValue}
            onChange={(e) => setCustomDate("to", e.target.value)}
            className="h-8 w-40 text-xs"
            aria-label="To date"
          />
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="size-8" onClick={() => shift(-1)} aria-label="Previous period">
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-36 text-center text-sm font-medium">{label}</span>
          <Button variant="outline" size="icon" className="size-8" disabled={!canGoNext} onClick={() => shift(1)} aria-label="Next period">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
