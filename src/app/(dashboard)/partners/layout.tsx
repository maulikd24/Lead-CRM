import "./partners.css";

import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { PartnersNav } from "@/components/partners/partners-nav";
import { isPartnerWorkspaceEnabled } from "@/lib/partners/flag";
import { getConnection } from "@/lib/partners/load";

export default async function PartnersLayout({ children }: { children: React.ReactNode }) {
  if (!isPartnerWorkspaceEnabled()) notFound();
  const conn = await getConnection().catch(() => ({ state: "not_connected" as const }));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={conn.state === "mock" ? "Partner workspace (Sample data)" : "Partner workspace"}
        description="Affiliates, referred users and payouts from the referral programme. Read-only. Shows the whole programme, not only your team."
      />
      <PartnersNav />
      {children}
    </div>
  );
}
