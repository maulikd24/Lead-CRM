import { loadExperimentsData } from "@/lib/creative/experiments-view";

import { ExperimentsView } from "./experiments-view";
import { Rail, type RailFact } from "./rail";
import { TabLayout } from "./tab-layout";

/** The experiment log: hypothesis, metric, minimum detectable effect, sample-size guidance for low volume, decision and learning, linked to campaigns. */
export async function ExperimentsTab({ today }: { today: string }) {
  const data = await loadExperimentsData(today);
  const n = (s: string) => data.experiments.filter((e) => e.status === s).length;
  const facts: RailFact[] = [
    { key: "running", label: "Running", value: { n: n("RUNNING"), kind: "count" }, tone: n("RUNNING") > 0 ? "warning" : undefined },
    { key: "planned", label: "Planned", value: { n: n("PLANNED"), kind: "count" } },
    { key: "decided", label: "Decided", value: { n: n("DECIDED"), kind: "count" }, tone: n("DECIDED") > 0 ? "success" : undefined },
    { key: "rate", label: "Lead to funded", value: data.observed && data.observed.funded > 0 ? `${((data.observed.funded / data.observed.leads) * 100).toFixed(1)}%` : "Not enough data", hint: data.observed ? `${data.observed.funded} of ${data.observed.leads} leads, 90 days` : undefined },
  ];
  return <TabLayout tab="experiments" rail={<Rail facts={facts} />} main={<ExperimentsView data={data} />} />;
}
