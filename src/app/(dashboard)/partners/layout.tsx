import { notFound } from "next/navigation";

import { PartnersTabs } from "@/components/partners/partners-tabs";
import { WorkspaceHeading, WorkspaceShell } from "@/components/workspace";
import { isPartnerWorkspaceEnabled } from "@/lib/partners/flag";
import { resolvePartnerSource } from "@/lib/partners/source";
import { partnerTabsFor } from "@/lib/partners/tabs";

/** The Partner workspace frame: a fixed header, the section tabs, and (from each page) the section and its rail. */
export default async function PartnersLayout({ children }: { children: React.ReactNode }) {
  if (!isPartnerWorkspaceEnabled()) notFound();
  const source = resolvePartnerSource();
  const native = source === "native";
  return (
    <WorkspaceShell
      hasRail
      header={
        <WorkspaceHeading
          title={native ? "Partner workspace" : "Partner workspace (Sample data)"}
          description={
            native
              ? "Partners, the people they refer, commissions, payouts and statements, read straight from this CRM. Read-only."
              : "Made-up sample data for development: nothing here comes from the programme. Read-only."
          }
        />
      }
      tabs={<PartnersTabs tabs={partnerTabsFor(source)} />}
    >
      {children}
    </WorkspaceShell>
  );
}
