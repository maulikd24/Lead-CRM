"use client";

import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CallFilters } from "@/lib/calls/view-model";
import { activeFilterCount, CallFiltersForm } from "./call-filters";

/**
 * The filters in the workspace toolbar: one "Filters" button (with how many are on) that opens the form as a panel under
 * the tab bar, so the sticky header stays one row tall. Escape or a click outside closes it. It is still a plain GET
 * form: the URL is the filter state, so a filtered view can be bookmarked.
 */
export function CallFilterToolbar({ filters, rms, showRm, tab }: { filters: CallFilters; rms: { id: string; name: string }[]; showRm: boolean; tab?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const count = activeFilterCount(filters);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div ref={root} className="relative w-full lg:w-auto" onSubmit={() => setOpen(false)}>
      <Button ref={button} type="button" variant={count > 0 ? "secondary" : "outline"} size="sm" aria-expanded={open} aria-controls="call-filters" onClick={() => setOpen((o) => !o)}>
        <SlidersHorizontal aria-hidden /> Filters{count > 0 ? ` (${count})` : ""}
      </Button>
      {open && (
        <div id="call-filters" className="absolute inset-x-0 top-full z-30 mt-2 rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-lg lg:inset-x-auto lg:right-0 lg:w-[46rem]">
          <CallFiltersForm filters={filters} rms={rms} showRm={showRm} tab={tab} />
        </div>
      )}
    </div>
  );
}
