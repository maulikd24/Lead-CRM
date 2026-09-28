import { cn } from "@/lib/utils";

/** Account-level presence: is that WhatsApp number's session connected and heartbeating right now. */
export function AccountStatusDot({ online, className }: { online: boolean; className?: string }) {
  return (
    <span
      title={online ? "Number online" : "Number offline"}
      className={cn("inline-block size-2 shrink-0 rounded-full", online ? "bg-success" : "bg-muted-foreground/40", className)}
    />
  );
}
