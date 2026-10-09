import { prisma } from "@/lib/db/prisma";
import type { Role } from "@/generated/prisma/client";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { managementScope } from "@/lib/intelligence/management";
import type { ProposalRow } from "./agent-quality";
import { composeInsights, CONVERSION_DAYS, type InsightsData, type RawInsights } from "./compose";
import { resolveRange } from "./range";
import type { Milestones, OutcomeRow } from "./response-analytics";

const DAY = 86_400_000;
/** Upper bound per query so a very busy period cannot exhaust memory. `truncated` is surfaced on the page when hit. */
const ROW_CAP = 20_000;
const CONVERSION_MS = CONVERSION_DAYS * DAY;
const FUNDED = new Set(["PARTIALLY_FUNDED", "FULLY_FUNDED"]);

/**
 * Loads one period of learning-loop data for the viewer. Every query is scoped through the same visibility rules as the
 * intelligence page (ADMIN everyone, MANAGER their team, RM only themselves), date-bounded and select only what the
 * aggregations need. Several date filters (Message direction/channel/createdAt, InteractionOutcome createdAt,
 * AgentProposal decidedAt) have no matching index yet, so they scan; see the follow-up in docs/agents.md. Every capped
 * query has an explicit newest-first order, so a truncated period always keeps the most recent rows. Aggregation itself
 * is pure (compose.ts).
 */
export async function loadInsights(user: { id: string; role: Role }, daysParam: string | string[] | undefined, now = new Date()): Promise<InsightsData> {
  const range = resolveRange(daysParam, now);
  const visible = await getVisibleUserIds(user.id, user.role);
  const scope = managementScope(visible, user.role === "MANAGER");
  const inScope = { client: scope };
  // Conversion cohorts are loaded independently of the range: events old enough to have had the full window, starting one window before the range.
  const cohort = { gte: new Date(range.from.getTime() - CONVERSION_MS), lte: new Date(now.getTime() - CONVERSION_MS) };

  const [outcomeRows, sentRows, conversionOutcomeRows, conversionDraftRows, proposalRows, outboundRows, inboundRows, objectionRows, stages, journeyClients, drillRows] = await Promise.all([
    prisma.interactionOutcome.findMany({
      where: { createdAt: { gte: range.from }, ...inScope },
      select: { clientId: true, outcome: true, channel: true, actorType: true, assetClass: true, programme: true, createdAt: true, client: { select: { preferredLanguage: true, assignedTo: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: "desc" },
      take: ROW_CAP,
    }),
    prisma.agentProposal.findMany({
      where: { status: "SENT", decidedAt: { gte: new Date(range.from.getTime() - 7 * DAY) }, ...inScope },
      select: { clientId: true, decidedAt: true },
      orderBy: { decidedAt: "desc" },
      take: ROW_CAP,
    }),
    prisma.interactionOutcome.findMany({
      where: { createdAt: cohort, ...inScope },
      select: { clientId: true, outcome: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: ROW_CAP,
    }),
    prisma.agentProposal.findMany({
      where: { status: "SENT", decidedAt: cohort, ...inScope },
      select: { clientId: true, decidedAt: true },
      orderBy: { decidedAt: "desc" },
      take: ROW_CAP,
    }),
    prisma.agentProposal.findMany({
      where: { createdAt: { gte: range.from }, ...inScope },
      select: { agentKey: true, status: true, blockedReason: true, model: true, inputTokens: true, outputTokens: true, body: true, originalBody: true, programme: true, createdAt: true, decidedAt: true, decidedById: true, expiresAt: true, messageId: true },
      orderBy: { createdAt: "desc" },
      take: ROW_CAP,
    }),
    prisma.message.findMany({
      where: { direction: "OUTBOUND", channel: "whatsapp", status: { in: ["SENT", "DELIVERED", "READ"] }, createdAt: { gte: range.from }, ...inScope },
      select: { id: true, clientId: true, createdAt: true, sentAt: true, client: { select: { preferredLanguage: true } } },
      orderBy: { createdAt: "desc" },
      take: ROW_CAP,
    }),
    prisma.message.findMany({
      where: { direction: "INBOUND", channel: "whatsapp", createdAt: { gte: range.from }, ...inScope },
      select: { clientId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: ROW_CAP * 2,
    }),
    prisma.conversationInsight.findMany({
      where: { kind: "OBJECTION", occurredAt: { gte: range.prevFrom }, ...inScope },
      select: { assetClass: true, text: true, occurredAt: true },
      orderBy: { occurredAt: "desc" },
      take: ROW_CAP,
    }),
    prisma.stage.findMany({ where: { isActive: true }, select: { id: true, name: true, sequence: true } }),
    prisma.client.findMany({ where: { AND: [scope, { createdAt: { gte: range.from } }] }, select: { id: true, createdAt: true, currentStageId: true }, orderBy: { createdAt: "desc" }, take: ROW_CAP }),
    prisma.interactionOutcome.findMany({
      where: { createdAt: { gte: range.from }, outcome: { in: ["NOT_INTERESTED", "RM_HANDOVER", "SERVICE_ISSUE"] }, ...inScope },
      select: { outcome: true, assetClass: true, createdAt: true, client: { select: { id: true, name: true, clientCode: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const history = journeyClients.length
    ? await prisma.stageHistory.findMany({ where: { clientId: { in: journeyClients.map((c) => c.id) } }, select: { clientId: true, fromStageId: true, toStageId: true, changedAt: true }, orderBy: { changedAt: "desc" }, take: ROW_CAP * 2 })
    : [];
  const truncated =
    [outcomeRows, sentRows, conversionOutcomeRows, conversionDraftRows, proposalRows, outboundRows, objectionRows, journeyClients].some((r) => r.length >= ROW_CAP) ||
    inboundRows.length >= ROW_CAP * 2 ||
    history.length >= ROW_CAP * 2;

  // KYC approval and first funding dates, for the customers in the conversion cohorts. A milestone without a recorded date is left unknown (null), never guessed from updatedAt.
  const milestoneIds = [...new Set([...conversionOutcomeRows.map((o) => o.clientId), ...conversionDraftRows.map((s) => s.clientId)])];
  const milestones = new Map<string, Milestones>();
  for (let i = 0; i < milestoneIds.length; i += 2000) {
    const rows = await prisma.client.findMany({
      where: { AND: [scope, { id: { in: milestoneIds.slice(i, i + 2000) } }] },
      select: { id: true, kycRecord: { select: { status: true, completionDate: true } }, fundingRecord: { select: { status: true, fundingDate: true } } },
    });
    for (const c of rows) {
      milestones.set(c.id, {
        kycAt: c.kycRecord?.status === "APPROVED" ? c.kycRecord.completionDate : null,
        fundedAt: c.fundingRecord && FUNDED.has(c.fundingRecord.status) ? c.fundingRecord.fundingDate : null,
      });
    }
  }

  // Which outbound messages came from an approved agent draft, whenever the draft was created (it may predate the range).
  const agentMessageIds = new Set<string>();
  for (let i = 0; i < outboundRows.length; i += 2000) {
    const linked = await prisma.agentProposal.findMany({ where: { messageId: { in: outboundRows.slice(i, i + 2000).map((m) => m.id) }, ...inScope }, select: { messageId: true } });
    for (const p of linked) if (p.messageId) agentMessageIds.add(p.messageId);
  }

  const outcomes: OutcomeRow[] = outcomeRows.map((o) => ({
    clientId: o.clientId,
    outcome: o.outcome,
    channel: o.channel,
    actorType: o.actorType,
    rmId: o.client.assignedTo?.id ?? null,
    rmName: o.client.assignedTo?.name ?? "Unassigned",
    assetClass: o.assetClass,
    programme: o.programme,
    language: o.client.preferredLanguage,
    createdAt: o.createdAt,
    aiDraftSent: false,
  }));

  const raw: RawInsights = {
    now,
    days: range.days,
    outcomes,
    sentDrafts: sentRows.flatMap((s) => (s.decidedAt ? [{ clientId: s.clientId, sentAt: s.decidedAt }] : [])),
    conversionOutcomes: conversionOutcomeRows.map((o) => ({ clientId: o.clientId, outcome: o.outcome, at: o.createdAt })),
    conversionDrafts: conversionDraftRows.flatMap((s) => (s.decidedAt ? [{ clientId: s.clientId, sentAt: s.decidedAt }] : [])),
    proposals: proposalRows as ProposalRow[],
    outbound: outboundRows.map((m) => ({ id: m.id, clientId: m.clientId, sentAt: m.sentAt ?? m.createdAt, language: m.client.preferredLanguage, viaAgent: agentMessageIds.has(m.id) })),
    inbound: inboundRows.map((m) => ({ clientId: m.clientId, at: m.createdAt })),
    milestones,
    objectionsCurrent: objectionRows.filter((o) => o.occurredAt >= range.from).map((o) => ({ assetClass: o.assetClass, text: o.text })),
    objectionsPrevious: objectionRows.filter((o) => o.occurredAt < range.from).map((o) => ({ assetClass: o.assetClass, text: o.text })),
    stages,
    journeyClients,
    history,
    drilldown: drillRows.map((d) => ({ clientId: d.client.id, firstName: d.client.name.trim().split(/\s+/)[0] ?? "", clientCode: d.client.clientCode, outcome: d.outcome, assetClass: d.assetClass, at: d.createdAt })),
    truncated,
  };
  return composeInsights(raw);
}
