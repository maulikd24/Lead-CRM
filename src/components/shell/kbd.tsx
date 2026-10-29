import { cn } from "@/lib/utils";

/** One key chip. Shared by the shortcut overlay, the palette and the menus so keys always look the same. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-background px-1 font-sans text-[11px] font-medium text-muted-foreground", className)}>{children}</kbd>;
}

export function Keys({ keys, className }: { keys: readonly string[]; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-label={keys.join(" then ")}>
      {keys.map((k, i) => <Kbd key={`${k}-${i}`}>{k}</Kbd>)}
    </span>
  );
}
