import { AlertTriangle, Inbox, PlugZap } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton, StickyRail, motion } from "@/components/workspace";
import { cn } from "@/lib/utils";
import { errorCopy } from "@/lib/partners/copy";
import type { Loaded } from "@/lib/partners/load";
import type { ReferralApiErrorKind } from "@/lib/partners/referral-api";

export function NotConnected({ canConfigure }: { canConfigure: boolean }) {
  return (
    <Card>
      <CardContent>
        <EmptyState
          icon={PlugZap}
          title="Not connected"
          description="Not connected: ask an administrator to connect the referral API in Settings."
          action={canConfigure ? { label: "Open Apps & Integrations", href: "/settings/integrations" } : undefined}
        />
      </CardContent>
    </Card>
  );
}

export function ErrorState({ kind }: { kind: ReferralApiErrorKind }) {
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
    <div className="flex items-center gap-2 rounded-lg border-2 border-warning bg-warning/15 px-3 py-2.5 text-sm font-medium text-warning" role="note">
      <span aria-hidden className={cn(motion.liveDot, "size-2.5 shrink-0 rounded-full bg-warning")} />
      <span>Sample data. Every name and number on this page is made up and none of it comes from the referral programme. An administrator can connect the referral API in Settings.</span>
    </div>
  );
}

export function UnverifiedBanner() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning" role="note">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning" />
      <span>Live connection, contract not yet verified. Field names are unconfirmed, so check figures against the source before relying on them.</span>
    </div>
  );
}

export function EmptyBlock({ title, description, reset }: { title: string; description?: string; reset?: { href: string; label: string } }) {
  return (
    <EmptyState icon={Inbox} title={title} description={description} action={reset ? { label: reset.label, href: reset.href } : undefined} />
  );
}

/** Renders the right state for a loaded result; only an ok result reaches children. */
export function LoadGate<T>({ loaded, canConfigure, children }: { loaded: Loaded<T>; canConfigure: boolean; children: (data: T) => ReactNode }) {
  if (loaded.status === "not_connected") return <NotConnected canConfigure={canConfigure} />;
  if (loaded.status === "error") return <ErrorState kind={loaded.kind} />;
  return (
    <div className="flex flex-col gap-4">
      {loaded.sample && <SampleBanner />}
      {/* Only an external source has a contract to verify; native data is read from this CRM's own tables. */}
      {loaded.source !== "native" && !loaded.sample && !loaded.contractVerified && <UnverifiedBanner />}
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
