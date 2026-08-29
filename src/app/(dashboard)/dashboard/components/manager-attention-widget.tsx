import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
      <CardContent className="flex flex-col gap-2">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing needs attention right now.</p>}
        {rows.map((row, i) => (
          <Link
            key={`${row.clientId}-${row.category}-${i}`}
            href={`/clients/${row.clientId}`}
            className="flex items-center justify-between text-sm hover:underline"
          >
            <span>
              {row.clientName} <span className="text-muted-foreground">({row.rmName ?? "Unassigned"})</span>
            </span>
            <Badge variant="destructive">{row.category.replace(/_/g, " ")}</Badge>
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
      <CardContent className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-6 w-full animate-pulse rounded-md bg-muted" />
        ))}
      </CardContent>
    </Card>
  );
}
