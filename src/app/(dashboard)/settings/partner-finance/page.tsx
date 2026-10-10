import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { WorkspaceHeading, WorkspacePanel, WorkspaceShell, WorkspaceTabs, tabHref } from "@/components/workspace";
import { isPartnerWorkspaceEnabled } from "@/lib/partners/flag";
import { loadOverrideRules } from "@/lib/partners/overrides/store";
import { loadWorkspaceSettings } from "@/lib/partners/settings";
import { loadTaxRules } from "@/lib/partners/tax/store";
import { buildPendingRows, overrideRuleRows, parseFinanceTab, PARTNER_FINANCE_TABS, taxRuleRows } from "./model";
import { ApprovePanel, OverridesPanel, ReferralsPanel, StatementsPanel, TaxPanel } from "./panels";

export const dynamic = "force-dynamic";

/** Tax rules, override rules, statement letterhead, referral link and query assignee for the partner programme. Admin and Finance. */
export default async function PartnerFinanceSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isPartnerWorkspaceEnabled()) notFound();
  const session = await requireRole(["ADMIN", "FINANCE"]);
  const tab = parseFinanceTab((await searchParams).tab);
  const now = new Date();

  const [taxRules, overrideRules, settings, pending, assignees] = await Promise.all([
    loadTaxRules(prisma as never),
    loadOverrideRules(prisma as never),
    loadWorkspaceSettings(prisma as never),
    prisma.approvalRequest.findMany({ where: { status: "PENDING", actionType: { in: ["PARTNER_TAX_RULE_CHANGE", "PARTNER_OVERRIDE_RULE_CHANGE"] } }, orderBy: { requestedAt: "asc" }, take: 100, select: { id: true, actionType: true, reason: true, requestedAt: true, requestedById: true, requestedBy: { select: { name: true } } } }),
    prisma.user.findMany({ where: { isActive: true, role: { in: ["FINANCE", "ADMIN"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true }, take: 100 }),
  ]);
  const pendingRows = buildPendingRows(pending, session.user.id);

  const tabs = PARTNER_FINANCE_TABS.map((t) => ({ key: t.key, label: t.key === "approve" && pendingRows.length > 0 ? `${t.label} (${pendingRows.length})` : t.label, href: tabHref("/settings/partner-finance", "", t.key, { fallback: "tax" }) }));

  return (
    <WorkspaceShell
      header={<WorkspaceHeading title="Partner finance" description="Tax rules, override rules and statement details for the partner programme. Rule changes are approved by a second person." />}
      tabs={<WorkspaceTabs tabs={tabs} active={tab} idPrefix="pfin" label="Partner finance sections" />}
    >
      <WorkspacePanel tab={tab} idPrefix="pfin">
        {tab === "tax" && <TaxPanel rows={taxRuleRows(taxRules, now)} />}
        {tab === "overrides" && <OverridesPanel rows={overrideRuleRows(overrideRules, now)} />}
        {tab === "statements" && <StatementsPanel settings={settings} />}
        {tab === "referrals" && <ReferralsPanel settings={settings} assignees={assignees} />}
        {tab === "approve" && <ApprovePanel rows={pendingRows} />}
      </WorkspacePanel>
    </WorkspaceShell>
  );
}
