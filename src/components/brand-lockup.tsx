import { Logo } from "@/components/logo";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** Logo, product name and the "Customer OS" subtitle. `compact` hides the subtitle (tight spaces); the icon-only rail hides the text via the parent. */
export function BrandLockup({ className, compact = false, size = "md" }: { className?: string; compact?: boolean; size?: "md" | "lg" }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <Logo className={cn("shrink-0", size === "lg" ? "size-9" : "size-7")} />
      <div className="min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
        <p className={cn("font-heading font-semibold tracking-tight", size === "lg" ? "text-lg" : "text-base")}>{BRAND.name}</p>
        {!compact && <p className="text-xs text-muted-foreground">{BRAND.subtitle}</p>}
      </div>
    </div>
  );
}
