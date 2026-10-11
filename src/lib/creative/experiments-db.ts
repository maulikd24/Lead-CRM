import { prisma } from "@/lib/db/prisma";

import { EXPERIMENT_DECISIONS, EXPERIMENT_STATUSES, guideSampleSize, validateExperiment, type ExperimentDecision, type ExperimentStatus } from "./experiments";

export type ExperimentInputRaw = {
  name: string; hypothesis: string; metric: string; baselineRate: number | null; mde: number | null; mdeKind: "absolute" | "relative"; visitorsPerDay: number | null;
  startAt: string | null; endAt: string | null; status: ExperimentStatus; decision: ExperimentDecision | null; learning: string | null; campaignIds: string[];
};

const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null);

export function normaliseExperiment(raw: Partial<Record<keyof ExperimentInputRaw, unknown>>): ExperimentInputRaw {
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    name: s(raw.name, 120), hypothesis: s(raw.hypothesis, 600), metric: s(raw.metric, 80), baselineRate: n(raw.baselineRate), mde: n(raw.mde), mdeKind: raw.mdeKind === "absolute" ? "absolute" : "relative", visitorsPerDay: n(raw.visitorsPerDay),
    startAt: s(raw.startAt, 10) || null, endAt: s(raw.endAt, 10) || null,
    status: (EXPERIMENT_STATUSES as readonly unknown[]).includes(raw.status) ? (raw.status as ExperimentStatus) : "PLANNED",
    decision: (EXPERIMENT_DECISIONS as readonly unknown[]).includes(raw.decision) ? (raw.decision as ExperimentDecision) : null,
    learning: s(raw.learning, 1500) || null,
    campaignIds: Array.isArray(raw.campaignIds) ? raw.campaignIds.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 120)).slice(0, 20) : [],
  };
}

export async function saveExperiment(id: string | null, raw: ExperimentInputRaw, userId: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const e = normaliseExperiment(raw);
  const valid = validateExperiment({ name: e.name, hypothesis: e.hypothesis, metric: e.metric, mde: e.mde, mdeKind: e.mdeKind, startAt: e.startAt, endAt: e.endAt, status: e.status, decision: e.decision, learning: e.learning, campaignIds: e.campaignIds });
  if (!valid.ok) return valid;
  let sampleSizePerArm: number | null = null;
  if (e.baselineRate !== null && e.mde !== null) {
    const g = guideSampleSize({ baselineRate: e.baselineRate, mde: e.mde, mdeKind: e.mdeKind, visitorsPerDay: e.visitorsPerDay ?? undefined });
    if (!g.ok) return { ok: false, error: g.error };
    sampleSizePerArm = g.perArm;
  }
  const data = { name: e.name, hypothesis: e.hypothesis, metric: e.metric, baselineRate: e.baselineRate, mde: e.mde, mdeKind: e.mdeKind, visitorsPerDay: e.visitorsPerDay === null ? null : Math.round(e.visitorsPerDay), sampleSizePerArm, startAt: day(e.startAt), endAt: day(e.endAt), status: e.status, decision: e.decision, learning: e.learning, campaignIds: e.campaignIds };
  if (id) {
    await prisma.experiment.update({ where: { id }, data });
    return { ok: true, id };
  }
  const row = await prisma.experiment.create({ data: { ...data, createdById: userId } });
  return { ok: true, id: row.id };
}

export async function listExperiments() {
  return prisma.experiment.findMany({ orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 200 });
}

export async function deleteExperiment(id: string): Promise<void> {
  await prisma.experiment.delete({ where: { id } }).catch(() => undefined);
}
