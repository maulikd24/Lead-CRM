import { notFound } from "next/navigation";

import { PartnerSection } from "@/components/partners/partners-rail";
import { ContractView } from "@/components/partners/contract-view";
import { requirePartnerWorkspace } from "@/lib/partners/access";
import { loadContractInfo } from "@/lib/partners/load";
import { buildContractVM } from "@/lib/partners/status";

export const dynamic = "force-dynamic";

export default async function ContractCheckPage() {
  const access = await requirePartnerWorkspace();
  // The native source has no external contract to check.
  if (access.source === "native") notFound();
  const info = await loadContractInfo();
  return (
    <PartnerSection tab="contract">
      <ContractView vm={buildContractVM(info, { isAdmin: access.role === "ADMIN" })} />
    </PartnerSection>
  );
}
