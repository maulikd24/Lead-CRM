import { prisma } from "@/lib/db/prisma";
import type { Role } from "@/generated/prisma/client";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { managementScope } from "@/lib/intelligence/management";
import type { ProposalRow } from "./agent-quality";
import { composeInsights, type InsightsData, type RawInsights } from "./compose";
import { resolveRange } from "./range";
import type { Milestones, OutcomeRow } from "./response-analytics";

const DAY = 86_400_000;
/** Upper bound per query so a very busy period cannot exhaust memory. `truncated` is surfaced on the page when hit. */
const ROW_CAP = 20_000;
const FUNDED = new Set(["PARTIALLY_FUNDED", "FULLY_FUNDED"]);

/**
 * Loads one period of learning-loop data for the viewer. Every query is scoped through the same visibility rules as the
 * intelligence page (ADMIN everyone, MANAGER their team, RM only themselves), filtered on indexed columns
 * (InteractionOutcome createdAt, AgentProposal createdAt, Message clientId/createdAt) and selects only what the
 * aggregations need. Aggregation itself is pure (compose.ts).
 */
export async function loadInsights(user: { id: string; role: Role }, daysParam: string | string[] | undefined, now = new Date()): Promise<InsightsData> {
  const range = resolveRange(daysParam, now);
  const visible = await getVisibleUserIds(user.id, user.role);
  const scope = managementScope(visible, user.role === "MANAGER");
  const inScope = { client: scope };

  const [outcomeRows, sentRows, proposalRows, outboundRows, inboundRows, objectionRows, stages, journeyClients, drillRows] = await Promise.all([
    prisma.interactionOutcome.findMany({
      where: { createdAt: { gte: range.from }, ...inScope },
      select: { clientId: true, outcome: true, channel: true, actorType: true, assetClass: true, programme: true, createdAt: true, client: { select: { preferredLanguage: true, assignedTo: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: "desc" },
      take: ROW_CAP,
    }),
    prisma.agentProposal.findMany({
      where: { status: "SENT", decidedAt: { gte: new Date(range.from.getTime() - 7 * DAY) }, ...inScope },
      select: { clientId: true, decidedAt: true },
      take: ROW_CAP,
    }),
    prisma.agentProposal.findMany({
      where: { createdAt: { gte: range.from }, ...inScope },
      select: { agentKey: true, status: true, blockedReason: true, model: true, inputTokens: true, outputTokens: true, body: true, originalBody: true, programme: true, createdAt: true, decidedAt: true, decidedById: true, expiresAt: true, messageId: true },
      orderBy: { createdAt: "desc" },
      take: ROW_CAP,
    }),
    prisma.message.findMany({
      where: { direction: "OUTBOUND", channel: "whatsapp", createdAt: { gte: range.from }, ...inScope },
      select: { id: true, clientId: true, createdAt: true, client: { select: { preferredLanguage: true } } },
      orderBy: { createdAt: "desc" },
      take: ROW_CAP,
    }),
    prisma.message.findMany({
      where: { direction: "INBOUND", channel: "whatsapp", createdAt: { gte: range.from }, ...inScope },
      select: { clientId: true, createdAt: true },
      take: ROW_CAP * 2,
    }),
    prisma.conversationInsight.findMany({
      where: { kind: "OBJECTION", occurredAt: { gte: range.prevFrom }, ...inScope },
      select: { assetClass: true, text: true, occurredAt: true },
      take: ROW_CAP,
    }),
    prisma.stage.findMany({ where: { isActive: true }, select: { id: true, name: true, sequence: true } }),
    prisma.client.findMany({ where: { AND: [scope, { createdAt: { gte: range.from } }] }, select: { id: true, createdAt: true, currentStageId: true }, take: ROW_CAP }),
    prisma.interactionOutcome.findMany({
      where: { createdAt: { gte: range.from }, outcome: { in: ["NOT_INTERESTED", "RM_HANDOVER", "SERVICE_ISSUE"] }, ...inScope },
      select: { outcome: true, assetClass: true, createdAt: true, client: { select: { id: true, name: true, clientCode: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);
  const truncated = [outcomeRows, sentRows, proposalRows, outboundRows, objectionRows, journeyClients].some((r) => r.length >= ROW_CAP) || inboundRows.length >= ROW_CAP * 2;

  const history = journeyClients.length
    ? await prisma.stageHistory.findMany({ where: { clientId: { in: journeyClients.map((c) => c.id) } }, select: { clientId: true, fromStageId: true, toStageId: true, changedAt: true }, take: ROW_CAP * 2 })
    : [];

  // KYC approval and first funding dates, for the customers who had an outcome or a sent draft.
  const milestoneIds = [...new Set([...outcomeRows.map((o) => o.clientId), ...sentRows.map((s) => s.clientId)])];
  const milestones = new Map<string, Milestones>();
  for (let i = 0; i < milestoneIds.length; i += 2000) {
    const rows = await prisma.client.findMany({
      where: { id: { in: milestoneIds.slice(i, i + 2000) } },
      select: { id: true, kycRecord: { select: { status: true, completionDate: true, updatedAt: true } }, fundingRecord: { select: { status: true, fundingDate: true, updatedAt: true } } },
    });
    for (const c of rows) {
      milestones.set(c.id, {
        kycAt: c.kycRecord?.status === "APPROVED" ? (c.kycRecord.completionDate ?? c.kycRecord.updatedAt) : null,
        fundedAt: c.fundingRecord && FUNDED.has(c.fundingRecord.status) ? (c.fundingRecord.fundingDate ?? c.fundingRecord.updatedAt) : null,
      });
    }
  }

  const agentMessageIds = new Set(proposalRows.flatMap((p) => (p.messageId ? [p.messageId] : [])));

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
    proposals: proposalRows as ProposalRow[],
    outbound: outboundRows.map((m) => ({ id: m.id, clientId: m.clientId, sentAt: m.createdAt, language: m.client.preferredLanguage, viaAgent: agentMessageIds.has(m.id) })),
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
