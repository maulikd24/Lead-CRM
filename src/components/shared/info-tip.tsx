"use client";

import { Info } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** A small (i) button that opens a short plain-language definition. Works with a tap or the keyboard. */
export function InfoTip({ label, children }: { label: string; children: string }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`What is ${label}?`}
        className="ml-1 inline-flex size-4 items-center justify-center rounded-full align-middle text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
      >
        <Info className="size-3.5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3 text-xs font-normal normal-case leading-snug tracking-normal">
        <p className="mb-1 font-semibold">{label}</p>
        <p className="text-muted-foreground">{children}</p>
      </PopoverContent>
    </Popover>
  );
}
