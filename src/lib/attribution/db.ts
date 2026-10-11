import { Prisma } from "@/generated/prisma/client";
import { agentEnabled } from "@/lib/agents/enabled";
import { checkOutbound } from "@/lib/agents/guardrails";
import { consentGate } from "@/lib/consent/enforce";
import { prisma } from "@/lib/db/prisma";
import { createCampaignResolver } from "@/lib/marketing/attribution";
import { getAdAccountTimezone, pickPrimaryTimezone } from "@/lib/marketing/report";
import { googleAdsReportingEnabled } from "@/lib/marketing/flags";
import { createTaskIfNotExists } from "@/lib/stage-engine/create-task-if-not-exists";

import { firstContactAt, type ContactSignal } from "./first-contact";
import { buildJourney, type Journey } from "./journey";
import { DEFAULT_SETTINGS, GRACE_KEY, SLA_KEY, parseSettings, type AttributionSettings } from "./settings";
import { pushEvents, sweepEvents } from "./events";
import { LEAD_DRAFT_AGENT_KEY, LEAD_DRAFT_TTL_MS, firstMessageDraft, type ClockDeps, type OpenPush, type PushDeps, type SweepDeps } from "./lead-push";
import { attribute, type AdChannelKey, type Attribution, type AttributionContext, type AttributionInput } from "./model";
import { fundedAtOf, intakeTouch, revenueSummary } from "./rows";

/** Database side of campaign attribution. Every loader takes ids the caller has ALREADY authorised; none adds a data path of its own. */

const CONTEXT_TTL_MS = 60_000;
let contextCache: { at: number; value: AttributionContext } | null = null;
export function clearAttributionContextCache() {
  contextCache = null;
}

/** The campaign index both ad channels are matched against: every synced (id, name) pair and the days each was active. */
export async function loadAttributionContext(now = new Date()): Promise<AttributionContext> {
  if (contextCache && now.getTime() - contextCache.at < CONTEXT_TTL_MS) return contextCache.value;
  const channels: AdChannelKey[] = googleAdsReportingEnabled() ? ["meta", "google"] : ["meta"];
  const per = await Promise.all(
    (["meta", "google"] as const).map(async (channel) => {
      if (!channels.includes(channel)) return { channel, identities: [], activity: [], tz: "UTC" };
      const [identities, rows, tz] = await Promise.all([
        prisma.adCampaignDaily.groupBy({ by: ["campaignId", "campaignName"], where: { provider: channel } }),
        prisma.adCampaignDaily.findMany({ where: { provider: channel }, select: { campaignId: true, date: true } }),
        getAdAccountTimezone(channel),
      ]);
      return { channel, identities: identities.map((i) => ({ campaignId: i.campaignId, campaignName: i.campaignName })), activity: rows.map((r) => ({ campaignId: r.campaignId, date: r.date.toISOString().slice(0, 10) })), tz };
    }),
  );
  const by = Object.fromEntries(per.map((p) => [p.channel, p])) as Record<AdChannelKey, (typeof per)[number]>;
  const value: AttributionContext = {
    timezone: pickPrimaryTimezone(per.map((p) => p.tz)),
    meta: createCampaignResolver(by.meta.identities, by.meta.activity),
    google: createCampaignResolver(by.google.identities, by.google.activity),
    names: { meta: new Map(by.meta.identities.map((i) => [i.campaignId, i.campaignName])), google: new Map(by.google.identities.map((i) => [i.campaignId, i.campaignName])) },
  };
  contextCache = { at: now.getTime(), value };
  return value;
}

export async function loadSettings(): Promise<AttributionSettings> {
  try {
    return parseSettings(await prisma.attributionSetting.findMany({ where: { key: { in: [SLA_KEY, GRACE_KEY] } }, select: { key: true, value: true } }));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: AttributionSettings, userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.attributionSetting.upsert({ where: { key: SLA_KEY }, create: { key: SLA_KEY, value: String(settings.slaMinutes), updatedById: userId }, update: { value: String(settings.slaMinutes), updatedById: userId } }),
    prisma.attributionSetting.upsert({ where: { key: GRACE_KEY }, create: { key: GRACE_KEY, value: String(settings.graceMinutes), updatedById: userId }, update: { value: String(settings.graceMinutes), updatedById: userId } }),
  ]);
}

/** Staff contact signals for one or many customers, in the shape the first-contact rule reads. */
export async function loadContactSignals(clientIds: string[]): Promise<Map<string, ContactSignal[]>> {
  const out = new Map<string, ContactSignal[]>(clientIds.map((id) => [id, []]));
  if (clientIds.length === 0) return out;
  const [activities, messages] = await Promise.all([
    prisma.activity.findMany({ where: { clientId: { in: clientIds }, type: { in: ["CALL", "CONTACT", "MEETING"] }, userId: { not: null } }, select: { clientId: true, type: true, createdAt: true, userId: true, deviceCall: { select: { direction: true, durationSeconds: true } } } }),
    prisma.message.findMany({ where: { clientId: { in: clientIds }, direction: "OUTBOUND" }, select: { clientId: true, createdAt: true, sentAt: true, senderUserId: true, status: true, origin: true } }),
  ]);
  for (const a of activities) out.get(a.clientId)?.push({ kind: "activity", type: a.type, at: a.createdAt, userId: a.userId, call: a.deviceCall });
  for (const m of messages) out.get(m.clientId)?.push({ kind: "message", direction: "OUTBOUND", at: m.sentAt ?? m.createdAt, senderUserId: m.senderUserId, status: m.status, origin: m.origin });
  return out;
}

export type ClientJourney = { journey: Journey; attribution: Attribution; settings: AttributionSettings };

/** The whole journey of one customer. */
export async function loadClientJourney(clientId: string, now = new Date()): Promise<ClientJourney | null> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true, createdAt: true, leadSource: true, leadAttribution: true,
      kycRecord: { select: { status: true, completionDate: true } },
      fundingRecord: { select: { status: true, fundingDate: true, amount: true } },
    },
  });
  if (!client) return null;
  const [ctx, settings, intakes, partner, referral, kycSteps, payments, firstTx, revenue, signals] = await Promise.all([
    loadAttributionContext(now),
    loadSettings(),
    prisma.leadIntake.findMany({ where: { clientId }, select: { source: true, externalId: true, receivedAt: true, rawPayload: true }, orderBy: { receivedAt: "asc" }, take: 50 }),
    prisma.partnerReferralTouch.findUnique({ where: { clientId }, select: { code: true, touchedAt: true, source: true } }),
    prisma.referral.findUnique({ where: { referredClientId: clientId }, select: { outcome: true, attributedAt: true, codeId: true } }),
    prisma.kycStep.findMany({ where: { clientId }, orderBy: { createdAt: "asc" }, select: { type: true, status: true, createdAt: true, decidedAt: true, statusChangedAt: true } }),
    prisma.clientPayment.findMany({ where: { clientId, paymentType: "FUNDS_IN", status: "SUCCESS" }, orderBy: { paidAt: "asc" }, select: { paidAt: true, amount: true } }),
    prisma.transaction.findFirst({ where: { tradingAccount: { clientId } }, orderBy: { transactionDate: "asc" }, select: { transactionDate: true } }),
    prisma.revenueEvent.findMany({ where: { clientId }, select: { id: true, revenueType: true, grossRevenueAmount: true, eventDate: true, reversesEventId: true, reverses: { select: { revenueType: true } } } }),
    loadContactSignals([clientId]),
  ]);
  const code = referral?.outcome === "ATTRIBUTED" && referral.codeId ? (await prisma.referralCode.findUnique({ where: { id: referral.codeId }, select: { code: true } }))?.code ?? null : null;
  const fundedAt = fundedAtOf({ payments: payments.map((p) => p.paidAt), funding: client.fundingRecord });
  const input: AttributionInput = {
    clientId, createdAt: client.createdAt, leadSource: client.leadSource,
    leadAttribution: client.leadAttribution && typeof client.leadAttribution === "object" && !Array.isArray(client.leadAttribution) ? (client.leadAttribution as Record<string, unknown>) : null,
    intakes: intakes.map(intakeTouch),
    partner: partner ? { code: partner.code, at: partner.touchedAt, source: partner.source } : null,
    referral: referral?.outcome === "ATTRIBUTED" ? { code, at: referral.attributedAt } : null,
    fundedAt,
  };
  const attribution = attribute(input, ctx);
  const rev = revenueSummary(revenue.map((e) => ({ id: e.id, revenueType: e.revenueType, amount: Number(e.grossRevenueAmount), reversesEventId: e.reversesEventId, reversedType: e.reverses?.revenueType ?? null, eventDate: e.eventDate })));
  const fundedAmount = payments[0] ? Number(payments[0].amount) : client.fundingRecord?.amount ? Number(client.fundingRecord.amount) : null;
  const journey = buildJourney({
    now, createdAt: client.createdAt, attribution, slaMinutes: settings.slaMinutes,
    firstContactAt: firstContactAt(signals.get(clientId) ?? [], client.createdAt),
    kycSteps: kycSteps.map((k) => ({ type: k.type, status: k.status, startedAt: k.createdAt, decidedAt: k.decidedAt })),
    kycApprovedAt: client.kycRecord?.status === "APPROVED" ? client.kycRecord.completionDate ?? null : null,
    firstFundedAt: fundedAt, firstFundedAmount: fundedAmount,
    firstTransactionAt: firstTx?.transactionDate ?? null,
    firstRevenueAt: rev.firstAt, revenueToDate: rev.total,
  });
  return { journey, attribution, settings };
}

// ---------- lead push wiring ----------

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

async function pool(): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { isActive: true, role: { in: ["MANAGER", "ADMIN"] } }, select: { id: true } });
  return rows.map((r) => r.id);
}

export function pushDeps(): PushDeps {
  const gate = consentGate("MARKETING_COMMS", "whatsapp");
  return {
    now: () => new Date(),
    settings: loadSettings,
    createPush: async (row) => {
      try {
        const created = await prisma.leadPush.create({ data: { clientId: row.clientId, intakeKey: row.intakeKey, assignedToId: row.assignedToId, context: row.context as unknown as Prisma.InputJsonValue, slaMinutes: row.slaMinutes, dueAt: row.dueAt }, select: { id: true } });
        return { created: true, id: created.id };
      } catch (e) {
        if (!isUnique(e)) throw e;
        const existing = await prisma.leadPush.findUnique({ where: { intakeKey: row.intakeKey }, select: { id: true } });
        return { created: false, id: existing?.id ?? "" };
      }
    },
    notify: async (userIds, type, payload) => {
      // One create per person (not createMany): each Notification create is what triggers the phone push.
      await Promise.all(userIds.map((userId) => prisma.notification.create({ data: { userId, type, payload: payload as Prisma.InputJsonValue } })));
    },
    pool,
    createDraft: async (args) => {
      // Same three gates as every draft-only agent: the agent switch, the consent gate, and "one open draft at a time".
      if (!(await agentEnabled(LEAD_DRAFT_AGENT_KEY, process.env, (key) => prisma.agentSetting.findUnique({ where: { agentKey: key }, select: { enabled: true } })))) return { status: "skipped", reason: "agent is disabled" };
      const decision = gate ? await gate(args.clientId) : { allowed: true as const };
      if (!decision.allowed) return { status: "skipped", reason: "no consent" };
      const open = await prisma.agentProposal.count({ where: { clientId: args.clientId, agentKey: LEAD_DRAFT_AGENT_KEY, OR: [{ status: "DRAFT", expiresAt: { gt: new Date() } }, { status: "APPROVED" }] } });
      if (open > 0) return { status: "skipped", reason: "already has a draft" };
      const body = firstMessageDraft({ firstName: args.firstName, rmFirstName: args.rmFirstName, campaign: args.campaign, productInterest: args.productInterest });
      const verdict = checkOutbound(body);
      const saved = await prisma.agentProposal.create({
        data: {
          agentKey: LEAD_DRAFT_AGENT_KEY, clientId: args.clientId, programme: "New lead", body, originalBody: body, reason: args.reason,
          status: verdict.ok ? "DRAFT" : "BLOCKED", blockedReason: verdict.ok ? null : `${verdict.code}: ${verdict.detail}`,
          provider: "rules", model: "template-v1", inputTokens: 0, outputTokens: 0, expiresAt: new Date(Date.now() + LEAD_DRAFT_TTL_MS),
        },
        select: { id: true },
      });
      return verdict.ok ? { status: "drafted", proposalId: saved.id } : { status: "blocked", reason: verdict.detail, proposalId: saved.id };
    },
    attachDraft: async (pushId, proposalId) => void (await prisma.leadPush.update({ where: { id: pushId }, data: { draftProposalId: proposalId } })),
    events: pushEvents,
  };
}

export function sweepDeps(): SweepDeps {
  return {
    now: () => new Date(),
    settings: loadSettings,
    listOpen: async (): Promise<OpenPush[]> => {
      const rows = await prisma.leadPush.findMany({ where: { status: { in: ["OPEN", "ESCALATED"] } }, orderBy: { dueAt: "asc" }, take: 200, select: { id: true, clientId: true, assignedToId: true, slaMinutes: true, dueAt: true, status: true, createdAt: true, context: true, client: { select: { name: true } } } });
      return rows.map((r) => ({ id: r.id, clientId: r.clientId, clientName: r.client.name, assignedToId: r.assignedToId, slaMinutes: r.slaMinutes, dueAt: r.dueAt, status: r.status, createdAt: r.createdAt, campaign: (r.context as { campaign?: string | null } | null)?.campaign ?? null }));
    },
    contactedAt: async (push) => firstContactAt((await loadContactSignals([push.clientId])).get(push.clientId) ?? [], push.createdAt),
    escalationTargets: async (push) => {
      const rm = push.assignedToId ? await prisma.user.findUnique({ where: { id: push.assignedToId }, select: { manager: { select: { id: true, isActive: true } } } }) : null;
      if (rm?.manager?.isActive) return [rm.manager.id];
      return pool();
    },
    createTask: async (task) => ({ id: (await createTaskIfNotExists(task)).id }),
    notify: async (userIds, type, payload) => void (await Promise.all(userIds.map((userId) => prisma.notification.create({ data: { userId, type, payload: payload as Prisma.InputJsonValue } })))),
    update: async (id, data) => void (await prisma.leadPush.update({ where: { id }, data: data as Prisma.LeadPushUpdateInput })),
    events: sweepEvents,
  };
}

/** The lead-clock event consumer's database side: the same open-push query and the same definition of contact as the sweep. */
export function clockDeps(): ClockDeps {
  const sweep = sweepDeps();
  return {
    openFor: async (clientId) => {
      const rows = await prisma.leadPush.findMany({ where: { clientId, status: "OPEN" }, take: 20, select: { id: true, clientId: true, assignedToId: true, slaMinutes: true, dueAt: true, status: true, createdAt: true, client: { select: { name: true } }, context: true } });
      return rows.map((r) => ({ id: r.id, clientId: r.clientId, clientName: r.client.name, assignedToId: r.assignedToId, slaMinutes: r.slaMinutes, dueAt: r.dueAt, status: r.status, createdAt: r.createdAt, campaign: (r.context as { campaign?: string | null } | null)?.campaign ?? null }));
    },
    contactedAt: sweep.contactedAt,
    update: sweep.update,
    events: sweepEvents,
  };
}
