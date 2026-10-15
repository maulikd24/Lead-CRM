import { Suspense } from "react";

import { requireAccess } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { CopilotContent } from "./components/copilot-content";
import { CopilotSummarySkeleton } from "./components/copilot-summary";
import { CopilotWorklistSkeleton } from "./components/copilot-worklist";
import type { CopilotQuery } from "@/lib/copilot/list-view";
import { canAskCopilot } from "@/lib/palette/ask-roles";

export const metadata = { title: "Co-pilot" };

export default async function CopilotPage({ searchParams }: { searchParams: Promise<CopilotQuery> }) {
  const session = await requireAccess("copilot");
  const query = await searchParams;
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
      <CopilotContent visibleUserIds={visibleUserIds} includeUnassigned={session.user.role === "MANAGER"} canAsk={canAskCopilot(session.user.role)} query={query} role={session.user.role} />
    </Suspense>
  );
}
