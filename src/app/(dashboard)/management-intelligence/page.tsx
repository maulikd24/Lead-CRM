import Link from "next/link";
import { format } from "date-fns";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAccess } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { SUPPORTED_QUESTIONS } from "@/lib/intelligence/ask-intents";
import { getAuditQuality, getFunnel, getNbaCounts, getSegmentCounts, getTeamFollowups, listCustomers, managementScope } from "@/lib/intelligence/management";
import { buildFunnelPanel, buildOpportunitiesPanel, buildQualityPanel, buildTeamPanel } from "@/lib/intelligence/management-panels";
import { formatNumber } from "@/lib/utils/format";
import { AskPanel } from "./ask-panel";

export const metadata = { title: "Management Intelligence" };

const SEVERITY_VARIANT: Record<string, "destructive" | "secondary" | "outline"> = { HIGH: "destructive", MEDIUM: "secondary", LOW: "outline" };

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
        <CardTitle className="text-base">{title}</CardTitle>
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
  const session = await requireAccess("intelligence");
  const visible = await getVisibleUserIds(session.user.id, session.user.role);
  const scope = managementScope(visible, session.user.role === "MANAGER");
  const now = new Date();

  const [funnel, team, highPriority, reviewDue, segments, programmes, quality] = await Promise.all([
    getFunnel(scope),
    getTeamFollowups(scope),
    listCustomers(scope, { nbaPriority: "High" }, 10),
    listCustomers(scope, { client: { segmentMemberships: { some: { segment: "review_due", exitedAt: null } } } }, 10),
    getSegmentCounts(scope),
    getNbaCounts(scope),
    getAuditQuality(scope),
  ]);

  const funnelPanel = buildFunnelPanel({ totals: funnel.totals, bySource: funnel.bySource }, now);
  const teamPanel = buildTeamPanel({ rms: team.rms, unassigned: team.unassigned }, now);
  const oppPanel = buildOpportunitiesPanel({ highPriority, segments, programmes, reviewDue }, now);
  const qualityPanel = buildQualityPanel({ byCategory: quality.byCategory, bySeverity: quality.bySeverity, openRows: quality.openRows }, now);

  const t = funnelPanel.totals;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Management Intelligence" description="Funnel, team, opportunities and quality for your customers. Read only. Each panel names its source and when it was read." />

      <AskPanel supported={SUPPORTED_QUESTIONS} />

      <PanelFrame title="Funnel" description="Leads and signups, through KYC and funding, to activation." source={funnelPanel.source} asOf={funnelPanel.asOf}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Leads and signups" value={formatNumber(t.leads)} />
          <StatCard label="KYC approved" value={`${formatNumber(t.kyc)} · ${share(funnelPanel.shareOfLeads.kyc)}`} />
          <StatCard label="Funded" value={`${formatNumber(t.funded)} · ${share(funnelPanel.shareOfLeads.funded)}`} />
          <StatCard label="Activated" value={`${formatNumber(t.activated)} · ${share(funnelPanel.shareOfLeads.activated)}`} tone="success" />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Leads</TableHead>
              <TableHead>KYC %</TableHead>
              <TableHead>Funded %</TableHead>
              <TableHead>Activated %</TableHead>
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
          <TableHeader>
            <TableRow>
              <TableHead>RM</TableHead>
              <TableHead>Pending</TableHead>
              <TableHead>Overdue</TableHead>
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
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">High-priority customers</p>
            <ul className="divide-y text-sm">
              {oppPanel.highPriority.rows.length === 0 && <li className="py-3 text-muted-foreground">None right now.</li>}
              {oppPanel.highPriority.rows.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <Link href={`/clients/${c.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                    {c.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {c.programme} · {c.timing} · RM: {c.rm ?? "unassigned"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Next best action, by programme</p>
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
          <TableHeader>
            <TableRow>
              <TableHead>Severity</TableHead>
              <TableHead>Finding</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Detected</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {qualityPanel.topOpen.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                  No open findings.
                </TableCell>
              </TableRow>
            )}
            {qualityPanel.topOpen.map((f) => (
              <TableRow key={f.id}>
                <TableCell>
                  <Badge variant={SEVERITY_VARIANT[f.severity] ?? "outline"}>{label(f.severity)}</Badge>
                </TableCell>
                <TableCell className="text-sm">
                  <span className="font-medium">{label(f.category)}</span>
                  <span className="block text-xs text-muted-foreground">{f.summary}</span>
                </TableCell>
                <TableCell className="text-sm">
                  {f.clientId ? (
                    <Link href={`/clients/${f.clientId}`} className="text-primary underline-offset-2 hover:underline">
                      {f.client ?? "Customer"}
                    </Link>
                  ) : (
                    "—"
                  )}
                  <span className="block text-xs text-muted-foreground">RM: {f.rm ?? "unassigned"}</span>
                </TableCell>
                <TableCell className="text-sm">{format(new Date(f.detectedAt), "d MMM yyyy")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </PanelFrame>
    </div>
  );
}
