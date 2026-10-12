import type { ReactNode } from "react";

import { WorkspacePanel } from "@/components/workspace";

/** The section panel plus its rail, as items of the shared workspace grid. The panel is keyed by tab, so it softly cross-fades in when the tab changes. */
export function TabLayout({ tab, main, rail }: { tab: string; main: ReactNode; rail: ReactNode }) {
  return (
    <>
      <WorkspacePanel tab={tab} idPrefix="mkt">
        {main}
      </WorkspacePanel>
      {rail}
    </>
  );
}
