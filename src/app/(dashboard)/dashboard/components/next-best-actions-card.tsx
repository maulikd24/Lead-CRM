import Link from "next/link";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { Sparkles } from "lucide-react";
import { buildWorklist } from "@/lib/copilot/worklist";
import { cn } from "@/lib/utils";
import { NextBestActionsList, type NbaListEntry } from "./next-best-actions-list";

export async function NextBestActionsCard({ visibleUserIds, className }: { visibleUserIds: string[] | null; className?: string }) {
  const { entries } = await buildWorklist(visibleUserIds);
  const sorted = [...entries].sort((a, b) => b.priority.score - a.priority.score);
  const listEntries: NbaListEntry[] = sorted.map((e) => ({
    clientId: e.client.id,
    clientName: e.client.name,
    kind: e.nba.kind,
    label: e.nba.label,
    detail: e.nba.detail,
  }));

  return (
    <Card className={cn(className)}>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Prioritised for you</p>
          <CardTitle>Next best actions</CardTitle>
        </div>
        <Link href="/copilot" className="text-[11px] font-bold text-primary hover:underline">
          View all
        </Link>
      </CardHeader>
      <CardContent>
        {listEntries.length === 0 ? (
          <EmptyState icon={Sparkles} title="All caught up" description="No prioritised actions right now." />
        ) : (
          <NextBestActionsList entries={listEntries} />
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
