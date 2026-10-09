import { LoadGate } from "@/components/partners/states";
import { PayoutsView } from "@/components/partners/views";
import { parseListQuery, requirePartnerWorkspace } from "@/lib/partners/access";
import { loadReferralData } from "@/lib/partners/load";
import { DEFAULT_PAGE_SIZE } from "@/lib/partners/referral-api";
import { buildPayoutsVM } from "@/lib/partners/view-models";

export const dynamic = "force-dynamic";

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePartnerWorkspace();
  const query = parseListQuery(await searchParams);
  const loaded = await loadReferralData((api) => api.listWithdrawals({ limit: DEFAULT_PAGE_SIZE, offset: query.offset, status: query.status }));
  return (
    <LoadGate loaded={loaded} canConfigure={session.user.role === "ADMIN"}>
      {(page) => <PayoutsView vm={buildPayoutsVM(page, query)} />}
    </LoadGate>
  );
}
