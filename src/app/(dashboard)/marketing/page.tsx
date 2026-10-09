import Link from "next/link";
import { notFound } from "next/navigation";
import { Megaphone, Plug } from "lucide-react";

import { requireRole } from "@/lib/auth/require-role";
import { marketingPageEnabled } from "@/lib/marketing/flags";
import { loadMarketingPage } from "@/lib/marketing/report";
import { formatCount, formatMoney, parseRange } from "@/lib/marketing/view-model";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";

import { CampaignTable } from "./campaign-table";
import { Funnel } from "./funnel";
import { KpiTiles, type Kpi } from "./kpi-tiles";
import styles from "./marketing.module.css";
import { RangeControl } from "./range-control";
import { SpendFundedChart } from "./spend-funded-chart";
import { StatusBanners } from "./status-banners";
import { UnattributedCard } from "./unattributed-card";

export const dynamic = "force-dynamic";

export default async function MarketingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!marketingPageEnabled()) notFound();
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const params = await searchParams;
  const data = await loadMarketingPage((today) => parseRange(params, today));
  const { report, connection, range } = data;

  const header = (
    <PageHeader
      title="Marketing"
      description="What your Meta ads cost and what they bring in, from the click to a funded customer. Read-only: nothing here changes a campaign or sends anything back to Meta."
      actions={
        connection.lastSyncLabel ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span aria-hidden className={`${styles.liveDot} inline-block size-2 rounded-full bg-primary`} />
            {`Last sync ${connection.lastSyncLabel}`}
          </p>
        ) : undefined
      }
    />
  );

  if (connection.state === "not_connected" || !report) {
    const isAdmin = session.user.role === "ADMIN";
    return (
      <div className="flex flex-col gap-6">
        {header}
        <StatusBanners banners={connection.banners} />
        <Card>
          <CardContent>
            <EmptyState
              icon={Plug}
              title="Meta Ads is not connected"
              description={isAdmin ? "Connect an ad account in Apps & Integrations. It takes a read-only token, and once connected the numbers fill in here after the first sync." : "Ask an Admin to connect the ad account in Apps & Integrations. Once connected, the numbers fill in here after the first sync."}
              action={isAdmin ? { label: "Open Apps & Integrations", href: "/settings/integrations" } : undefined}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const t = report.totals;
  const currency = report.currency;

  if (connection.state === "waiting") {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <StatusBanners banners={connection.banners} />
        <Card>
          <CardContent>
            <EmptyState icon={Megaphone} title="Waiting for the first sync" description="No ad spend has been pulled in yet. This page fills in after the first successful sync." />
          </CardContent>
        </Card>
      </div>
    );
  }

  const kpis: Kpi[] = [
    { key: "spend", label: "Spend", value: t.spend, kind: "money", hint: `${formatCount(t.impressions)} impressions` },
    { key: "leads", label: "Leads in the CRM", value: t.crmLeads, kind: "count", hint: `Meta reports ${formatCount(t.metaLeads)}` },
    { key: "cpl", label: "Cost per lead", value: t.cpl, kind: "money", hint: "Spend ÷ CRM leads" },
    { key: "cpk", label: "Cost per approved KYC", value: t.costPerKyc, kind: "money", hint: `${formatCount(t.kyc)} approved` },
    { key: "cpf", label: "Cost per funded customer", value: t.costPerFunded, kind: "money", hint: `${formatCount(t.funded)} funded`, tone: t.funded > 0 ? "success" : undefined },
    { key: "aum", label: "Funded AUM per ₹ spent", value: t.aumPerRupee, kind: "ratio", hint: t.roas !== null ? `Revenue return ${t.roas.toFixed(2)}× (indicative)` : `${formatMoney(t.aum, "INR")} AUM` },
  ];
  const hasSpend = report.campaigns.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {header}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <RangeControl range={range} today={data.today} />
        <p className="text-xs text-muted-foreground">{`${report.range.from} to ${range.to}, days in the ad account's timezone (${data.timezone}). Up to 90 days can be shown.`}</p>
      </div>
      <StatusBanners banners={[...connection.banners, ...report.notes]} />

      {!hasSpend && report.totals.crmLeads === 0 ? (
        <Card>
          <CardContent>
            <EmptyState icon={Megaphone} title="No spend or Meta leads in this range" description="Try a longer range. If this stays empty while ads are running, check the sync status above." />
          </CardContent>
        </Card>
      ) : (
        <>
          <KpiTiles kpis={kpis} currency={currency} />
          <Funnel steps={report.funnel} />
          <SpendFundedChart daily={report.daily} currency={currency} />
          <CampaignTable campaigns={report.campaigns} currency={currency} />
          <UnattributedCard unattributed={report.unattributed} excluded={report.excluded} totalLeads={t.crmLeads} currency={currency} />
          <p className="text-xs text-muted-foreground">
            Outcomes follow the leads created in the range, wherever those customers are today, so recent days look weaker than they will once those leads have had time to complete KYC and fund.{" "}
            {session.user.role === "ADMIN" && (
              <Link href="/settings/integrations" className="underline underline-offset-4">Connection settings</Link>
            )}
          </p>
        </>
      )}
    </div>
  );
}
