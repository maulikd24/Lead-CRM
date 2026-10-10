import { Skeleton } from "@/components/ui/skeleton";

import styles from "./marketing.module.css";

/** Placeholder while a tab's data loads: the same shape as the panel and rail, so nothing jumps when it arrives. */
export function WorkspaceSkeleton({ withHeader = false }: { withHeader?: boolean }) {
  return (
    <div className={withHeader ? styles.workspace : "contents"} aria-busy="true" aria-label="Loading">
      {withHeader && (
        <div className={styles.head}>
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-72 max-w-full" />
        </div>
      )}
      <div className={styles.body}>
        <div className={styles.main}>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
            <Skeleton className="h-64" />
            <div className="grid gap-2.5 sm:grid-cols-2"><Skeleton className="h-36" /><Skeleton className="h-36" /></div>
          </div>
        </div>
        <div className={styles.rail}>
          <div className={styles.facts}>
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className={`${styles.fact} h-16`} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
