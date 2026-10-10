import { notFound } from "next/navigation";

import { PartnersTabs } from "@/components/partners/partners-tabs";
import { WorkspaceHeading, WorkspaceShell } from "@/components/workspace";
import { isPartnerWorkspaceEnabled } from "@/lib/partners/flag";
import { getConnection } from "@/lib/partners/load";

/** The Partner workspace frame: a fixed header, the section tabs, and (from each page) the section and its rail. */
export default async function PartnersLayout({ children }: { children: React.ReactNode }) {
  if (!isPartnerWorkspaceEnabled()) notFound();
  const conn = await getConnection().catch(() => ({ state: "not_connected" as const }));
  return (
    <WorkspaceShell
      hasRail
      header={
        <WorkspaceHeading
          title={conn.state === "mock" ? "Partner workspace (Sample data)" : "Partner workspace"}
          description="Affiliates, referred users and payouts from the referral programme. Read-only. Shows the whole programme, not only your team."
        />
      }
      tabs={<PartnersTabs />}
    >
      {children}
    </WorkspaceShell>
  );
}
