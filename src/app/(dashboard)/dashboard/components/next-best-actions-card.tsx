import Link from "next/link";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { Sparkles } from "lucide-react";
import { buildWorklist } from "@/lib/copilot/worklist";
import { cn } from "@/lib/utils";
import { drawerOffered } from "@/lib/intelligence/decision/access";
import { customersWithDecision } from "@/lib/intelligence/decision/review-db";
import { NextBestActionsList, type NbaListEntry } from "./next-best-actions-list";

export async function NextBestActionsCard({ visibleUserIds, role, userId, className }: { visibleUserIds: string[] | null; role?: string; userId: string; className?: string }) {
  const { entries } = await buildWorklist(visibleUserIds);
  const sorted = [...entries].sort((a, b) => b.priority.score - a.priority.score);
  // "Why?" only where the Evidence Drawer is offered to this role (screen flag, and for an RM the RM flag) and a decision is stored. The worklist is already scoped to the viewer's own customers.
  const shown = sorted.slice(0, 30);
  const withDecision = role && drawerOffered(role) ? await customersWithDecision(shown.map((e) => e.client.id)) : new Set<string>();
  const listEntries: NbaListEntry[] = sorted.map((e) => ({
    clientId: e.client.id,
    clientName: e.client.name,
    kind: e.nba.kind,
    label: e.nba.label,
    detail: e.nba.detail,
    ...(withDecision.has(e.client.id) ? { whyHref: `/clients/${e.client.id}?sheet=decision` } : {}),
  }));

  return (
    <Card className={cn(className)}>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prioritised for you</p>
          <CardTitle>Next best actions</CardTitle>
        </div>
        <Link href="/copilot" className="inline-flex min-h-11 items-center px-1 text-xs font-bold text-primary hover:underline">
          View all
        </Link>
      </CardHeader>
      <CardContent>
        {listEntries.length === 0 ? (
          <EmptyState icon={Sparkles} title="All caught up" description="No prioritised actions right now." />
        ) : (
          <NextBestActionsList entries={listEntries} userId={userId} />
        )}
      </CardContent>
    </Card>
  );
}

export function NextBestActionsCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn(className)}>
      <CardHeader>
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-1 h-5 w-40" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
