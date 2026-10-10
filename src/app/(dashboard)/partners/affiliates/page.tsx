import { PartnerSection } from "@/components/partners/partners-rail";
import { LoadGate } from "@/components/partners/states";
import { AffiliatesView } from "@/components/partners/views";
import { parseListQuery, requirePartnerWorkspace } from "@/lib/partners/access";
import { loadReferralData } from "@/lib/partners/load";
import { DEFAULT_PAGE_SIZE } from "@/lib/partners/referral-api";
import { KYC_FILTERS, buildAffiliateListVM } from "@/lib/partners/view-models";

export const dynamic = "force-dynamic";

export default async function AffiliatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePartnerWorkspace();
  const query = parseListQuery(await searchParams);
  const kycValue = KYC_FILTERS.find((f) => f.key === query.kyc)?.value;
  const loaded = await loadReferralData((api) => api.listReferrers({ limit: DEFAULT_PAGE_SIZE, offset: query.offset, search: query.q, kycStatus: kycValue }));
  return (
    <PartnerSection tab="affiliates">
      <LoadGate loaded={loaded} canConfigure={session.user.role === "ADMIN"}>
        {(page) => <AffiliatesView vm={buildAffiliateListVM(page, query)} q={query.q} />}
      </LoadGate>
    </PartnerSection>
  );
}
