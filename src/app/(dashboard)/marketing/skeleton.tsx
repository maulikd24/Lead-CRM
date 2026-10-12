import { Skeleton, StickyRail, WorkspacePanel, WorkspaceShell, WorkspaceTabs } from "@/components/workspace";

/** Placeholder while a tab's data loads: the same shape as the panel and rail, so nothing jumps when it arrives. */
export function WorkspaceSkeleton({ withHeader = false }: { withHeader?: boolean }) {
  const body = (
    <>
      <WorkspacePanel tab="loading" idPrefix="mkt" busy>
        <div aria-label="Loading" className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
          <Skeleton className="h-64" />
          <div className="grid gap-2.5 sm:grid-cols-2"><Skeleton className="h-36" /><Skeleton className="h-36" /></div>
        </div>
      </WorkspacePanel>
      <StickyRail facts={Array.from({ length: 4 }).map((_, i) => <li key={i} className="min-w-[7.5rem] flex-none lg:min-w-0"><Skeleton className="h-16" /></li>)} />
    </>
  );
  if (!withHeader) return body;
  return (
    <WorkspaceShell hasRail header={<><Skeleton className="h-8 w-40" /></>} tabs={<WorkspaceTabs tabs={[{ key: "loading", label: "Loading", href: "#" }]} active="loading" idPrefix="mkt" label="Marketing sections" />}>
      {body}
    </WorkspaceShell>
  );
}
