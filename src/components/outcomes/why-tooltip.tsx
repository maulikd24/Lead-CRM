import { Info } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A "why" tooltip that works on hover AND keyboard focus, with no script and no animation: the trigger is a real button, the
 * text is exposed through aria-describedby, and the bubble stays open while the pointer is over it.
 */
export function WhyTooltip({ id, label = "Why", children, className, align = "start" }: { id: string; label?: string; children: ReactNode; className?: string; align?: "start" | "end" }) {
  return (
    <span className={cn("group/why relative inline-flex", className)}>
      <button
        type="button"
        aria-describedby={id}
        className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Info aria-hidden className="size-3" />
        {label}
      </button>
      <span
        role="tooltip"
        id={id}
        className={cn(
          "invisible absolute top-full z-30 mt-1.5 w-72 max-w-[80vw] rounded-md border border-border bg-popover p-3 text-left text-xs leading-relaxed text-popover-foreground shadow-md",
          "group-hover/why:visible group-focus-within/why:visible",
          align === "end" ? "right-0" : "left-0",
        )}
      >
        {children}
      </span>
    </span>
  );
}
