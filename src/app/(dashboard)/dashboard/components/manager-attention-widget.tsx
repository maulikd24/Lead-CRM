import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ListRowSkeleton } from "@/components/shared/skeletons";
import { getManagerAttentionRows } from "@/lib/dashboard/manager-attention";

export async function ManagerAttentionWidget({ visibleUserIds }: { visibleUserIds: string[] | null }) {
  const rows = await getManagerAttentionRows(visibleUserIds, { limit: 5 });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Needs Manager Attention</CardTitle>
        <Link href="/exceptions" className="text-sm text-primary hover:underline">
          View all
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-0.5">
        {rows.length === 0 && (
          <EmptyState icon={ShieldCheck} title="Nothing needs attention" description="No escalations right now." />
        )}
        {rows.map((row, i) => (
          <Link
            key={`${row.clientId}-${row.category}-${i}`}
            href={`/clients/${row.clientId}`}
            className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-muted"
          >
            <span className="truncate">
              {row.clientName} <span className="text-muted-foreground">({row.rmName ?? "Unassigned"})</span>
            </span>
            <Badge variant="destructive" className="shrink-0">
              {row.category.replace(/_/g, " ")}
            </Badge>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

export function ManagerAttentionWidgetSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Needs Manager Attention</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <ListRowSkeleton key={i} />
        ))}
      </CardContent>
    </Card>
  );
}
