import { Suspense } from "react";

import { requireAccess } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { CopilotContent } from "./components/copilot-content";
import { CopilotSummarySkeleton } from "./components/copilot-summary";
import { CopilotWorklistSkeleton } from "./components/copilot-worklist";
import type { PriorityFilters } from "./components/priority-customers";

export const metadata = { title: "Co-pilot" };

export default async function CopilotPage({ searchParams }: { searchParams: Promise<PriorityFilters> }) {
  const session = await requireAccess("copilot");
  const { priority, owner, timing } = await searchParams;
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);

  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-4">
          <CopilotSummarySkeleton />
          <CopilotWorklistSkeleton />
        </div>
      }
    >
      <CopilotContent visibleUserIds={visibleUserIds} includeUnassigned={session.user.role === "MANAGER"} filters={{ priority, owner, timing }} />
    </Suspense>
  );
}
