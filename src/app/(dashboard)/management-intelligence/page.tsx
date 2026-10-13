import { format } from "date-fns";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { SUPPORTED_QUESTIONS } from "@/lib/intelligence/ask-intents";
import { getAuditQuality, getFunnel, getNbaCounts, getSegmentCounts, getTeamFollowups, listCustomers, managementScope } from "@/lib/intelligence/management";
import { buildFunnelPanel, buildOpportunitiesPanel, buildQualityPanel, buildTeamPanel } from "@/lib/intelligence/management-panels";
import { MANAGEMENT_INTEL_AREA, managementIntelEnabled } from "@/lib/management/gate";
import { formatNumber } from "@/lib/utils/format";
import { AskPanel } from "./ask-panel";

export const metadata = { title: "Management Intelligence" };

/**
 * Aggregates only (access/policy.ts "management-intelligence"): counts and rates, never a customer name, code or row.
 * Behind MANAGEMENT_INTEL_ENABLED (notFound when off) and the area's role check (Admin and Manager).
 */

const label = (value: string) => {
  const words = value.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const share = (value: number | null) => (value === null ? "—" : `${value}%`);
const stamp = (iso: string) => format(new Date(iso), "d MMM yyyy, HH:mm");

function PanelFrame({ title, description, source, asOf, children }: { title: string; description: string; source: string; asOf: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-semibold leading-none">{title}</h2>
        <CardDescription>{description}</CardDescription>
        <p className="text-xs text-muted-foreground">
          Source: {source}. As of {stamp(asOf)}.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

export default async function ManagementIntelligencePage() {
  const session = await requireAccess(MANAGEMENT_INTEL_AREA);
  if (!managementIntelEnabled()) notFound();
  const visible = await getVisibleUserIds(session.user.id, session.user.role);
  const scope = managementScope(visible, session.user.role === "MANAGER");
  const now = new Date();

  const [funnel, team, highPriority, reviewDue, segments, programmes, quality] = await Promise.all([
    getFunnel(scope),
    getTeamFollowups(scope),
    listCustomers(scope, { nbaPriority: "High" }, 1),
    listCustomers(scope, { client: { segmentMemberships: { some: { segment: "review_due", exitedAt: null } } } }, 1),
    getSegmentCounts(scope),
    getNbaCounts(scope),
    getAuditQuality(scope),
  ]);

  const funnelPanel = buildFunnelPanel({ totals: funnel.totals, bySource: funnel.bySource }, now);
  const teamPanel = buildTeamPanel({ rms: team.rms, unassigned: team.unassigned }, now);
  const oppPanel = buildOpportunitiesPanel({ highPriority: { total: highPriority.total }, segments, programmes, reviewDue: { total: reviewDue.total } }, now);
  const qualityPanel = buildQualityPanel({ byCategory: quality.byCategory, bySeverity: quality.bySeverity }, now);

  const t = funnelPanel.totals;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Management Intelligence" description="Funnel, team, opportunities and quality, as counts and rates. Read only. Each panel names its source and when it was read." />

      <AskPanel supported={SUPPORTED_QUESTIONS} />

      <PanelFrame title="Funnel" description="Leads and signups, through KYC and funding, to activation." source={funnelPanel.source} asOf={funnelPanel.asOf}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Leads and signups" value={formatNumber(t.leads)} />
          <StatCard label="KYC approved" value={`${formatNumber(t.kyc)} · ${share(funnelPanel.shareOfLeads.kyc)}`} />
          <StatCard label="Funded" value={`${formatNumber(t.funded)} · ${share(funnelPanel.shareOfLeads.funded)}`} />
          <StatCard label="Activated" value={`${formatNumber(t.activated)} · ${share(funnelPanel.shareOfLeads.activated)}`} tone="success" />
        </div>
        <Table>
          <TableCaption className="sr-only">Funnel conversion by lead source</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Source</TableHead>
              <TableHead scope="col">Leads</TableHead>
              <TableHead scope="col">KYC %</TableHead>
              <TableHead scope="col">Funded %</TableHead>
              <TableHead scope="col">Activated %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {funnelPanel.bySource.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  No customers in scope yet.
                </TableCell>
              </TableRow>
            )}
            {funnelPanel.bySource.map((s) => (
              <TableRow key={s.label}>
                <TableCell className="text-sm">{s.label}</TableCell>
                <TableCell>{s.leads}</TableCell>
                <TableCell>{share(s.kycPct)}</TableCell>
                <TableCell>{share(s.fundedPct)}</TableCell>
                <TableCell>{share(s.activatedPct)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </PanelFrame>

      <PanelFrame title="Team" description="RM follow-ups that are still open or overdue, and customers with no RM." source={teamPanel.source} asOf={teamPanel.asOf}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Pending follow-ups" value={formatNumber(teamPanel.pendingFollowUps)} />
          <StatCard label="Overdue follow-ups" value={formatNumber(teamPanel.overdueFollowUps)} tone={teamPanel.overdueFollowUps > 0 ? "warning" : "default"} />
          <StatCard label="RMs with overdue" value={formatNumber(teamPanel.rmsWithOverdue)} tone={teamPanel.rmsWithOverdue > 0 ? "warning" : "default"} />
          <StatCard label="Unassigned customers" value={formatNumber(teamPanel.unassignedCustomers)} />
        </div>
        <Table>
          <TableCaption className="sr-only">Open and overdue follow-ups by RM</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">RM</TableHead>
              <TableHead scope="col">Pending</TableHead>
              <TableHead scope="col">Overdue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teamPanel.rms.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                  No open follow-ups.
                </TableCell>
              </TableRow>
            )}
            {teamPanel.rms.map((r) => (
              <TableRow key={r.rm}>
                <TableCell className="text-sm font-medium">{r.rm}</TableCell>
                <TableCell>{r.pending}</TableCell>
                <TableCell className={r.overdue > 0 ? "text-destructive" : ""}>{r.overdue}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </PanelFrame>

      <PanelFrame title="Opportunities" description="High-priority customers, dormant and cross-sell segments, and portfolio reviews due." source={oppPanel.source} asOf={oppPanel.asOf}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="High priority" value={formatNumber(oppPanel.highPriority.total)} />
          <StatCard label="Dormant" value={formatNumber(oppPanel.dormant)} />
          <StatCard label="Cross-sell" value={formatNumber(oppPanel.crossSell)} />
          <StatCard label="Portfolio review due" value={formatNumber(oppPanel.portfolioReviewDue.total)} />
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Next best action, by programme</h3>
          <ul className="divide-y text-sm">
            {oppPanel.programmes.length === 0 && <li className="py-3 text-muted-foreground">No programme has a High or Medium priority action.</li>}
            {oppPanel.programmes.map((p) => (
              <li key={p.programme} className="flex items-center justify-between gap-2 py-1.5">
                <span>{p.programme}</span>
                <span className="tabular-nums text-muted-foreground">{p.count}</span>
              </li>
            ))}
          </ul>
        </div>
      </PanelFrame>

      <PanelFrame title="Quality" description="Open audit findings for customers in scope, by what was found." source={qualityPanel.source} asOf={qualityPanel.asOf}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Complaints" value={formatNumber(qualityPanel.tiles.complaints)} tone={qualityPanel.tiles.complaints > 0 ? "warning" : "default"} />
          <StatCard label="Audit failures" value={formatNumber(qualityPanel.tiles.auditFailures)} />
          <StatCard label="Missed commitments" value={formatNumber(qualityPanel.tiles.missedCommitments)} />
          <StatCard label="Compliance flags" value={formatNumber(qualityPanel.tiles.complianceFlags)} tone={qualityPanel.tiles.complianceFlags > 0 ? "destructive" : "default"} />
        </div>
        <p className="text-xs text-muted-foreground">
          {formatNumber(qualityPanel.openTotal)} open in total ({qualityPanel.bySeverity.HIGH} high, {qualityPanel.bySeverity.MEDIUM} medium, {qualityPanel.bySeverity.LOW} low).
          {qualityPanel.otherOpen > 0 ? ` ${qualityPanel.otherOpen} more are in other categories.` : ""}
        </p>
        <Table>
          <TableCaption className="sr-only">Open audit findings by category</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Category</TableHead>
              <TableHead scope="col">Open</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {qualityPanel.categories.length === 0 && (
              <TableRow>
                <TableCell colSpan={2} className="py-6 text-center text-muted-foreground">
                  No open findings.
                </TableCell>
              </TableRow>
            )}
            {qualityPanel.categories.map((c) => (
              <TableRow key={c.category}>
                <TableCell className="text-sm">{label(c.category)}</TableCell>
                <TableCell className="tabular-nums">{c.open}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </PanelFrame>
    </div>
  );
}
