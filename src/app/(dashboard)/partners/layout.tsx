import "./partners.css";

import { PageHeader } from "@/components/shared/page-header";
import { PartnersNav } from "@/components/partners/partners-nav";

export default function PartnersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Partner workspace" description="Affiliates, referred users and payouts from the referral programme. Read-only." />
      <PartnersNav />
      {children}
    </div>
  );
}
