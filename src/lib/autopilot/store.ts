import { Prisma } from "@/generated/prisma/client";
import { getCampaignOutcomeProvider, type CampaignOutcomeProvider, type OutcomeCaller, type OutcomeRow } from "@/lib/attribution";
import { prisma } from "@/lib/db/prisma";
import { addDays } from "@/lib/marketing/dates";
import { loadCampaignDays } from "@/lib/marketing/daily-rows";
import type { Decision, Recommendation } from "./recommendations";
import type { Rule } from "./rules";
import { DEFAULT_SETTINGS, type AutopilotSnapshot, type CampaignInfo, type CampaignOutcome, type DailyRow, type LeadRecord } from "./types";

/**
 * Database access for Autopilot. Every function here is called only after the access gate (requireMarketing in the page and the actions) or by
 * a registered system reader (the daily audit job). What came of the clicks (CRM leads, KYC, funded, revenue, cost per funded customer, return
 * on spend) is read ONLY through the CampaignOutcomeProvider; the platform's own daily numbers come from the marketing module's reader.
 */

const WINDOW_DAYS = 28;
const MAX_RULE_WINDOW = 90;

/** The provider's row for a campaign, as Autopilot keeps it. Pure: a mapping, no arithmetic. */
export function outcomeOf(r: OutcomeRow): CampaignOutcome {
  return {
    spend: r.spend, leads: r.leads, contactedInSla: r.contactedInSla, contactedInSlaRate: r.contactedInSlaRate, kyc: r.kyc, funded: r.funded, revenue: r.revenue,
    costPerLead: r.costPerLead, costPerFunded: r.costPerFunded, roas: r.roas, confidence: r.confidence.label,
  };
}

/** Provider campaign keys look like "meta:123"; Autopilot's campaign ids are the platform's own ("123"). */
export const campaignIdOfKey = (key: string): string => key.slice(key.indexOf(":") + 1);

async function outcomesFor(provider: CampaignOutcomeProvider, caller: OutcomeCaller, period: { from: string; to: string }): Promise<Record<string, CampaignOutcome>> {
  const report = await provider.outcomes({ grain: "campaign", period }, caller);
  const out: Record<string, CampaignOutcome> = {};
  for (const r of report.rows) if (r.rowKind === "campaign") out[campaignIdOfKey(r.key)] = outcomeOf(r);
  return out;
}

export type LoadOptions = {
  /** Who is asking: a signed-in user (page, actions) or the registered system reader "autopilot" (the daily job). */
  caller: OutcomeCaller;
  now?: Date;
  /** The look-back windows (days) of the enabled rules, so each gets its own outcomes from the provider. */
  ruleWindows?: number[];
  provider?: CampaignOutcomeProvider;
};

export async function loadSnapshot(opts: LoadOptions): Promise<AutopilotSnapshot> {
  const now = opts.now ?? new Date();
  const provider = opts.provider ?? getCampaignOutcomeProvider();
  const platform = await loadCampaignDays(WINDOW_DAYS, now);
  const { since, until } = platform.window;
  const [plans, datasets] = await Promise.all([prisma.autopilotPlan.findMany(), prisma.autopilotDataset.findMany({ orderBy: { capturedAt: "desc" }, take: 60 })]);
  const planOf = new Map(plans.map((p) => [p.campaignId, p]));
  const settingsRow = planOf.get("*");

  const days: DailyRow[] = platform.rows.map((r) => ({ campaignId: r.campaignId, date: r.date, spend: r.spend, impressions: r.impressions, clicks: r.clicks, leads: r.leads }));
  const recentCut = addDays(until, -3);
  const byId = new Map<string, CampaignInfo>();
  for (const r of [...platform.rows].sort((a, b) => a.date.localeCompare(b.date))) {
    const spentRecently = platform.rows.some((d) => d.campaignId === r.campaignId && d.date >= recentCut && d.spend > 0);
    byId.set(r.campaignId, { id: r.campaignId, name: r.campaignName, platform: r.channel, accountId: r.accountId, status: spentRecently ? "ACTIVE" : "UNKNOWN", plannedMonthlyBudget: planOf.get(r.campaignId)?.plannedMonthlyBudget ?? null });
  }
  const campaigns = [...byId.values()];

  const period = { from: since, to: until };
  const [outcomes, cohorts] = await Promise.all([outcomesFor(provider, opts.caller, period), provider.leadCohorts({ period }, opts.caller)]);
  const windows = [...new Set((opts.ruleWindows ?? []).filter((d) => Number.isInteger(d) && d >= 1 && d <= MAX_RULE_WINDOW))];
  const windowOutcomes: AutopilotSnapshot["windowOutcomes"] = {};
  for (const d of windows) windowOutcomes[String(d)] = await outcomesFor(provider, opts.caller, { from: addDays(until, -(d - 1)), to: until });

  const leads: LeadRecord[] = cohorts.rows.map((c) => ({
    campaignId: c.campaignKey ? campaignIdOfKey(c.campaignKey) : null,
    arrivedAt: c.arrivedAt, contactMinutes: c.firstContactMinutes, kycComplete: c.kyc, funded: c.funded, revenue: c.revenue, aum: c.aum, city: c.city, state: c.state,
  }));

  const snap: AutopilotSnapshot = {
    asOf: now.toISOString(), dataThrough: platform.dataThrough ? platform.dataThrough.toISOString() : null, window: { since, until },
    campaigns, days, outcomes, windowOutcomes, leads,
    settings: { ...DEFAULT_SETTINGS, targetCostPerFunded: settingsRow?.targetCostPerFunded ?? null, contactSlaMinutes: settingsRow?.contactSlaMinutes ?? DEFAULT_SETTINGS.contactSlaMinutes },
  };
  // Optional datasets: the newest of each kind (all platforms merged). Absent kinds stay undefined = "not available".
  const seen = new Set<string>();
  for (const d of datasets) {
    const key = `${d.kind}|${d.platform}`;
    if (seen.has(key) || !Array.isArray(d.payload) && d.kind !== "tracking") continue;
    seen.add(key);
    const arr = d.payload as never[];
    if (d.kind === "tracking") { const t = d.payload as unknown as NonNullable<AutopilotSnapshot["tracking"]>; snap.tracking = { events: [...(snap.tracking?.events ?? []), ...(t.events ?? [])], offlineImports: [...(snap.tracking?.offlineImports ?? []), ...(t.offlineImports ?? [])] }; continue; }
    if (["searchTerms", "keywords", "placements", "hours", "regionSpend", "audienceOverlap", "auction", "adFatigue"].includes(d.kind)) {
      const k = d.kind as "searchTerms"; (snap as unknown as Record<string, unknown[]>)[k] = [...((snap as unknown as Record<string, unknown[]>)[k] ?? []), ...arr];
    }
  }
  return snap;
}

// --- Recommendations and decisions -------------------------------------------------------------------------------

const targetKeyOf = (r: Recommendation) => [...r.action.targetIds].sort().join(",") || "account";

/** Save today's proposals, keeping the status of ones already decided. Returns the merged list. */
export async function syncRecommendations(fresh: Recommendation[]): Promise<Recommendation[]> {
  const existing = await prisma.autopilotRecommendation.findMany({ where: { id: { in: fresh.map((r) => r.id) } } });
  const byId = new Map(existing.map((e) => [e.id, e]));
  const out: Recommendation[] = [];
  for (const r of fresh) {
    const e = byId.get(r.id);
    if (!e) await prisma.autopilotRecommendation.create({ data: { id: r.id, ruleKey: r.ruleKey, targetKey: targetKeyOf(r), category: r.category, severity: r.severity, issue: r.issue, evidence: r.evidence, action: r.action as never, impact: r.impact as never, confidence: r.confidence } });
    else await prisma.autopilotRecommendation.update({ where: { id: r.id }, data: { issue: r.issue, evidence: r.evidence, impact: r.impact as never, lastSeenAt: new Date() } });
    out.push({ ...r, status: (e?.status as Recommendation["status"]) ?? "PENDING" });
  }
  return out;
}

export async function getRecommendation(id: string): Promise<Recommendation | null> {
  const e = await prisma.autopilotRecommendation.findUnique({ where: { id } });
  if (!e) return null;
  const action = e.action as Recommendation["action"];
  return { id: e.id, ruleKey: e.ruleKey, category: e.category as Recommendation["category"], severity: e.severity as Recommendation["severity"], issue: e.issue, evidence: e.evidence as string[], action, impact: e.impact as Recommendation["impact"], confidence: e.confidence as Recommendation["confidence"], appliable: ["pause_campaign", "reduce_budget", "add_negative_keywords", "exclude_placement", "adjust_schedule"].includes(action.kind), status: e.status as Recommendation["status"] };
}

/** Record a decision atomically: only a still-PENDING proposal can be decided, so a double click decides once. */
export async function recordDecision(d: Decision): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const res = await tx.autopilotRecommendation.updateMany({ where: { id: d.recId, status: "PENDING" }, data: { status: d.decision, decidedById: d.actorId, decidedAt: new Date(d.at) } });
    if (res.count === 0) return false;
    await tx.autopilotDecision.create({ data: { recId: d.recId, ruleKey: d.ruleKey, targetKey: d.targetKey, decision: d.decision, reasonCode: d.reasonCode, note: d.note, actorId: d.actorId } });
    await tx.auditLog.create({ data: { userId: d.actorId, entity: "AutopilotRecommendation", entityId: d.recId, action: d.decision === "APPROVED" ? "autopilot_approved" : "autopilot_denied", newValue: { reasonCode: d.reasonCode } as never, reason: d.note } });
    return true;
  });
}

export async function recentDenials(): Promise<Decision[]> {
  const rows = await prisma.autopilotDecision.findMany({ where: { decision: "DENIED", createdAt: { gte: new Date(Date.now() - 60 * 86_400_000) } }, orderBy: { createdAt: "desc" }, take: 500 });
  return rows.map((r) => ({ recId: r.recId, ruleKey: r.ruleKey, targetKey: r.targetKey, decision: "DENIED" as const, reasonCode: r.reasonCode as Decision["reasonCode"], note: r.note, actorId: r.actorId, at: r.createdAt.toISOString() }));
}

export async function markApplied(id: string, userId: string, res: { ok: boolean; undoToken?: string | null; error?: string }) {
  await prisma.autopilotRecommendation.update({ where: { id }, data: res.ok ? { status: "APPLIED", appliedAt: new Date(), undoToken: res.undoToken ?? null, lastError: null } : { status: "FAILED", lastError: (res.error ?? "").slice(0, 300) } });
  await prisma.auditLog.create({ data: { userId, entity: "AutopilotRecommendation", entityId: id, action: res.ok ? "autopilot_applied" : "autopilot_apply_failed", reason: res.ok ? null : (res.error ?? "").slice(0, 300) } });
}

// --- Rules -------------------------------------------------------------------------------------------------------

export async function listRules(): Promise<Rule[]> {
  const rows = await prisma.autopilotRule.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled, metric: r.metric as Rule["metric"], op: r.op as Rule["op"], threshold: r.threshold, days: r.days, campaignIds: (r.campaignIds as string[] | null) ?? null, accountIds: (r.accountIds as string[] | null) ?? null, action: r.action as Rule["action"] }));
}
export async function saveRule(r: Omit<Rule, "id">, userId: string, source: "manual" | "drafted" = "manual") {
  const row = await prisma.autopilotRule.create({ data: { name: r.name.trim().slice(0, 80), enabled: r.enabled, metric: r.metric, op: r.op, threshold: r.threshold, days: r.days, campaignIds: r.campaignIds ?? Prisma.DbNull, accountIds: r.accountIds ?? Prisma.DbNull, source, action: r.action, createdById: userId } });
  await prisma.auditLog.create({ data: { userId, entity: "AutopilotRule", entityId: row.id, action: "autopilot_rule_created" } });
  return row.id;
}
export async function setRuleEnabled(id: string, enabled: boolean, userId: string) {
  await prisma.autopilotRule.update({ where: { id }, data: { enabled } });
  await prisma.auditLog.create({ data: { userId, entity: "AutopilotRule", entityId: id, action: enabled ? "autopilot_rule_enabled" : "autopilot_rule_disabled" } });
}

// --- Launch drafts -----------------------------------------------------------------------------------------------

export type DraftRow = { id: string; name: string; status: string; complianceOk: boolean; annexureApproved: boolean; externalId: string | null; createdById: string; input: unknown; estimates: unknown; checklist: unknown; createdAt: Date };
export const listDrafts = (): Promise<DraftRow[]> => prisma.autopilotLaunchDraft.findMany({ where: { status: { not: "DISCARDED" } }, orderBy: { createdAt: "desc" }, take: 30 }) as Promise<DraftRow[]>;
export const getDraft = (id: string): Promise<DraftRow | null> => prisma.autopilotLaunchDraft.findUnique({ where: { id } }) as Promise<DraftRow | null>;
export async function saveDraft(d: { name: string; input: unknown; estimates: unknown; checklist: unknown; complianceOk: boolean }, userId: string) {
  const row = await prisma.autopilotLaunchDraft.create({ data: { name: d.name.slice(0, 120), input: d.input as never, estimates: d.estimates as never, checklist: d.checklist as never, complianceOk: d.complianceOk, createdById: userId } });
  await prisma.auditLog.create({ data: { userId, entity: "AutopilotLaunchDraft", entityId: row.id, action: "autopilot_draft_created" } });
  return row.id;
}
export async function updateDraft(id: string, userId: string, action: string, data: Prisma.AutopilotLaunchDraftUpdateInput) {
  await prisma.autopilotLaunchDraft.update({ where: { id }, data });
  await prisma.auditLog.create({ data: { userId, entity: "AutopilotLaunchDraft", entityId: id, action } });
}

// --- Plans -------------------------------------------------------------------------------------------------------

export async function savePlan(campaignId: string, plannedMonthlyBudget: number | null, userId: string) {
  await prisma.autopilotPlan.upsert({ where: { campaignId }, create: { campaignId, plannedMonthlyBudget, updatedById: userId }, update: { plannedMonthlyBudget, updatedById: userId } });
  await prisma.auditLog.create({ data: { userId, entity: "AutopilotPlan", entityId: campaignId, action: "autopilot_plan_saved" } });
}
export async function saveTargets(t: { targetCostPerFunded: number | null; contactSlaMinutes: number | null }, userId: string) {
  await prisma.autopilotPlan.upsert({ where: { campaignId: "*" }, create: { campaignId: "*", ...t, updatedById: userId }, update: { ...t, updatedById: userId } });
  await prisma.auditLog.create({ data: { userId, entity: "AutopilotPlan", entityId: "*", action: "autopilot_targets_saved" } });
}
