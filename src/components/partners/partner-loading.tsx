import type { PartnerTabKey } from "@/lib/partners/tabs";
import { PartnerSection } from "./partners-rail";
import { ListSkeleton, OverviewSkeleton, RailSkeleton } from "./states";

/** What a Partner section shows while its data loads: the same frame, a still placeholder, no spinner. */
export function PartnerLoading({ tab }: { tab: PartnerTabKey }) {
  return (
    <PartnerSection tab={tab} busy rail={<RailSkeleton />}>
      {tab === "overview" ? <OverviewSkeleton /> : <ListSkeleton />}
    </PartnerSection>
  );
}
