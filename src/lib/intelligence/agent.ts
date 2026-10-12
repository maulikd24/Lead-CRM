import { prisma } from "@/lib/db/prisma";
import { safeEqual } from "@/lib/security/webhook-auth";
import { ASSET_CLASSES, OUTCOMES } from "./constants";
import { computeIntelligence, refreshCustomerIntelligence } from "./refresh";
import { loadCustomerFacts } from "./facts";

/**
 * Everything an AI agent (WhatsApp, calling, KYC or funding bot) must know BEFORE it speaks to a customer, and the way
 * it reports back. The Intelligence Engine decides what should happen; the agent decides how to hold the conversation.
 * Humans and agents read the same briefing, so there is one consistent understanding of the customer.
 */

export type AgentBriefing = Awaited<ReturnType<typeof buildAgentBriefing>>;

/**
 * `persist: false` is the read-only variant for automated callers (the nudger cron): it computes the intelligence in memory
 * and writes NOTHING (no intelligence/segment rows) and fires no journey trigger. The default (persist) refreshes and stores
 * the intelligence first, which can enrol the customer in journeys that send messages without per-message approval.
 */
export async function buildAgentBriefing(clientId: string, opts: { includeContact?: boolean; persist?: boolean } = {}) {
  const result = opts.persist === false ? await computeOnly(clientId) : await refreshCustomerIntelligence(clientId);
  if (!result) return null;
  const { facts, lifecycle, acceptance, situations, nba } = result;

  const [client, recent] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { id: true, clientCode: true, name: true, mobile: true, email: true, preferredLanguage: true, region: true, assignedTo: { select: { name: true } } } }),
    prisma.activity.findMany({ where: { clientId, type: { in: ["CALL", "MESSAGE", "NOTE", "TICKET"] } }, orderBy: { createdAt: "desc" }, take: 8, select: { type: true, createdAt: true, payload: true } }),
  ]);
  if (!client) return null;

  const open = facts.insights.filter((i) => i.status === "OPEN");
  const said = (kinds: string[]) => facts.insights.filter((i) => kinds.includes(i.kind)).slice(0, 6).map((i) => ({ kind: i.kind.toLowerCase(), assetClass: i.assetClass, text: i.text, date: i.occurredAt.toISOString().slice(0, 10) }));

  return {
    generatedAt: facts.now.toISOString(),
    customer: {
      id: client.id,
      code: client.clientCode,
      name: client.name,
      category: facts.client.customerCategory,
      lifecycleStage: lifecycle,
      preferredLanguage: client.preferredLanguage,
      region: client.region,
      relationshipManager: client.assignedTo?.name ?? null,
      ...(opts.includeContact ? { mobile: client.mobile, email: client.email } : {}),
    },
    whyContactingNow: {
      programme: nba.programme,
      action: nba.action,
      topic: nba.topic,
      reason: nba.reason,
      priority: nba.priority,
      timing: nba.timing,
      owner: nba.owner,
    },
    suggestedTalkingPoints: nba.talkingPoints,
    mustNotDiscuss: nba.doNotDiscuss,
    currentSituations: situations.map((s) => ({ key: s.key, label: s.label, severity: s.severity, detail: s.detail })),
    relationship: {
      portfolioValueInr: Math.round(facts.portfolio.aum),
      holdings: facts.portfolio.holds,
      allocation: facts.portfolio.allocation.map((a) => ({ bucket: a.bucket, percent: Math.round(a.pct) })),
      riskProfile: facts.wealth.riskProfile,
      tradedInLast90Days: facts.trading.last90 > 0,
      heldElsewhereEstimates: { portfolioInr: facts.intel.externalPortfolio, mutualFundsInr: facts.intel.mfTransfer, idleCashInr: facts.intel.idleCash },
    },
    assetClassAcceptance: Object.fromEntries(ASSET_CLASSES.map((c) => [c, { level: acceptance[c].level.toLowerCase(), because: acceptance[c].reason }])),
    whatTheyHaveTold: {
      interests: said(["INTEREST"]),
      objections: said(["OBJECTION"]),
      concerns: said(["CONCERN"]),
      questions: said(["QUESTION"]),
      declined: said(["DECLINED"]),
    },
    pendingCommitments: open.filter((i) => i.kind === "COMMITMENT").map((i) => ({ text: i.text, due: i.dueAt?.toISOString().slice(0, 10) ?? null })),
    openIssues: open.filter((i) => ["COMPLAINT", "INCORRECT_INFO", "COMPLIANCE_CONCERN"].includes(i.kind)).map((i) => ({ kind: i.kind.toLowerCase(), text: i.text, severity: i.severity })),
    recentInteractions: recent.map((a) => {
      const p = (a.payload ?? {}) as Record<string, unknown>;
      return { channel: a.type.toLowerCase(), date: a.createdAt.toISOString().slice(0, 10), summary: String(p.message ?? p.subject ?? "").slice(0, 240) };
    }),
    previousOutcomes: facts.outcomes.slice(0, 5).map((o) => ({ outcome: o.outcome.toLowerCase(), assetClass: o.assetClass, date: o.createdAt.toISOString().slice(0, 10) })),
    handoverRules: [
      "Hand over to the RM when the customer shows serious investment interest, needs personalised advice, has a high-value opportunity, asks a complex question, or raises a sensitive service issue.",
      "Do not give investment advice or promise returns. Do not start a sales pitch while an open service issue exists.",
      "Start from the customer's situation, not from the product.",
    ],
    reportBackWith: { endpoint: "POST /api/agent/outcome", outcomes: OUTCOMES.map((o) => o.value.toLowerCase()), requires: "summary for rm_handover; note for service_issue" },
  };
}

async function computeOnly(clientId: string) {
  const facts = await loadCustomerFacts(clientId);
  return facts ? computeIntelligence(facts) : null;
}

/** Machine-to-machine auth for agents: a shared bearer key, compared in constant time; refuses everything if unset. */
export function authenticateAgent(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/.exec(header);
  return !!match && safeEqual(match[1], process.env.AGENT_API_KEY);
}
