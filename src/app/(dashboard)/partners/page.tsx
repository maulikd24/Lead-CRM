import { NativeOverviewPage } from "@/components/partners/native/pages";
import { PartnerSection } from "@/components/partners/partners-rail";
import { LoadGate } from "@/components/partners/states";
import { OverviewView } from "@/components/partners/views";
import { requirePartnerWorkspace } from "@/lib/partners/access";
import { loadSummaryOnce } from "@/lib/partners/load";
import { buildOverviewVM } from "@/lib/partners/view-models";

export const dynamic = "force-dynamic";

export default async function PartnersOverviewPage() {
  const access = await requirePartnerWorkspace();
  if (access.source === "native") return NativeOverviewPage({ access });
  const loaded = await loadSummaryOnce();
  return (
    <PartnerSection tab="overview">
      <LoadGate loaded={loaded} canConfigure={access.role === "ADMIN"}>{(summary) => <OverviewView vm={buildOverviewVM(summary)} />}</LoadGate>
    </PartnerSection>
  );
}
