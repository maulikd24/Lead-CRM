import { loadInsights } from "@/lib/creative/insights-db";
import type { Viewer } from "@/lib/creative/outcomes-db";
import { formatMoney } from "@/lib/marketing/view-model";

import { InsightsView } from "./insights-view";
import { Rail, type RailFact } from "./rail";
import { TabLayout } from "./tab-layout";

const stamp = (iso: string | null) => (iso ? `${new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST` : "No sync recorded");

/** Creative intelligence: per-ad performance by funded outcome, fatigue, what the winners share, and tags. */
export async function InsightsTab({ range, viewer }: { range: { from: string; to: string }; viewer: Viewer }) {
  const data = await loadInsights(viewer, range);
  const { view } = data;
  const best = view.ads.find((a) => a.costPerFunded !== null);
  const facts: RailFact[] = [
    { key: "ads", label: "Ads with spend", value: { n: view.ads.length, kind: "count" }, hint: `${range.from} to ${range.to}` },
    { key: "funded", label: "Cheapest per funded", value: best?.costPerFunded != null ? formatMoney(best.costPerFunded, data.currency) : "Not yet", hint: best ? best.adName : view.fundedKnown ? "No ad has a funded customer yet" : "Needs an ad id on leads", tone: best ? "success" : undefined },
    { key: "fatigue", label: "Tired ads", value: { n: view.fatiguedCount, kind: "count" }, tone: view.fatiguedCount > 0 ? "warning" : undefined, hint: "Judged on 28 days" },
    { key: "asof", label: "Data as of", value: stamp(data.asOf), hint: "Last successful ad sync" },
  ];
  return (
    <TabLayout
      tab="intel"
      rail={<Rail facts={facts}>{data.notes.length > 0 && <p className="text-xs text-muted-foreground">{data.notes.join(" ")}</p>}</Rail>}
      main={<InsightsView ads={view.ads} winners={view.winners} fatigue={data.thresholds.fatigue} winnerSettings={data.thresholds.winners} />}
    />
  );
}
