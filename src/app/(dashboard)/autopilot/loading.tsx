import { Skeleton } from "@/components/workspace";

export default function Loading() {
  return <div className="space-y-3 p-4" aria-busy="true"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div>;
}
