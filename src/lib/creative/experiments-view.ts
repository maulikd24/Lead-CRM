import { prisma } from "@/lib/db/prisma";
import { addDays } from "@/lib/marketing/dates";

import { listExperiments } from "./experiments-db";
import type { ExperimentDecision, ExperimentStatus } from "./experiments";
import { getOutcomeProvider } from "./outcomes-db";

/** Data for the Experiments tab: the log, the campaigns an experiment can be linked to, and the account's own lead-to-funded rate as a starting point. */

export type ExperimentView = {
  id: string; name: string; hypothesis: string; metric: string; baselineRate: number | null; mde: number | null; mdeKind: "absolute" | "relative"; visitorsPerDay: number | null; sampleSizePerArm: number | null;
  startAt: string | null; endAt: string | null; status: ExperimentStatus; decision: ExperimentDecision | null; learning: string | null; campaignIds: string[];
};
export type ExperimentsData = { experiments: ExperimentView[]; campaigns: { id: string; name: string }[]; observed: { leads: number; funded: number; windowDays: number } | null; names: Record<string, string> };

export async function loadExperimentsData(today: string): Promise<ExperimentsData> {
  const from = addDays(today, -89);
  const [rows, campaignRows, outcomes] = await Promise.all([
    listExperiments(),
    prisma.adCampaignDaily.groupBy({ by: ["campaignId", "campaignName"], where: { date: { gte: new Date(`${from}T00:00:00Z`) } } }),
    getOutcomeProvider().getOutcomes({ from, to: today, level: "campaign" }).catch(() => null),
  ]);
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const campaigns = [...new Map(campaignRows.map((c) => [c.campaignId, c.campaignName])).entries()].map(([id, name]) => ({ id, name }));
  const leads = outcomes?.rows.reduce((a, r) => a + (r.leads ?? 0), 0) ?? 0;
  const funded = outcomes?.rows.reduce((a, r) => a + (r.funded ?? 0), 0) ?? 0;
  return {
    experiments: rows.map((e) => ({ id: e.id, name: e.name, hypothesis: e.hypothesis, metric: e.metric, baselineRate: e.baselineRate, mde: e.mde, mdeKind: e.mdeKind === "absolute" ? "absolute" : "relative", visitorsPerDay: e.visitorsPerDay, sampleSizePerArm: e.sampleSizePerArm, startAt: day(e.startAt), endAt: day(e.endAt), status: e.status as ExperimentStatus, decision: e.decision as ExperimentDecision | null, learning: e.learning, campaignIds: e.campaignIds })),
    campaigns,
    observed: leads > 0 ? { leads, funded, windowDays: 90 } : null,
    names: Object.fromEntries(campaigns.map((c) => [c.id, c.name])),
  };
}
