import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { pageWindow } from "@/lib/partners/view-models";

export function FilterChips({ chips, label }: { chips: { key: string; label: string; active: boolean; href: string }[]; label: string }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <Link
          key={c.key}
          href={c.href}
          aria-current={c.active ? "true" : undefined}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
            c.active ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {c.label}
        </Link>
      ))}
    </nav>
  );
}

/** A plain GET form: works without JavaScript, keeps the other filters as hidden fields. */
export function SearchBox({ action, q, placeholder, keep }: { action: string; q?: string; placeholder: string; keep?: Record<string, string | undefined> }) {
  return (
    <form action={action} method="get" role="search" className="flex items-center gap-2">
      {Object.entries(keep ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input name="q" defaultValue={q} placeholder={placeholder} aria-label={placeholder} maxLength={80} className="h-9 w-64 max-w-full pl-8" />
      </div>
      <Button type="submit" size="sm" variant="outline">Search</Button>
    </form>
  );
}

export function Pager({ window: w, prevHref, nextHref }: { window: ReturnType<typeof pageWindow>; prevHref: string | null; nextHref: string | null }) {
  if (w.total === 0) return null;
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
      <p aria-live="polite">
        {w.from}-{w.to} of {w.total.toLocaleString("en-IN")}
      </p>
      <div className="flex items-center gap-1">
        <span className="mr-2 hidden text-xs sm:inline">Page {w.page} of {w.pages}</span>
        {prevHref ? (
          <Button size="sm" variant="outline" render={<Link href={prevHref} />}><ChevronLeft /> Previous</Button>
        ) : (
          <Button size="sm" variant="outline" disabled><ChevronLeft /> Previous</Button>
        )}
        {nextHref ? (
          <Button size="sm" variant="outline" render={<Link href={nextHref} />}>Next <ChevronRight /></Button>
        ) : (
          <Button size="sm" variant="outline" disabled>Next <ChevronRight /></Button>
        )}
      </div>
    </div>
  );
}
