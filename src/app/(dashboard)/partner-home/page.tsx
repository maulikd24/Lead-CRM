import { notFound } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { PartnerWorkspaceLink } from "@/components/partners/workspace-link";
import { TabbedWorkspace, WorkspaceHeading } from "@/components/workspace";
import { buildReferralLink, loadWorkspaceSettings } from "@/lib/partners/settings";
import { PartnerProfileCard } from "./partner-profile-card";
import { ReferredClientsPanel } from "./referred-clients-panel";
import { EarningsWidget } from "./earnings-widget";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "clients", label: "Referred clients" },
];

export default async function PartnerHomePage() {
  const session = await requireRole(["PARTNER", "AFFILIATE", "DISTRIBUTOR"]);

  const profile = await prisma.partnerProfile.findUnique({ where: { userId: session.user.id } });
  if (!profile) notFound(); // proves row-level linkage, not just the role gate

  const settings = await loadWorkspaceSettings(prisma as never);
  const referralLink = buildReferralLink(settings.referral.linkBase, profile.partnerCode);
  const actor = { id: session.user.id, role: session.user.role };

  // Two sections, one on screen at a time (the workspace pattern): the page never scrolls, long tables scroll inside their section.
  return (
    <TabbedWorkspace
      idPrefix="phome"
      label="Partner Home sections"
      tabs={TABS}
      header={<WorkspaceHeading title="Partner Home" description={`Welcome, ${session.user.name}.`} actions={<PartnerWorkspaceLink />} />}
      panels={{
        overview: (
          <div className="flex flex-col gap-4">
            <PartnerProfileCard profile={profile} referralLink={referralLink} />
            <EarningsWidget actor={actor} />
          </div>
        ),
        clients: <ReferredClientsPanel partnerProfileId={profile.id} actor={actor} />,
      }}
    />
  );
}
