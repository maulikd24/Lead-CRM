import { AlertTriangle, Inbox, PlugZap } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton, StickyRail, motion } from "@/components/workspace";
import { cn } from "@/lib/utils";
import { errorCopy } from "@/lib/partners/copy";
import type { Loaded } from "@/lib/partners/load";
import type { PartnerReadErrorKind } from "@/lib/partners/sample-port";

export function NotConnected() {
  return (
    <Card>
      <CardContent>
        <EmptyState icon={PlugZap} title="Sample data is switched off" description="Made-up data is only shown outside production. Nothing is shown rather than numbers that are not real." />
      </CardContent>
    </Card>
  );
}

export function ErrorState({ kind }: { kind: PartnerReadErrorKind }) {
  const c = errorCopy(kind);
  return (
    <Card role="alert">
      <CardContent>
        <EmptyState icon={AlertTriangle} title={c.title} description={c.description} />
      </CardContent>
    </Card>
  );
}

export function SampleBanner() {
  return (
    <div className="flex items-center gap-2 rounded-lg border-2 border-warning bg-warning/15 px-3 py-2.5 text-sm font-medium text-warning max-lg:py-1.5 max-lg:text-xs" role="note">
      <span aria-hidden className={cn(motion.liveDot, "size-2.5 shrink-0 rounded-full bg-warning")} />
      <span className="max-lg:line-clamp-2">Sample data. Every name and number on this page is made up and none of it comes from the programme. Leave PARTNER_SOURCE unset to see the CRM&apos;s own data.</span>
    </div>
  );
}

export function EmptyBlock({ title, description, reset }: { title: string; description?: string; reset?: { href: string; label: string } }) {
  return (
    <EmptyState icon={Inbox} title={title} description={description} action={reset ? { label: reset.label, href: reset.href } : undefined} />
  );
}

/** Renders the right state for a loaded result; only an ok result reaches children. */
export function LoadGate<T>({ loaded, children }: { loaded: Loaded<T>; children: (data: T) => ReactNode }) {
  if (loaded.status === "not_connected") return <NotConnected />;
  if (loaded.status === "error") return <ErrorState kind={loaded.kind} />;
  return (
    <div className="flex flex-col gap-4">
      {loaded.sample && <SampleBanner />}
      {children(loaded.data)}
    </div>
  );
}

/** Still placeholders (no shimmer) shaped like what is coming. The status line is for assistive tech. */
export function OverviewSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <p className="sr-only" role="status">Loading partner overview</p>
      <Skeleton className="h-72" />
      <Skeleton className="h-64" />
    </div>
  );
}

export function ListSkeleton({ columns = 6 }: { columns?: number }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-4" data-columns={columns}>
      <p className="sr-only" role="status">Loading</p>
      <div className="flex gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-7 w-20 rounded-full" />)}</div>
      <Skeleton className="h-96" />
    </div>
  );
}

export function RailSkeleton() {
  return (
    <StickyRail>
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </StickyRail>
  );
}
