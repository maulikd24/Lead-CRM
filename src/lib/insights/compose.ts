import { OUTCOMES } from "@/lib/intelligence/constants";
import { agentQuality, type AgentQuality, type ProposalRow } from "./agent-quality";
import {
  attachDraftContext, byAssetClass, byChannel, byLanguage, byProgramme, byRm, conversionWithin, objectionLeaderboard, outcomeMix, responseTimes, stageFunnel,
  type ConversionGroup, type FunnelRow, type InboundRow, type Milestones, type ObjectionRow, type OutcomeMixGroup, type OutcomeRow, type StageDef,
} from "./response-analytics";
import { buildSuggestions, type Suggestion } from "./suggestions";

export const CONVERSION_DAYS = 14;
export const REPLY_WINDOW_HOURS = 72;

export type RawInsights = {
  now: Date;
  days: number;
  outcomes: OutcomeRow[];
  /** Drafts sent from `range.from - 7d`, used only to tag outcomes that followed an AI draft. */
  sentDrafts: { clientId: string; sentAt: Date }[];
  /** Conversion cohorts: outcomes and sent drafts that are at least CONVERSION_DAYS old, independent of the selected range. */
  conversionOutcomes: { clientId: string; outcome: string; at: Date }[];
  conversionDrafts: { clientId: string; sentAt: Date }[];
  proposals: ProposalRow[];
  /** Outbound WhatsApp messages in the period; `viaAgent` when the message came from an approved agent draft. */
  outbound: { id: string; clientId: string; sentAt: Date; language: string | null; viaAgent: boolean }[];
  inbound: InboundRow[];
  milestones: Map<string, Milestones>;
  objectionsCurrent: { assetClass: string | null; text: string }[];
  objectionsPrevious: { assetClass: string | null; text: string }[];
  stages: StageDef[];
  journeyClients: { id: string; createdAt: Date; currentStageId: string }[];
  history: { clientId: string; fromStageId: string | null; toStageId: string; changedAt: Date }[];
  /** First name and client code only. */
  drilldown: { clientId: string; firstName: string; clientCode: string; outcome: string; assetClass: string | null; at: Date }[];
  truncated: boolean;
};

export type InsightsData = {
  days: number;
  truncated: boolean;
  kpis: { outcomes: number; positiveRate: number | null; replyRate: number | null; medianReplyHours: number | null; draftsGenerated: number; approvalRate: number | null; costPerApprovedUsd: number | null; costAvailable: boolean; costPartial: boolean };
  mix: { assetClass: OutcomeMixGroup[]; programme: OutcomeMixGroup[]; channel: OutcomeMixGroup[]; language: OutcomeMixGroup[]; rm: OutcomeMixGroup[] };
  response: ReturnType<typeof responseTimes>;
  conversion: { days: number; immature: number; byOutcome: ConversionGroup[]; afterDraft: ConversionGroup | null };
  objections: { rows: ObjectionRow[]; themes: string[] };
  funnel: FunnelRow[];
  agents: AgentQuality[];
  suggestions: Suggestion[];
  aiVsRm: { a: { successes: number; n: number }; b: { successes: number; n: number } } | null;
  drilldown: { clientId: string; firstName: string; clientCode: string; outcomeLabel: string; assetClass: string | null; at: string }[];
};

const label = (v: string) => OUTCOMES.find((o) => o.value === v)?.label ?? v;

export function composeInsights(raw: RawInsights): InsightsData {
  const outcomes = attachDraftContext(raw.outcomes, raw.sentDrafts, 7);
  const mix = {
    assetClass: outcomeMix(outcomes, byAssetClass),
    programme: outcomeMix(outcomes, byProgramme),
    channel: outcomeMix(outcomes, byChannel),
    language: outcomeMix(outcomes, byLanguage),
    rm: outcomeMix(outcomes, byRm),
  };

  const response = responseTimes(
    raw.outbound.map((o) => ({ id: o.id, clientId: o.clientId, sentAt: o.sentAt, language: o.language, group: o.viaAgent ? "AI draft" : "RM / manual" })),
    raw.inbound,
    { windowHours: REPLY_WINDOW_HOURS, now: raw.now },
  );

  const outcomeEvents = raw.conversionOutcomes.map((o) => ({ clientId: o.clientId, at: o.at, group: label(o.outcome) }));
  const draftEvents = raw.conversionDrafts.map((d) => ({ clientId: d.clientId, at: d.sentAt, group: "AI draft sent" }));
  const byOutcome = conversionWithin(outcomeEvents, raw.milestones, CONVERSION_DAYS, raw.now);
  const afterDraft = conversionWithin(draftEvents, raw.milestones, CONVERSION_DAYS, raw.now);

  const objections = objectionLeaderboard(raw.objectionsCurrent, raw.objectionsPrevious);
  const funnel = stageFunnel(raw.stages, raw.journeyClients, raw.history);
  const agents = agentQuality(raw.proposals, raw.now);

  const ai = response.byGroup.find((g) => g.key === "AI draft");
  const rm = response.byGroup.find((g) => g.key === "RM / manual");
  const aiVsRm = ai || rm ? { a: { successes: ai?.replied ?? 0, n: ai?.sent ?? 0 }, b: { successes: rm?.replied ?? 0, n: rm?.sent ?? 0 } } : null;

  const suggestions = buildSuggestions({ assetClassMix: mix.assetClass, programmeMix: mix.programme, agents, objections: objections.rows, funnel, aiVsRm });

  const generated = agents.reduce((s, a) => s + a.generated, 0);
  const offered = agents.reduce((s, a) => s + a.offered, 0);
  const approved = agents.reduce((s, a) => s + a.approved, 0);
  const costs = agents.map((a) => a.cost.usd);
  const costAvailable = approved > 0 && costs.every((c) => c !== null);
  const totalCost = costAvailable ? (costs as number[]).reduce((s, c) => s + c, 0) : null;
  // A lower bound when the row cap cut the period short or a model is missing from the price table.
  const costPartial = raw.truncated || agents.some((a) => a.cost.partial || a.cost.unknownModels.length > 0);
  const positive = outcomes.filter((o) => o.outcome === "INTERESTED" || o.outcome === "CONVERTED").length;

  return {
    days: raw.days,
    truncated: raw.truncated,
    kpis: {
      outcomes: outcomes.length,
      positiveRate: outcomes.length ? positive / outcomes.length : null,
      replyRate: response.overall.replyRate,
      medianReplyHours: response.overall.medianHours,
      draftsGenerated: generated,
      approvalRate: offered ? approved / offered : null,
      costPerApprovedUsd: totalCost !== null ? totalCost / approved : null,
      costAvailable,
      costPartial,
    },
    mix,
    response,
    conversion: { days: CONVERSION_DAYS, immature: byOutcome.immature, byOutcome: byOutcome.groups, afterDraft: afterDraft.groups[0] ?? null },
    objections,
    funnel,
    agents,
    suggestions,
    aiVsRm,
    drilldown: raw.drilldown.map((d) => ({ clientId: d.clientId, firstName: d.firstName, clientCode: d.clientCode, outcomeLabel: label(d.outcome), assetClass: d.assetClass, at: d.at.toISOString() })),
  };
}
