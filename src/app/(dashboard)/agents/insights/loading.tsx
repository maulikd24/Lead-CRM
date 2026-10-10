import { Skeleton } from "@/components/workspace";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-busy="true" aria-label="Loading agent insights">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[3.75rem] min-w-[8.5rem] flex-1" />
        ))}
      </div>
      <Skeleton className="h-9 w-80 max-w-full" />
      <Skeleton className="h-72 w-full" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
