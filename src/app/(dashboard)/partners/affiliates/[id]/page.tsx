import { notFound } from "next/navigation";

import { NativePartnerDetailPage } from "@/components/partners/native/pages";
import { AffiliateRail, PartnerSection } from "@/components/partners/partners-rail";
import { ErrorState, NotConnected, SampleBanner } from "@/components/partners/states";
import { AffiliateDetailView } from "@/components/partners/views";
import { requirePartnerWorkspace } from "@/lib/partners/access";
import { loadSample } from "@/lib/partners/load";
import { dataStatus } from "@/lib/partners/status";
import { buildReferrerDetailVM } from "@/lib/partners/view-models";

export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export default async function AffiliateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requirePartnerWorkspace();
  const { id } = await params;
  if (!ID.test(id)) notFound();
  if (access.source === "native") return NativePartnerDetailPage({ access, id });

  const loaded = await loadSample(async (api) => {
    const [detail, referees] = await Promise.all([api.getReferrer(id), api.listReferees({ referrerId: id, limit: 10 })]);
    return { detail, referees };
  });

  if (loaded.status === "not_connected") return <PartnerSection tab="affiliates"><NotConnected /></PartnerSection>;
  if (loaded.status === "error") {
    if (loaded.kind === "not_found") notFound();
    return <PartnerSection tab="affiliates"><ErrorState kind={loaded.kind} /></PartnerSection>;
  }
  const vm = buildReferrerDetailVM(loaded.data.detail, loaded.data.referees);
  return (
    <PartnerSection tab="affiliates" rail={<AffiliateRail vm={vm} status={dataStatus(loaded)} />}>
      <div className="flex flex-col gap-4">
        {loaded.sample && <SampleBanner />}
        <AffiliateDetailView vm={vm} />
      </div>
    </PartnerSection>
  );
}
