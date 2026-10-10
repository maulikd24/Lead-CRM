import { PartnerSection } from "@/components/partners/partners-rail";
import { ContractView } from "@/components/partners/contract-view";
import { requirePartnerWorkspace } from "@/lib/partners/access";
import { loadContractInfo } from "@/lib/partners/load";
import { buildContractVM } from "@/lib/partners/status";

export const dynamic = "force-dynamic";

export default async function ContractCheckPage() {
  const session = await requirePartnerWorkspace();
  const info = await loadContractInfo();
  return (
    <PartnerSection tab="contract">
      <ContractView vm={buildContractVM(info, { isAdmin: session.user.role === "ADMIN" })} />
    </PartnerSection>
  );
}
