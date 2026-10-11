import { addDays } from "@/lib/marketing/dates";

import { listExperiments } from "./experiments-db";
import type { ExperimentDecision, ExperimentStatus } from "./experiments";
import { loadCampaignReport, type Viewer } from "./outcomes-db";

/** Data for the Experiments tab: the log, the campaigns an experiment can be linked to, and the account's own lead-to-funded rate as a starting point. */

export type ExperimentView = {
  id: string; name: string; hypothesis: string; metric: string; baselineRate: number | null; mde: number | null; mdeKind: "absolute" | "relative"; visitorsPerDay: number | null; sampleSizePerArm: number | null;
  startAt: string | null; endAt: string | null; status: ExperimentStatus; decision: ExperimentDecision | null; learning: string | null; campaignIds: string[];
};
export type ExperimentsData = { experiments: ExperimentView[]; campaigns: { id: string; name: string }[]; observed: { leads: number; funded: number; /** The provider's lead-to-funded rate (a fraction); null when it cannot be known. */ rate: number | null; windowDays: number } | null; names: Record<string, string> };

export async function loadExperimentsData(viewer: Viewer, today: string): Promise<ExperimentsData> {
  const from = addDays(today, -89);
  const [rows, report] = await Promise.all([listExperiments(), loadCampaignReport(viewer, { from, to: today }).catch(() => null)]);
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  // The campaigns an experiment can link to are the provider's own campaign rows (key "meta:123"); an id stored before keys existed still resolves by its bare id.
  const campaigns = (report?.rows ?? []).filter((r) => r.rowKind === "campaign").map((r) => ({ id: r.key, name: r.label }));
  const leads = report?.totals?.leads ?? 0;
  const funded = report?.totals?.funded ?? 0;
  return {
    experiments: rows.map((e) => ({ id: e.id, name: e.name, hypothesis: e.hypothesis, metric: e.metric, baselineRate: e.baselineRate, mde: e.mde, mdeKind: e.mdeKind === "absolute" ? "absolute" : "relative", visitorsPerDay: e.visitorsPerDay, sampleSizePerArm: e.sampleSizePerArm, startAt: day(e.startAt), endAt: day(e.endAt), status: e.status as ExperimentStatus, decision: e.decision as ExperimentDecision | null, learning: e.learning, campaignIds: e.campaignIds })),
    campaigns,
    observed: leads > 0 ? { leads, funded, rate: report?.totals?.fundedRate ?? null, windowDays: 90 } : null,
    names: Object.fromEntries(campaigns.flatMap((c) => [[c.id, c.name], [c.id.slice(c.id.indexOf(":") + 1), c.name]])),
  };
}
