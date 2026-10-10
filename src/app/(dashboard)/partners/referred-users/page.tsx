import { NativeReferredPage } from "@/components/partners/native/pages";
import { PartnerSection } from "@/components/partners/partners-rail";
import { LoadGate } from "@/components/partners/states";
import { RefereesView } from "@/components/partners/views";
import { parseListQuery, requirePartnerWorkspace } from "@/lib/partners/access";
import { loadReferralData } from "@/lib/partners/load";
import { DEFAULT_PAGE_SIZE } from "@/lib/partners/referral-api";
import { buildRefereesVM } from "@/lib/partners/view-models";

export const dynamic = "force-dynamic";

export default async function ReferredUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requirePartnerWorkspace();
  if (access.source === "native") return NativeReferredPage({ access, searchParams });
  const query = parseListQuery(await searchParams);
  const loaded = await loadReferralData((api) => api.listReferees({ limit: DEFAULT_PAGE_SIZE, offset: query.offset, search: query.q, funnelStatus: query.funnel }));
  return (
    <PartnerSection tab="referred-users">
      <LoadGate loaded={loaded} canConfigure={access.role === "ADMIN"}>
        {(page) => <RefereesView vm={buildRefereesVM(page, query)} q={query.q} />}
      </LoadGate>
    </PartnerSection>
  );
}
