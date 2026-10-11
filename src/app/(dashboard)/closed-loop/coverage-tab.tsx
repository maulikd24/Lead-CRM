import { Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiStrip, KpiTile } from "@/components/workspace";
import { getCampaignOutcomeProvider } from "@/lib/attribution";
import { adsMeasurementNotice } from "@/lib/consent/policy";
import { loadApprovedAdsNotice } from "@/lib/closedloop/db";
import { REASON_TEXT, type BlockReason } from "@/lib/closedloop/gate";
import { loadCampaignFunnel } from "@/lib/closedloop/outcomes";
import { shareOf } from "@/lib/closedloop/summary";
import { loadConsentFacts, loadEventCoverage, loadPendingChanges } from "@/lib/closedloop/views-db";

import { NoticeForm } from "./notice-form";

const SHOWN = 12;
const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 100)}%`);
const reasonText = (r: string) => REASON_TEXT[r as BlockReason] ?? (r === "TOO_OLD" ? "Too old for the platform to accept." : r === "UNKNOWN" ? "No reason recorded." : r);

/**
 * Counts only: who has agreed (the consent ledger), what became of the events the closed loop detected, and the funded customers by campaign read from the shared
 * outcome provider (this screen never counts funded itself). No names, phones, emails, PAN, spend or cost.
 */
export async function CoverageTab({ isAdmin }: { isAdmin: boolean }) {
  const [facts, coverage, funnel, approved, pending] = await Promise.all([
    loadConsentFacts(),
    loadEventCoverage(),
    loadCampaignFunnel(getCampaignOutcomeProvider()).catch(() => null),
    loadApprovedAdsNotice().catch(() => null),
    loadPendingChanges(),
  ]);
  const notice = adsMeasurementNotice(process.env, approved);
  const sent = shareOf(coverage.sent, coverage.detected);
  const wordingPending = pending.filter((p) => p.kind === "wording").length;
  return (
    <div className="flex flex-col gap-4">
      <KpiStrip label="Consent coverage">
        <KpiTile label="Agreed now" index={0} hint="customers with a current grant">{facts.agreed}</KpiTile>
        <KpiTile label="Withdrawn" index={1} hint="stop at once">{facts.withdrawn}</KpiTile>
        <KpiTile label="Lapsed" index={2} hint="grant has expired">{facts.lapsed}</KpiTile>
        <KpiTile label="Events sent" index={3} hint={sent ? `${pct(sent.share)} of ${coverage.detected} detected${sent.small ? " (small sample)" : ""}` : "none detected yet"}>{coverage.sent}</KpiTile>
      </KpiStrip>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Why events were not sent</CardTitle>
          <p className="text-sm text-muted-foreground">Only customers who agreed are ever reported to the ad platforms, and only as coded identifiers.</p>
        </CardHeader>
        <CardContent>
          {coverage.held.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing has been held back.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {coverage.held.map((h) => (
                <li key={h.reason} className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
                  <span className="tabular-nums font-semibold sm:w-12">{h.n}</span>
                  <span className="text-muted-foreground">{reasonText(h.reason)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Funded customers by campaign</CardTitle>
          <p className="text-sm text-muted-foreground">The same numbers as Campaign impact (last 90 days). Consent is not split by campaign: that would need the customer behind each row, which this screen does not show.</p>
        </CardHeader>
        <CardContent>
          {!funnel || !funnel.supported || funnel.rows.length === 0 ? (
            <EmptyState icon={Users} title="No campaign outcomes yet" description="This fills in as leads from campaigns fund." />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">KYC</TableHead>
                    <TableHead className="text-right">Funded</TableHead>
                    <TableHead>Confidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody striped>
                  {funnel.rows.slice(0, SHOWN).map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="text-sm">{r.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.leads}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.kyc ?? "n/a"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.funded}</TableCell>
                      <TableCell className="text-sm capitalize">{r.confidence}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {funnel.rows.length > SHOWN && <p className="mt-2 text-sm text-muted-foreground">Showing {SHOWN} of {funnel.rows.length} campaigns. The rest are on Campaign impact.</p>}
              {funnel.dataNote && <p className="mt-2 text-sm text-muted-foreground">{funnel.dataNote}</p>}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">What customers are told</CardTitle>
          <div className="flex gap-2">
            <Badge variant="outline">{notice.source === "approved" ? "Approved wording" : notice.source === "custom" ? "Set in the environment" : "Default wording"}</Badge>
            {notice.version && <Badge variant="outline">Version {notice.version}</Badge>}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="whitespace-pre-line text-muted-foreground">{notice.text}</p>
          <p className="text-muted-foreground">The final wording belongs to Compliance. A change needs a second Admin to approve it; consent already on file keeps the version it was given under.</p>
          {wordingPending > 0 && <p><Badge variant="warning">{wordingPending} wording change waiting for a second Admin</Badge></p>}
          {isAdmin && <NoticeForm initialText={notice.text} />}
        </CardContent>
      </Card>
    </div>
  );
}
