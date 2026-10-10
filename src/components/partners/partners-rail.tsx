import Link from "next/link";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { CountUp, RailCard, RailFact, StickyRail, WorkspacePanel } from "@/components/workspace";
import { loadSummaryOnce } from "@/lib/partners/load";
import { dataStatus, type DataStatus } from "@/lib/partners/status";
import type { PartnerTabKey } from "@/lib/partners/tabs";
import { buildOverviewVM, type buildReferrerDetailVM } from "@/lib/partners/view-models";
import { InrCountUp } from "./inr-count-up";
import { RailSkeleton } from "./states";
import { ToneBadge } from "./tone-badge";

const TONE_TEXT = { default: "", success: "text-success", warning: "text-warning", destructive: "text-destructive" } as const;

/** The verification status block: what the numbers are and how far to trust them, with a way to the Contract check. */
export function StatusCard({ status, index = 0, link = true }: { status: DataStatus; index?: number; link?: boolean }) {
  return (
    <RailCard title="Data status" labelId="partners-status" index={index}>
      <p className={`flex items-center gap-2 text-sm font-medium ${TONE_TEXT[status.tone]}`}>
        <span aria-hidden className="inline-block size-2 shrink-0 rounded-full bg-current" />
        {status.label}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{status.hint}</p>
      {link && <Link href="/partners/contract" className="mt-2 inline-block text-xs font-medium underline underline-offset-4">Open the contract check</Link>}
    </RailCard>
  );
}

/** Programme totals and verification status, beside every programme-wide section. Shares the summary request with the Overview. */
export async function PartnersRail({ onContractCheck = false }: { onContractCheck?: boolean }) {
  const loaded = await loadSummaryOnce();
  const status = dataStatus(loaded);
  if (loaded.status !== "ok") return <StickyRail><StatusCard status={status} link={!onContractCheck} /></StickyRail>;
  const kpis = buildOverviewVM(loaded.data).kpis;
  return (
    <StickyRail
      label="Programme totals and data status"
      facts={kpis.map((k, i) => (
        <RailFact key={k.key} label={k.label} index={i} tone={k.tone} hint={k.hint} live={k.key === "pending" && (k.value ?? 0) > 0}>
          {k.format === "inr" ? <InrCountUp value={k.value} label={k.label} /> : <CountUp value={k.value} label={k.label} />}
        </RailFact>
      ))}
    >
      <StatusCard status={status} index={kpis.length} link={!onContractCheck} />
    </StickyRail>
  );
}

/** One affiliate's totals and verification, in place of the programme rail on an affiliate's page. */
export function AffiliateRail({ vm, status }: { vm: ReturnType<typeof buildReferrerDetailVM>; status: DataStatus }) {
  return (
    <StickyRail
      label={`${vm.name}: totals and verification`}
      facts={
        <>
          <RailFact label="Lifetime earnings" index={0}>{vm.earningsTotal}</RailFact>
          {vm.money.map((m, i) => (
            <RailFact key={m.label} label={m.label} index={i + 1} hint={m.label === "Paid out" ? `${vm.payoutLine}. Last paid ${vm.lastPaid}.` : undefined}>{m.value}</RailFact>
          ))}
          <RailFact label="KYC" index={4}><ToneBadge badge={vm.kyc} /></RailFact>
          <RailFact label="Status" index={5}><ToneBadge badge={vm.status} /></RailFact>
        </>
      }
    >
      <StatusCard status={status} index={6} />
    </StickyRail>
  );
}

/** The panel plus its rail. The rail streams in on its own, so the section never waits for it. */
export function PartnerSection({ tab, rail, busy, children }: { tab: PartnerTabKey; rail?: ReactNode; busy?: boolean; children: ReactNode }) {
  return (
    <>
      {rail ?? (
        <Suspense fallback={<RailSkeleton />}>
          <PartnersRail onContractCheck={tab === "contract"} />
        </Suspense>
      )}
      <WorkspacePanel tab={tab} idPrefix="partners" busy={busy}>
        {children}
      </WorkspacePanel>
    </>
  );
}
