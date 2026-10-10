import { Megaphone } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { compareImpact } from "@/lib/attribution/impact";
import { loadImpact } from "@/lib/attribution/impact-db";
import { previousRange } from "@/lib/attribution/impact-view";
import { formatCount, formatPercent, type DateRange } from "@/lib/marketing/view-model";
import { workspaceHref } from "@/lib/marketing/workspace-params";

import { ImpactView, type ImpactViewData } from "./impact-view";
import { Rail, type RailFact } from "./rail";
import { TabLayout } from "./tab-layout";

const MAX_CUSTOMERS_PER_GROUP = 100;

/** Server half of the Campaign impact tab: loads this period (and, when asked, the previous one) and hands the client view plain data. */
export async function ImpactTab({ range, compare, campaign, viewer }: { range: DateRange; compare: boolean; campaign?: string; viewer: { id: string; role: string } }) {
  const prevRange = previousRange(range);
  const [cur, prev] = await Promise.all([loadImpact(range, viewer), compare ? loadImpact(prevRange, null) : Promise.resolve(null)]);
  const { report } = cur;

  const customers: ImpactViewData["customers"] = {};
  const customerVisible: ImpactViewData["customerVisible"] = {};
  for (const [key, list] of Object.entries(cur.customers)) {
    customerVisible[key] = list.length;
    customers[key] = [...list].sort((a, b) => b.revenue - a.revenue || b.leadDate.localeCompare(a.leadDate)).slice(0, MAX_CUSTOMERS_PER_GROUP);
  }
  const t = report.totals;
  const withRoas = report.rows.filter((r) => r.roas !== null).sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))[0];
  const slowest = report.rows.filter((r) => r.missed > 0).sort((a, b) => b.missed - a.missed)[0];
  const age = cur.freshness.map((f) => f.value).sort((a, b) => Number(b.stale) - Number(a.stale))[0];
  const facts: RailFact[] = [
    { key: "spend", label: "Spend data", value: age?.ageLabel ? `Updated ${age.ageLabel}` : "Not synced yet", hint: age && (age.stale || age.partial) ? "See the notes above" : "Complete for the range", tone: age && (age.stale || age.partial || !age.ageLabel) ? "warning" : "success" },
    { key: "best", label: "Best return", value: withRoas ? withRoas.label : "None yet", hint: withRoas ? `${(withRoas.roas ?? 0).toFixed(1)}× revenue over spend` : "No campaign has revenue yet" },
    { key: "leak", label: "Leads not reached", value: { n: t.missed, kind: "count" }, tone: t.missed > 0 ? "warning" : "success", hint: slowest ? `Most in ${slowest.label}` : `Within ${cur.slaMinutes} min or still in window` },
    { key: "unattr", label: "Unattributed", value: report.unattributedShare === null ? "–" : formatPercent(report.unattributedShare), hint: `of ${formatCount(t.leads)} leads` },
  ];

  const data: ImpactViewData = {
    report,
    comparison: prev ? compareImpact(report, prev.report) : null,
    freshness: cur.freshness,
    customers,
    customerTotals: cur.groupTotals,
    customerVisible,
    hiddenCustomers: cur.hiddenCustomers,
    slaMinutes: cur.slaMinutes,
    truncated: cur.truncated,
    comparing: compare,
    previousLabel: compare ? `${prevRange.from} to ${prevRange.to}` : null,
    compareHref: workspaceHref({ tab: "impact", range, compare: !compare, campaign }),
  };

  if (report.rows.length === 0) {
    return <TabLayout tab="impact" rail={<Rail facts={facts} />} main={<Card><CardContent><EmptyState icon={Megaphone} title="No leads or spend in this range" description="Pick a longer range. Leads appear here as soon as they arrive; spend after the first ad sync." /></CardContent></Card>} />;
  }
  return <TabLayout tab="impact" rail={<Rail facts={facts} />} main={<ImpactView data={data} />} />;
}
