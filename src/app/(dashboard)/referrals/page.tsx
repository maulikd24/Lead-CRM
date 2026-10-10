import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { CountUp, KpiStrip, KpiTile, TabbedWorkspace, lazyPanels } from "@/components/workspace";
import type { Role } from "@/generated/prisma/client";
import { requireRole } from "@/lib/auth/require-role";
import { can } from "@/lib/referrals/permissions";
import { referralEnabled } from "@/lib/referrals/flag";
import { formatRupees } from "@/lib/referrals/summary";
import { loadLedger, loadOverview, loadReferrers, loadRules, loadStatements } from "@/lib/referrals/views";

import { RefreshButton } from "./controls";
import { OverviewTab } from "./overview-tab";
import { ReferrersTab } from "./referrers-tab";
import { RewardsTab } from "./rewards-tab";
import { RulesTab } from "./rules-tab";
import { StatementsTab } from "./statements-tab";
import { REFERRAL_TAB_KEYS } from "./tabs";

export const dynamic = "force-dynamic";

async function OverviewSection({ overview }: { overview: Awaited<ReturnType<typeof loadOverview>> }) {
  return <OverviewTab data={overview} hasRules={(await loadRules()).rules.some((r) => r.active)} />;
}
async function ReferrersSection({ role }: { role: Role }) {
  return <ReferrersTab rows={await loadReferrers()} canManage={can(role, "manage_referrers")} />;
}
async function RewardsSection({ role }: { role: Role }) {
  const l = await loadLedger();
  return <RewardsTab rows={l.rows} total={l.total} canAct={can(role, "reverse_entry")} />;
}
async function RulesSection({ role }: { role: Role }) {
  const r = await loadRules();
  return <RulesTab rules={r.rules} disclaimer={r.disclaimer} velocityLimit={r.velocityLimit} linkBaseConfigured={r.linkBaseConfigured} canEdit={can(role, "manage_rules")} />;
}
async function StatementsSection({ role, now, viewerId }: { role: Role; now: Date; viewerId: string }) {
  const s = await loadStatements(now);
  return <StatementsTab period={s.period} ready={s.ready} statements={s.statements} canPrepare={can(role, "prepare_statement")} canApprove={can(role, "approve_statement")} viewerId={viewerId} />;
}

export default async function ReferralsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  if (!referralEnabled()) notFound();
  const session = await requireRole(["ADMIN", "FINANCE"]);
  const role = session.user.role as Role;
  const { tab: rawTab } = await searchParams;
  const now = new Date();
  const overview = await loadOverview(now);
  const owed = overview.ledger.accrued.paise + overview.ledger.approved.paise;

  return (
    <TabbedWorkspace
      idPrefix="referrals"
      label="Referral sections"
      lazy
      tabs={[
        { key: "overview", label: "Overview" },
        { key: "referrers", label: "Referrers", count: overview.referrers },
        { key: "rewards", label: "Rewards ledger", count: overview.needsReview },
        { key: "rules", label: "Rules" },
        { key: "statements", label: "Statements" },
      ]}
      panels={lazyPanels(REFERRAL_TAB_KEYS, rawTab, "overview", {
        overview: () => <OverviewSection overview={overview} />,
        referrers: () => <ReferrersSection role={role} />,
        rewards: () => <RewardsSection role={role} />,
        rules: () => <RulesSection role={role} />,
        statements: () => <StatementsSection role={role} now={now} viewerId={session.user.id} />,
      })}
      header={
        <>
          <PageHeader title="Referrals" description="Customers who refer friends, the rewards your rules create, and monthly statements two people approve. Nothing is sent and no money moves from here." actions={can(role, "refresh") ? <RefreshButton /> : undefined} />
          <KpiStrip label="Referral figures">
            <KpiTile label="Referred" index={0}><CountUp value={overview.funnel.referrals} /></KpiTile>
            <KpiTile label="KYC complete" index={1}><CountUp value={overview.funnel.kyc} /></KpiTile>
            <KpiTile label="Funded" index={2}><CountUp value={overview.funnel.funded} /></KpiTile>
            <KpiTile label="To review" index={3} tone={overview.needsReview > 0 ? "warning" : "default"} href="?tab=rewards"><CountUp value={overview.needsReview} /></KpiTile>
            <KpiTile label="Owed, not yet paid" index={4} hint="accrued and approved"><span>{formatRupees(owed)}</span></KpiTile>
          </KpiStrip>
        </>
      }
    />
  );
}
