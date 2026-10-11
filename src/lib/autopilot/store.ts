import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { attributeLeads, isLeadOfChannel } from "@/lib/marketing/attribution";
import { addDays, todayInTimeZone } from "@/lib/marketing/dates";
import { minorToMajor } from "@/lib/marketing/money";
import { netRevenue } from "@/lib/marketing/revenue";
import { pseudonymize } from "./pseudonymize";
import type { Decision, Recommendation } from "./recommendations";
import type { Rule } from "./rules";
import { DEFAULT_SETTINGS, type AutopilotSnapshot, type CampaignInfo, type DailyRow, type LeadRecord, type Platform } from "./types";

/** Database access for Autopilot. Every function here is called only after the access gate (see access.ts). */

const WINDOW_DAYS = 28;
const LEAD_LIMIT = 5000;
const CONTACT_TYPES = ["CALL", "CONTACT", "MESSAGE", "MEETING"] as const;
const PLATFORMS: Platform[] = ["meta", "google"];

async function aumByClient(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ clientId: string; aum: Prisma.Decimal | null }[]>(Prisma.sql`
    SELECT ta."clientId" AS "clientId", SUM(p."currentValue") AS aum
    FROM "Position" p JOIN "TradingAccount" ta ON ta."id" = p."tradingAccountId"
    WHERE ta."clientId" = ANY(${ids}::text[])
      AND p."asOfDate" = (SELECT MAX(p2."asOfDate") FROM "Position" p2 WHERE p2."tradingAccountId" = p."tradingAccountId")
    GROUP BY ta."clientId"`);
  return new Map(rows.map((r) => [r.clientId, Number(r.aum ?? 0)]));
}

export async function loadSnapshot(opts: { pseudonymous: boolean; now?: Date }): Promise<AutopilotSnapshot> {
  const now = opts.now ?? new Date();
  const tzRow = await prisma.adCampaignDaily.findFirst({ orderBy: { syncedAt: "desc" }, select: { accountTimezone: true } });
  const tz = tzRow?.accountTimezone ?? "Asia/Kolkata";
  const until = todayInTimeZone(now, tz);
  const since = addDays(until, -(WINDOW_DAYS - 1));
  const [rows, plans, datasets, latest] = await Promise.all([
    prisma.adCampaignDaily.findMany({ where: { date: { gte: new Date(`${since}T00:00:00Z`), lte: new Date(`${until}T00:00:00Z`) } } }),
    prisma.autopilotPlan.findMany(),
    prisma.autopilotDataset.findMany({ orderBy: { capturedAt: "desc" }, take: 60 }),
    prisma.adCampaignDaily.aggregate({ _max: { syncedAt: true } }),
  ]);
  const planOf = new Map(plans.map((p) => [p.campaignId, p]));
  const settingsRow = planOf.get("*");

  const days: DailyRow[] = rows.map((r) => ({ campaignId: r.campaignId, date: r.date.toISOString().slice(0, 10), spend: minorToMajor(r.spendMinor, r.currency), impressions: r.impressions, clicks: r.clicks, leads: r.leads }));
  const recentCut = addDays(until, -3);
  const byId = new Map<string, CampaignInfo>();
  for (const r of [...rows].sort((a, b) => a.date.getTime() - b.date.getTime())) {
    const spentRecently = days.some((d) => d.campaignId === r.campaignId && d.date >= recentCut && d.spend > 0);
    byId.set(r.campaignId, { id: r.campaignId, name: r.campaignName, platform: r.provider === "google" ? "google" : "meta", status: spentRecently ? "ACTIVE" : "UNKNOWN", plannedMonthlyBudget: planOf.get(r.campaignId)?.plannedMonthlyBudget ?? null });
  }
  const campaigns = [...byId.values()];

  const clients = await prisma.client.findMany({
    where: { isDeleted: false, mergedIntoId: null, leadAttribution: { not: Prisma.DbNull }, createdAt: { gte: new Date(`${addDays(since, -1)}T00:00:00Z`), lt: new Date(`${addDays(until, 2)}T00:00:00Z`) } },
    orderBy: { createdAt: "desc" }, take: LEAD_LIMIT,
    select: {
      id: true, createdAt: true, leadSource: true, leadAttribution: true, city: true, state: true,
      kycRecord: { select: { status: true } }, fundingRecord: { select: { status: true } },
      payments: { where: { paymentType: "FUNDS_IN", status: "SUCCESS" }, select: { id: true }, take: 1 },
      revenueEvents: { select: { id: true, revenueType: true, grossRevenueAmount: true, reversesEventId: true, reverses: { select: { revenueType: true } } } },
      activities: { where: { type: { in: [...CONTACT_TYPES] }, userId: { not: null } }, orderBy: { createdAt: "asc" }, take: 1, select: { createdAt: true } },
    },
  });
  const aum = await aumByClient(clients.map((c) => c.id));
  const campaignOf = new Map<string, string | null>();
  for (const channel of PLATFORMS) {
    const ids = campaigns.filter((c) => c.platform === channel).map((c) => ({ campaignId: c.id, campaignName: c.name }));
    const activity = days.filter((d) => d.spend > 0 && ids.some((i) => i.campaignId === d.campaignId)).map((d) => ({ campaignId: d.campaignId, date: d.date }));
    const leadsIn = clients.filter((c) => isLeadOfChannel(channel, { clientId: c.id, day: "", leadSource: c.leadSource, attribution: (c.leadAttribution as Record<string, unknown>) ?? null })).map((c) => ({ clientId: c.id, day: todayInTimeZone(c.createdAt, tz), leadSource: c.leadSource, attribution: (c.leadAttribution && typeof c.leadAttribution === "object" ? (c.leadAttribution as Record<string, unknown>) : null) }));
    for (const a of attributeLeads(leadsIn, ids, activity, channel).assignments) if (a.campaignId) campaignOf.set(a.lead.clientId, a.campaignId);
  }
  const leads: LeadRecord[] = clients.filter((c) => { const d = todayInTimeZone(c.createdAt, tz); return d >= since && d <= until; }).map((c) => ({
    campaignId: campaignOf.get(c.id) ?? null,
    arrivedAt: c.createdAt.toISOString(),
    contactMinutes: c.activities[0] ? Math.max(0, Math.round((c.activities[0].createdAt.getTime() - c.createdAt.getTime()) / 60_000)) : null,
    kycComplete: c.kycRecord?.status === "APPROVED",
    funded: c.fundingRecord?.status === "PARTIALLY_FUNDED" || c.fundingRecord?.status === "FULLY_FUNDED" || c.payments.length > 0,
    revenue: netRevenue(c.revenueEvents.map((e) => ({ id: e.id, revenueType: e.revenueType, amount: Number(e.grossRevenueAmount), reversesEventId: e.reversesEventId, reversedType: e.reverses?.revenueType ?? null }))),
    aum: aum.get(c.id) ?? 0, city: c.city, state: c.state,
  }));

  const snap: AutopilotSnapshot = {
    asOf: now.toISOString(), dataThrough: latest._max.syncedAt ? latest._max.syncedAt.toISOString() : null, window: { since, until },
    campaigns, days, leads,
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
  return opts.pseudonymous ? pseudonymize(snap) : snap;
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
  return rows.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled, metric: r.metric as Rule["metric"], op: r.op as Rule["op"], threshold: r.threshold, days: r.days, campaignIds: (r.campaignIds as string[] | null) ?? null, action: r.action as Rule["action"] }));
}
export async function saveRule(r: Omit<Rule, "id">, userId: string) {
  const row = await prisma.autopilotRule.create({ data: { name: r.name.trim().slice(0, 80), enabled: r.enabled, metric: r.metric, op: r.op, threshold: r.threshold, days: r.days, campaignIds: r.campaignIds ?? Prisma.DbNull, action: r.action, createdById: userId } });
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
