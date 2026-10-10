import { notFound } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/shared/page-header";
import { PartnerWorkspaceLink } from "@/components/partners/workspace-link";
import { PartnerProfileCard } from "./partner-profile-card";
import { buildReferralLink, loadWorkspaceSettings } from "@/lib/partners/settings";
import { ReferredClientsPanel } from "./referred-clients-panel";
import { EarningsWidget } from "./earnings-widget";

export default async function PartnerHomePage() {
  const session = await requireRole(["PARTNER", "AFFILIATE", "DISTRIBUTOR"]);

  const profile = await prisma.partnerProfile.findUnique({ where: { userId: session.user.id } });
  if (!profile) notFound(); // proves row-level linkage, not just the role gate

  const settings = await loadWorkspaceSettings(prisma as never);
  const referralLink = buildReferralLink(settings.referral.linkBase, profile.partnerCode);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Partner Home" description={`Welcome, ${session.user.name}.`} actions={<PartnerWorkspaceLink />} />
      <PartnerProfileCard profile={profile} referralLink={referralLink} />
      <ReferredClientsPanel partnerProfileId={profile.id} actor={{ id: session.user.id, role: session.user.role }} />
      <EarningsWidget actor={{ id: session.user.id, role: session.user.role }} />
    </div>
  );
}
