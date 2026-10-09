import { Card, CardContent } from "@/components/ui/card";
import { KpiTileSkeleton } from "@/components/shared/skeletons";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading agent insights">
      <div className="flex flex-col gap-2">
        <div className="h-7 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded-md bg-muted" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <KpiTileSkeleton key={i} />
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardContent className="flex flex-col gap-3">
            <div className="h-5 w-56 animate-pulse rounded-md bg-muted" />
            <div className="h-40 animate-pulse rounded-md bg-muted" />
          </CardContent>
        </Card>
      ))}
      <span className="sr-only">Loading</span>
    </div>
  );
}
