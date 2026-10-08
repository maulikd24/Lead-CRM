import Link from "next/link";

import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LIFECYCLE_STAGES } from "@/lib/intelligence/constants";
import { getFunnel, getLifecycleCounts, getLostOpportunities, getNbaCounts, getQuality, getSegmentCounts, getTeamFollowups, listCustomers, managementScope } from "@/lib/intelligence/management";
import { formatNumber } from "@/lib/utils/format";
import { AskBox } from "./ask-box";

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");
const KIND_LABEL: Record<string, string> = { COMPLAINT: "Complaint", COMPLIANCE_CONCERN: "Compliance", INCORRECT_INFO: "Incorrect info" };

export default async function IntelligencePage() {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const visible = await getVisibleUserIds(session.user.id, session.user.role);
  const scope = managementScope(visible, session.user.role === "MANAGER");

  const [funnel, lifecycle, segments, nbaCounts, team, quality, lost, priority] = await Promise.all([
    getFunnel(scope),
    getLifecycleCounts(scope),
    getSegmentCounts(scope),
    getNbaCounts(scope),
    getTeamFollowups(scope),
    getQuality(scope),
    getLostOpportunities(scope),
    listCustomers(scope, { nbaPriority: "High" }, 10),
  ]);
  const { totals } = funnel;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Customer Intelligence" description="One view of the funnel, the team, the opportunities and the quality of customer conversations — from every customer, not only new leads." />

      <AskBox />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Funnel</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Leads & signups" value={formatNumber(totals.leads)} />
          <StatCard label="KYC approved" value={`${formatNumber(totals.kyc)} · ${pct(totals.kyc, totals.leads)}`} />
          <StatCard label="Funded" value={`${formatNumber(totals.funded)} · ${pct(totals.funded, totals.leads)}`} />
          <StatCard label="Activated (traded)" value={`${formatNumber(totals.activated)} · ${pct(totals.activated, totals.leads)}`} tone="success" />
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conversion by source</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Customers</TableHead>
                  <TableHead>KYC</TableHead>
                  <TableHead>Funded</TableHead>
                  <TableHead>Activated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {funnel.bySource.map((row) => (
                  <TableRow key={row.label}>
                    <TableCell className="text-sm font-medium">{row.label}</TableCell>
                    <TableCell>{row.leads}</TableCell>
                    <TableCell>{row.kyc} <span className="text-xs text-muted-foreground">{pct(row.kyc, row.leads)}</span></TableCell>
                    <TableCell>{row.funded} <span className="text-xs text-muted-foreground">{pct(row.funded, row.leads)}</span></TableCell>
                    <TableCell>{row.activated} <span className="text-xs text-muted-foreground">{pct(row.activated, row.leads)}</span></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <div className="flex flex-wrap gap-2 text-sm">
          {LIFECYCLE_STAGES.map((stage) => (
            <Link key={stage} href={`/clients?lifecycle=${encodeURIComponent(stage)}`} className="rounded-md border px-2.5 py-1 hover:bg-muted">
              {stage}: <strong>{lifecycle[stage] ?? 0}</strong>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Team</CardTitle>
            <CardDescription>{team.unassigned} unassigned customer{team.unassigned === 1 ? "" : "s"} · open and overdue follow-ups per RM</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>RM</TableHead>
                  <TableHead>Open follow-ups</TableHead>
                  <TableHead>Overdue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {team.rms.map((r) => (
                  <TableRow key={r.rm}>
                    <TableCell className="text-sm">{r.rm}</TableCell>
                    <TableCell>{r.open}</TableCell>
                    <TableCell className={r.overdue > 0 ? "font-medium text-destructive" : ""}>{r.overdue}</TableCell>
                  </TableRow>
                ))}
                {team.rms.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-4 text-center text-sm text-muted-foreground">No open follow-ups.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quality</CardTitle>
            <CardDescription>What conversations and audits are flagging</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <StatCard label="Open complaints" value={quality.complaints} tone={quality.complaints > 0 ? "destructive" : "default"} />
              <StatCard label="Compliance flags" value={quality.complianceFlags} tone={quality.complianceFlags > 0 ? "warning" : "default"} />
              <StatCard label="Promises overdue" value={quality.overdueCommitments} tone={quality.overdueCommitments > 0 ? "warning" : "default"} />
              <StatCard label="Audit failures (30d)" value={quality.auditFailures} tone={quality.auditFailures > 0 ? "warning" : "default"} />
              <StatCard label="Missed opportunities" value={quality.missedOpportunities} />
            </div>
            {quality.recent.length > 0 && (
              <ul className="divide-y text-sm">
                {quality.recent.map((r) => (
                  <li key={r.id} className="py-1.5">
                    <Badge variant={r.kind === "COMPLAINT" ? "destructive" : "warning"}>{KIND_LABEL[r.kind] ?? r.kind}</Badge>{" "}
                    <Link href={`/clients/${r.clientId}`} className="font-medium text-primary underline-offset-2 hover:underline">{r.client}</Link>
                    <span className="text-muted-foreground"> — {r.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Opportunities & journeys</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          {segments.map((s) => (
            <Link key={s.key} href={`/clients?segment=${s.key}`} className="rounded-md border px-2.5 py-1 hover:bg-muted">
              {s.label}: <strong>{s.count}</strong>
            </Link>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">High-priority customers</CardTitle>
              <CardDescription>{priority.total} in total — top 10 shown</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {priority.rows.map((c) => (
                  <li key={c.id} className="py-1.5">
                    <Link href={`/clients/${c.id}`} className="font-medium text-primary underline-offset-2 hover:underline">{c.name}</Link>
                    <span className="text-muted-foreground"> · {c.programme}{c.topic ? ` (${c.topic})` : ""} · {c.rm ?? "Unassigned"} · {c.timing}</span>
                  </li>
                ))}
                {priority.rows.length === 0 && <li className="py-2 text-muted-foreground">Nothing is high priority right now.</li>}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What to act on</CardTitle>
              <CardDescription>Customers by recommended next action (high and medium priority)</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {nbaCounts.map((n) => (
                  <li key={n.programme} className="flex items-center justify-between py-1.5">
                    <Link href={`/clients?nba=${encodeURIComponent(n.programme)}`} className="text-primary underline-offset-2 hover:underline">{n.programme}</Link>
                    <strong>{n.count}</strong>
                  </li>
                ))}
                {nbaCounts.length === 0 && <li className="py-2 text-muted-foreground">No recommendations yet — they appear as customers are analysed.</li>}
              </ul>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lost opportunities (last 90 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {lost.map((o) => (
                <li key={o.id} className="py-1.5">
                  <Link href={`/clients/${o.clientId}`} className="font-medium text-primary underline-offset-2 hover:underline">{o.client}</Link>
                  <span className="text-muted-foreground"> · {o.product.replace(/_/g, " ").toLowerCase()} · ₹{formatNumber(o.value)} · {o.reason ?? "no reason recorded"}</span>
                </li>
              ))}
              {lost.length === 0 && <li className="py-2 text-muted-foreground">None.</li>}
            </ul>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
