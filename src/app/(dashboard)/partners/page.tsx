import { PartnerSection } from "@/components/partners/partners-rail";
import { LoadGate } from "@/components/partners/states";
import { OverviewView } from "@/components/partners/views";
import { requirePartnerWorkspace } from "@/lib/partners/access";
import { loadSummaryOnce } from "@/lib/partners/load";
import { buildOverviewVM } from "@/lib/partners/view-models";

export const dynamic = "force-dynamic";

export default async function PartnersOverviewPage() {
  const session = await requirePartnerWorkspace();
  const loaded = await loadSummaryOnce();
  return (
    <PartnerSection tab="overview">
      <LoadGate loaded={loaded} canConfigure={session.user.role === "ADMIN"}>{(summary) => <OverviewView vm={buildOverviewVM(summary)} />}</LoadGate>
    </PartnerSection>
  );
}
