import type { ReactNode } from "react";
import { Suspense } from "react";

import { CountUp, RailCard, RailFact, StickyRail, WorkspacePanel } from "@/components/workspace";
import type { PartnerAccess } from "@/lib/partners/access";
import { loadNativeSummaryOnce } from "@/lib/partners/load";
import { scopeNote } from "@/lib/partners/native/view-models";
import { dataStatus } from "@/lib/partners/status";
import type { PartnerTabKey } from "@/lib/partners/tabs";
import { StatusCard } from "../partners-rail";
import { RailSkeleton } from "../states";

/** Counts and the data status beside every native section. Shares the summary request with the Overview. */
export async function NativeRail({ access }: { access: PartnerAccess }) {
  const loaded = await loadNativeSummaryOnce(access);
  const status = dataStatus(loaded);
  if (loaded.status !== "ok") return <StickyRail><StatusCard status={status} link={false} /></StickyRail>;
  const { summary: s } = loaded.data;
  return (
    <StickyRail
      label="Partner counts and data status"
      facts={
        <>
          <RailFact label="Partners" index={0}><CountUp value={s.referrers.total} label="Partners" /></RailFact>
          <RailFact label="Active" index={1} tone="success" hint={s.referrers.total ? `of ${s.referrers.total.toLocaleString("en-IN")}` : undefined}><CountUp value={s.referrers.active} label="Active partners" /></RailFact>
          <RailFact label="Onboarding" index={2} tone={(s.referrers.pending ?? 0) > 0 ? "warning" : "default"} live={(s.referrers.pending ?? 0) > 0}><CountUp value={s.referrers.pending} label="Onboarding partners" /></RailFact>
          <RailFact label="Referred people" index={3}><CountUp value={s.referees.total} label="Referred people" /></RailFact>
          <RailFact label="With an active account" index={4} tone="success"><CountUp value={s.referees.active} label="Referred people with an active account" /></RailFact>
        </>
      }
    >
      <RailCard title="Whose numbers" labelId="partners-scope" index={5}>
        <p className="text-sm">{scopeNote(access.scope, access.role)}</p>
      </RailCard>
      <StatusCard status={status} index={6} link={false} />
    </StickyRail>
  );
}

/** The panel plus its rail. The rail streams in on its own, so the section never waits for it. */
export function NativeSection({ tab, access, rail, children }: { tab: PartnerTabKey; access: PartnerAccess; rail?: ReactNode; children: ReactNode }) {
  return (
    <>
      {rail ?? (
        <Suspense fallback={<RailSkeleton />}>
          <NativeRail access={access} />
        </Suspense>
      )}
      <WorkspacePanel tab={tab} idPrefix="partners">{children}</WorkspacePanel>
    </>
  );
}
