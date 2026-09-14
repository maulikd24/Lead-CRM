import { notFound } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/shared/page-header";
import { PartnerProfileCard } from "./partner-profile-card";

export default async function PartnerHomePage() {
  const session = await requireRole(["PARTNER", "AFFILIATE", "DISTRIBUTOR"]);

  const profile = await prisma.partnerProfile.findUnique({ where: { userId: session.user.id } });
  if (!profile) notFound(); // proves row-level linkage, not just the role gate

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Partner Home" description={`Welcome, ${session.user.name}.`} />
      <PartnerProfileCard profile={profile} />
    </div>
  );
}
