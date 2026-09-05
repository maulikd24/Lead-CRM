import { Card, CardContent } from "@/components/ui/card";
import { TableCell, TableRow } from "@/components/ui/table";

export function KpiTileSkeleton() {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex items-center justify-between">
          <div className="h-3 w-20 animate-pulse rounded-md bg-muted" />
          <div className="size-6 animate-pulse rounded-full bg-muted" />
        </div>
        <div className="h-8 w-14 animate-pulse rounded-md bg-muted" />
      </CardContent>
    </Card>
  );
}

export function TableRowSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <TableRow>
      {Array.from({ length: columns }).map((_, i) => (
        <TableCell key={i}>
          <div className="h-4 animate-pulse rounded-md bg-muted" style={{ width: `${60 + ((i * 17) % 40)}%` }} />
        </TableCell>
      ))}
    </TableRow>
  );
}

export function ListRowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="size-6 shrink-0 animate-pulse rounded-full bg-muted" />
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="h-3.5 w-2/3 animate-pulse rounded-md bg-muted" />
        <div className="h-3 w-1/3 animate-pulse rounded-md bg-muted" />
      </div>
    </div>
  );
}
