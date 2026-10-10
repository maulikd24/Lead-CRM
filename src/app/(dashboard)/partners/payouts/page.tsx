import { NativePayoutsPage } from "@/components/partners/native/pages";
import { PartnerSection } from "@/components/partners/partners-rail";
import { LoadGate } from "@/components/partners/states";
import { PayoutsView } from "@/components/partners/views";
import { parseListQuery, requirePartnerWorkspace } from "@/lib/partners/access";
import { loadReferralData } from "@/lib/partners/load";
import { DEFAULT_PAGE_SIZE } from "@/lib/partners/referral-api";
import { buildPayoutsVM } from "@/lib/partners/view-models";

export const dynamic = "force-dynamic";

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requirePartnerWorkspace();
  if (access.source === "native") return NativePayoutsPage({ access, searchParams });
  const query = parseListQuery(await searchParams);
  const loaded = await loadReferralData((api) => api.listWithdrawals({ limit: DEFAULT_PAGE_SIZE, offset: query.offset, status: query.status }));
  return (
    <PartnerSection tab="payouts">
      <LoadGate loaded={loaded} canConfigure={access.role === "ADMIN"}>
        {(page) => <PayoutsView vm={buildPayoutsVM(page, query)} />}
      </LoadGate>
    </PartnerSection>
  );
}
