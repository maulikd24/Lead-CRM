import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { RailFact, RailCard, StickyRail } from "@/components/workspace";
import type { PartnerAccess } from "@/lib/partners/access";
import { loadNative, loadNativeSummaryOnce, type Loaded } from "@/lib/partners/load";
import { NATIVE_PAGE_SIZE as size } from "@/lib/partners/native/queries";
import { nativeHref, parseNativeQuery, partnerStatusOf, payoutStatusOf, type NativeQuery } from "@/lib/partners/native/query";
import {
  bankText,
  buildAdjustmentsVM,
  buildCommissionsVM,
  buildNativeOverviewVM,
  buildNetworkVM,
  buildOpenAccrualsVM,
  buildPartnerListVM,
  buildPayoutsVM,
  buildReferredVM,
  buildStatementIndexVM,
  buildStatementVM,
  partnerRowVM,
} from "@/lib/partners/native/view-models";
import { dataStatus } from "@/lib/partners/status";
import { StatusCard } from "../partners-rail";
import { NativeAffiliatesView, NativePartnerDetailView } from "./affiliates";
import { NativeAdjustmentsView, NativeCommissionsView } from "./commissions";
import { NativeNetworkView } from "./network";
import { NativeRail, NativeSection } from "./native-rail";
import { NativeOverviewView } from "./overview";
import { NativePayoutsView } from "./payouts";
import { EmptyReferred, ReferredTable, NativeReferredView } from "./referred";
import { NativeStatementView, NativeStatementsView } from "./statements";
import { formatInr as partnerMoney } from "@/lib/partners/view-models";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** A native read that failed: nothing is shown rather than a guess. The reason stays in the server log, never on the page. */
function NativeError() {
  return (
    <Card role="alert">
      <CardContent>
        <EmptyState icon={AlertTriangle} title="Could not load partner data" description="Nothing is shown rather than guessing. Try again in a moment; if it keeps happening, tell an administrator." />
      </CardContent>
    </Card>
  );
}

function Gate<T>({ loaded, children }: { loaded: Loaded<T>; children: (data: T) => React.ReactNode }) {
  if (loaded.status !== "ok") return <NativeError />;
  return <div className="flex flex-col gap-4">{children(loaded.data)}</div>;
}

export async function NativeOverviewPage({ access }: { access: PartnerAccess }) {
  const loaded = await loadNativeSummaryOnce(access);
  return (
    <NativeSection tab="overview" access={access}>
      <Gate loaded={loaded}>{({ summary, extras }) => <NativeOverviewView vm={buildNativeOverviewVM(summary, extras)} />}</Gate>
    </NativeSection>
  );
}

export async function NativeAffiliatesPage({ access, searchParams }: { access: PartnerAccess; searchParams: SearchParams }) {
  const query = parseNativeQuery(await searchParams);
  const status = partnerStatusOf(query);
  const loaded = await loadNative(access, (p) => p.listPartners({ q: query.q, status, tier: query.tier, offset: query.offset, limit: size }));
  return (
    <NativeSection tab="affiliates" access={access}>
      <Gate loaded={loaded}>{(page) => <NativeAffiliatesView vm={buildPartnerListVM(page, query)} q={query.q} status={status} tier={query.tier} />}</Gate>
    </NativeSection>
  );
}

export async function NativePartnerDetailPage({ access, id }: { access: PartnerAccess; id: string }) {
  const loaded = await loadNative(access, async (p) => {
    const detail = await p.getPartnerDetail(id);
    if (!detail) return null;
    return { detail, referred: await p.listReferred({ partnerId: id, limit: 10 }) };
  });
  if (loaded.status === "ok" && loaded.data === null) notFound();
  const data = loaded.status === "ok" ? loaded.data : null;
  const rail =
    data ? (
      <StickyRail
        label={`${data.detail.row.name}: totals and status`}
        facts={
          <>
            <RailFact label="Earned to date" index={0}>{partnerMoney(data.detail.totals.lifetime)}</RailFact>
            <RailFact label="Pending payout" index={1} tone="warning">{partnerMoney(data.detail.totals.pendingPayout)}</RailFact>
            <RailFact label="Empanelment" index={2}>{partnerRowVM(data.detail.row).status.label}</RailFact>
            <RailFact label="Bank" index={3}>{bankText(data.detail.row).label}</RailFact>
          </>
        }
      >
        <StatusCard status={dataStatus(loaded)} index={4} />
      </StickyRail>
    ) : undefined;
  return (
    <NativeSection tab="affiliates" access={access} rail={rail}>
      <Gate loaded={loaded}>
        {(d) => {
          if (!d) return null;
          const referred = buildReferredVM(d.referred, parseNativeQuery({}));
          return <NativePartnerDetailView row={partnerRowVM(d.detail.row)} detail={d.detail} referred={referred.rows.length === 0 ? <EmptyReferred /> : <ReferredTable rows={referred.rows} showPartner={false} />} />;
        }}
      </Gate>
    </NativeSection>
  );
}


export async function NativeNetworkPage({ access, searchParams }: { access: PartnerAccess; searchParams: SearchParams }) {
  const query = parseNativeQuery(await searchParams);
  const loaded = await loadNative(access, (p) => p.getNetwork({ offset: query.offset, limit: size }));
  return (
    <NativeSection tab="network" access={access}>
      <Gate loaded={loaded}>{(page) => <NativeNetworkView vm={buildNetworkVM(page, query)} />}</Gate>
    </NativeSection>
  );
}

export async function NativeReferredPage({ access, searchParams }: { access: PartnerAccess; searchParams: SearchParams }) {
  const query = parseNativeQuery(await searchParams);
  const loaded = await loadNative(access, (p) => p.listReferred({ q: query.q, segment: query.segment, funnel: query.funnel, partnerId: query.partner, offset: query.offset, limit: size }));
  return (
    <NativeSection tab="referred-users" access={access}>
      <Gate loaded={loaded}>
        {(page) => <NativeReferredView vm={buildReferredVM(page, query)} q={query.q} segment={query.segment} funnel={query.funnel} partner={query.partner} />}
      </Gate>
    </NativeSection>
  );
}

export async function NativeCommissionsPage({ access, searchParams }: { access: PartnerAccess; searchParams: SearchParams }) {
  const query = parseNativeQuery(await searchParams);
  if (query.view === "adjustments") {
    const loaded = await loadNative(access, (p) => p.listAdjustments({ partnerId: query.partner, offset: query.offset, limit: size }));
    return (
      <NativeSection tab="commissions" access={access}>
        <Gate loaded={loaded}>{(page) => <NativeAdjustmentsView vm={buildAdjustmentsVM(page, query)} />}</Gate>
      </NativeSection>
    );
  }
  const loaded = await loadNative(access, (p) => p.listCommissions({ q: query.q, status: query.accrual, partnerId: query.partner, offset: query.offset, limit: size }));
  return (
    <NativeSection tab="commissions" access={access}>
      <Gate loaded={loaded}>{(page) => <NativeCommissionsView vm={buildCommissionsVM(page, query)} q={query.q} accrual={query.accrual} partner={query.partner} />}</Gate>
    </NativeSection>
  );
}

export async function NativePayoutsPage({ access, searchParams }: { access: PartnerAccess; searchParams: SearchParams }) {
  const query = parseNativeQuery(await searchParams);
  const showPayouts = query.view === "payouts" || Boolean(query.run || query.partner || payoutStatusOf(query));
  if (!showPayouts) {
    const loaded = await loadNative(access, (p) => p.listPayoutRuns({ offset: query.offset, limit: size }));
    return (
      <NativeSection tab="payouts" access={access}>
        <Gate loaded={loaded}>{(runs) => <NativePayoutsView vm={buildPayoutsVM({ view: "runs", runs }, query)} />}</Gate>
      </NativeSection>
    );
  }
  const loaded = await loadNative(access, (p) => p.listPayouts({ runId: query.run, partnerId: query.partner, status: payoutStatusOf(query), offset: query.offset, limit: size }));
  return (
    <NativeSection tab="payouts" access={access}>
      <Gate loaded={loaded}>{(payouts) => <NativePayoutsView vm={buildPayoutsVM({ view: "payouts", payouts }, query)} />}</Gate>
    </NativeSection>
  );
}

export async function NativeStatementsPage({ access, searchParams }: { access: PartnerAccess; searchParams: SearchParams }) {
  const sp = await searchParams;
  const query: NativeQuery = parseNativeQuery(sp);
  const openView = (Array.isArray(sp.view) ? sp.view[0] : sp.view) === "open";
  const chips = [
    { key: "runs", label: "By payout run", active: !openView, href: nativeHref("/partners/statements", {}) },
    { key: "open", label: "Open accruals", active: openView, href: nativeHref("/partners/statements", { view: "open" }) },
  ];
  if (openView) {
    const loaded = await loadNative(access, (p) => p.listOpenAccruals({ offset: query.offset, limit: size }));
    return (
      <NativeSection tab="statements" access={access}>
        <Gate loaded={loaded}>{(page) => <NativeStatementsView chips={chips} open={buildOpenAccrualsVM(page)} />}</Gate>
      </NativeSection>
    );
  }
  const loaded = await loadNative(access, (p) => p.listPayouts({ runId: query.run, q: query.q, offset: query.offset, limit: size }));
  return (
    <NativeSection tab="statements" access={access}>
      <Gate loaded={loaded}>{(page) => <NativeStatementsView chips={chips} index={buildStatementIndexVM(page, query)} />}</Gate>
    </NativeSection>
  );
}

export async function NativeStatementPage({ access, partnerId, searchParams }: { access: PartnerAccess; partnerId: string; searchParams: SearchParams }) {
  const query = parseNativeQuery(await searchParams);
  const run = query.run ?? "open";
  const loaded = await loadNative(access, (p) => p.getStatement(partnerId, run));
  if (loaded.status === "ok" && loaded.data === null) notFound();
  const vm = loaded.status === "ok" && loaded.data ? buildStatementVM(loaded.data, { offset: query.offset, pageSize: 25 }) : null;
  const rail = vm ? (
    <StickyRail
      label="Statement summary"
      facts={
        <>
          <RailFact label="Net payable" index={0} tone={vm.totals.negativeNet ? "destructive" : "success"}>{vm.totals.net}</RailFact>
          <RailFact label="Accruals" index={1}>{vm.totals.gross}</RailFact>
          <RailFact label="Adjustments" index={2}>{vm.totals.adjustments}</RailFact>
          <RailFact label="Bank" index={3}>{vm.bank.label}{vm.bank.tail ? ` ${vm.bank.tail}` : ""}</RailFact>
        </>
      }
    >
      <RailCard title="Estimates only" labelId="stmt-note" index={4}>
        <p className="text-xs text-muted-foreground">This system estimates commission and never moves money. Tax is not calculated here.</p>
      </RailCard>
    </StickyRail>
  ) : undefined;
  return (
    <NativeSection tab="statements" access={access} rail={rail ?? <NativeRail access={access} />}>
      <Gate loaded={loaded}>
        {() =>
          vm ? <NativeStatementView vm={vm} pageHref={(offset) => nativeHref(`/partners/statements/${encodeURIComponent(partnerId)}`, { run, offset })} /> : null
        }
      </Gate>
    </NativeSection>
  );
}
