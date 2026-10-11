import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { loadCoverageByCampaign, loadFundedConsentSplit } from "@/lib/closedloop/views-db";

const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 100)}%`);

/** Counts only: of the customers who funded, how many agreed to ad measurement and could be sent, by the campaign on their lead. No names, phones, emails or PAN. */
export async function CoverageTab() {
  const [split, rows] = await Promise.all([loadFundedConsentSplit(), loadCoverageByCampaign()]);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Funded customers and ad measurement consent</CardTitle>
          <p className="text-sm text-muted-foreground">Only customers who agreed can be reported back to the ad platforms. This is how much of the picture the platforms can see.</p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <p>Funded: <span className="tabular-nums font-semibold">{split.funded}</span></p>
          <p>Agreed: <span className="tabular-nums font-semibold">{split.consented}</span></p>
          <p>Not agreed or not asked: <span className="tabular-nums font-semibold">{split.notConsented}</span></p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">By campaign</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState icon={Users} title="No funded customers yet" description="This fills in as customers fund." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead className="text-right">Funded</TableHead>
                  <TableHead className="text-right">Agreed</TableHead>
                  <TableHead className="text-right">Can be sent</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody striped>
                {rows.map((r) => (
                  <TableRow key={r.campaign}>
                    <TableCell className="text-sm">{r.campaign}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.funded}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.consented}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.sendable}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(r.share)}{r.small ? " (small sample)" : ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
