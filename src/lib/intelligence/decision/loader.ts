// Database side of the engine: builds the plain-data inputs (GateContext, AdapterInput, the legacy opinion) for one customer.
// Read-only. Every query is for ONE customer, so cost scales with the number of customers refreshed, not with the table.
import { basePrisma, prisma } from "@/lib/db/prisma";
import { loadSnapshots } from "@/lib/consent/store-prisma";
import { resolvePolicy } from "@/lib/consent/policy";
import { getCrossSellFlags } from "@/lib/copilot/cross-sell";
import { loadOutcomeBundles } from "@/lib/outcomes/loaders";
import { evaluateRules } from "@/lib/outcomes/rules";
import { loadCustomerFacts, type CustomerFacts } from "../facts";
import { computeIntelligence, type IntelligenceResult } from "../refresh";
import { blockedAssetClasses } from "../nba";
import { isAssetClass } from "../constants";
import { DAY_MS, ENGINE_CONFIG } from "./constants";
import type { AdapterInput } from "./candidates/types";
import type { GateContext } from "./gate-context";
import { defaultSeams, type DecisionSeams } from "./seams";
import type { LegacyOpinion } from "./types";

export type DecisionInput = { gate: GateContext; adapter: AdapterInput; legacy: LegacyOpinion | null; factsMissing: boolean };

const CONTACT_TYPES = ["CALL", "MESSAGE", "MEETING", "CONTACT"] as const;

export function legacyOpinionOf(result: Pick<IntelligenceResult, "nba">): LegacyOpinion {
  const n = result.nba;
  return { source: "intelligence_nba", programme: n.programme, action: n.action, topic: n.topic, owner: n.owner, priority: n.priority, doNotDiscuss: n.doNotDiscuss };
}

export async function loadDecisionInput(clientId: string, opts: { now?: Date; result?: IntelligenceResult | null; seams?: Partial<DecisionSeams> } = {}): Promise<DecisionInput | null> {
  const now = opts.now ?? new Date();
  const seams = { ...defaultSeams(), ...opts.seams };
  const facts: CustomerFacts | null = opts.result?.facts ?? (await loadCustomerFacts(clientId, now));
  if (!facts) return null;
  const intel = opts.result ?? computeIntelligence(facts);

  const complaintSince = new Date(now.getTime() - ENGINE_CONFIG.complaintWindowDays * DAY_MS);
  const unreachSince = new Date(now.getTime() - ENGINE_CONFIG.unreachableWindowDays * DAY_MS);
  const [consentSnap, lastContact, lastOutbound, lastInbound, template, complaints, concerns, dismissals, exception, agentRow, failedCalls, lastOk, client, proposals, lastPosition, stances, registry, complaintSeam] = await Promise.all([
    loadSnapshots([clientId]),
    prisma.activity.findFirst({ where: { clientId, type: { in: [...CONTACT_TYPES] }, createdAt: { lte: now } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.message.findFirst({ where: { clientId, direction: "OUTBOUND", createdAt: { lte: now } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.message.findFirst({ where: { clientId, direction: "INBOUND", channel: "whatsapp", createdAt: { lte: now } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.messageTemplate.findFirst({ where: { channel: "whatsapp", approved: true }, select: { id: true } }),
    prisma.conversationInsight.findMany({ where: { clientId, kind: "COMPLAINT", OR: [{ status: "OPEN" }, { occurredAt: { gte: complaintSince } }] }, orderBy: { occurredAt: "desc" }, take: 5, select: { status: true, occurredAt: true, text: true } }),
    prisma.conversationInsight.count({ where: { clientId, kind: "COMPLIANCE_CONCERN", status: "OPEN" } }),
    prisma.suggestionDismissal.findMany({ where: { clientId, snoozeUntil: { gt: now } }, select: { ruleKey: true, fingerprint: true, snoozeUntil: true, reason: true } }),
    prisma.exception.findFirst({ where: { clientId, status: "OPEN" }, orderBy: { createdAt: "desc" }, select: { reason: true } }),
    basePrisma.agentSetting.findUnique({ where: { agentKey: "wa_nudger" } }),
    prisma.deviceCall.count({ where: { clientId, direction: "OUTGOING", durationSeconds: 0, startedAt: { gte: unreachSince, lte: now } } }),
    prisma.deviceCall.findFirst({ where: { clientId, OR: [{ durationSeconds: { gt: 0 } }, { direction: "INCOMING" }], startedAt: { gte: unreachSince, lte: now } }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
    prisma.client.findUnique({ where: { id: clientId }, select: { nextActionTitle: true, nextActionDueAt: true, status: true, clientType: true, productInterest: true, existingBroker: true, tradingExperience: true, expectedInvestment: true, fundingRecord: { select: { status: true, amount: true } } } }),
    prisma.agentProposal.findMany({ where: { clientId, status: "DRAFT", expiresAt: { gt: now } }, select: { id: true, programme: true, channel: true, reason: true, createdAt: true }, take: 3 }),
    prisma.position.findFirst({ where: { tradingAccount: { clientId } }, orderBy: { asOfDate: "desc" }, select: { asOfDate: true } }),
    seams.memory.productStances(clientId),
    seams.registry.blocks(clientId),
    seams.complaints ? seams.complaints.complaint(clientId) : Promise.resolve(null),
  ]);

  // Contact since the last failed attempt resets the unreachable count.
  const unreachable = lastOk ? await prisma.deviceCall.count({ where: { clientId, direction: "OUTGOING", durationSeconds: 0, startedAt: { gt: lastOk.startedAt, lte: now } } }) : failedCalls;

  const blocked = blockedAssetClasses(facts, intel.acceptance);
  const manualLow = new Set(facts.manualAcceptance.filter((m) => m.level === "LOW").map((m) => m.assetClass));
  const declined: GateContext["declined"] = [];
  const rmLow: GateContext["rmLow"] = [];
  for (const [assetClass, because] of blocked) (manualLow.has(assetClass) ? rmLow : declined).push({ assetClass, because });

  const contactTimes = [lastContact?.createdAt, lastOutbound?.createdAt].filter((d): d is Date => !!d);
  const complaint = complaintSeam ?? {
    open: complaints.some((c) => c.status === "OPEN"),
    lastAt: complaints[0]?.occurredAt ?? null,
    because: complaints.length ? `${complaints[0].status === "OPEN" ? "Open complaint" : "Complaint"} on ${complaints[0].occurredAt.toISOString().slice(0, 10)}` : null,
  };

  // Interest and a decline on the same class, both unresolved, is a conflict the engine does not guess at.
  const evidenceConflicts: GateContext["evidenceConflicts"] = [];
  for (const interest of facts.insights.filter((i) => i.kind === "INTEREST" && i.status === "OPEN" && isAssetClass(i.assetClass))) {
    const decline = facts.insights.find((i) => i.kind === "DECLINED" && i.status === "OPEN" && i.assetClass === interest.assetClass);
    if (decline) evidenceConflicts.push({ assetClass: interest.assetClass as never, because: `Interest (${interest.occurredAt.toISOString().slice(0, 10)}) and a decline (${decline.occurredAt.toISOString().slice(0, 10)}) are both open for ${interest.assetClass}` });
  }

  const nudgerOn = process.env.AI_AGENTS_ENABLED === "1" && process.env.AGENT_NUDGER_ENABLED === "1" && agentRow?.enabled === true;

  const gate: GateContext = {
    now,
    clientId,
    consent: { rows: consentSnap.get(clientId)?.records ?? [], legacyMarketingConsentAt: consentSnap.get(clientId)?.legacyMarketingConsentAt ?? null, policy: resolvePolicy(process.env) },
    lastContactAt: contactTimes.length ? new Date(Math.max(...contactTimes.map((d) => d.getTime()))) : null,
    lastInboundWhatsAppAt: lastInbound?.createdAt ?? null,
    approvedTemplateExists: !!template,
    complaint,
    complianceConcernOpen: concerns > 0,
    declined,
    rmLow,
    dismissals: dismissals,
    unreachableAttempts: unreachable,
    kycException: { open: !!exception, label: exception ? `Open exception: ${exception.reason}`.slice(0, 160) : null },
    agentEnabled: nudgerOn,
    productStances: stances,
    registryBlocks: registry,
    evidenceConflicts,
  };

  let goalSuggestions: AdapterInput["goalSuggestions"] = [];
  try {
    const bundle = (await loadOutcomeBundles([clientId], now)).get(clientId);
    if (bundle) goalSuggestions = evaluateRules(bundle.subject, now);
  } catch (error) {
    console.error("Decision engine: outcome rules unavailable for", clientId, error instanceof Error ? error.message : error);
  }

  const adapter: AdapterInput = {
    now,
    facts,
    nba: intel.nba,
    stageGate: facts.onboarding,
    goalSuggestions,
    nextAction: client?.nextActionTitle ? { title: client.nextActionTitle, dueAt: client.nextActionDueAt } : null,
    proposals,
    crossSell: client ? getCrossSellFlags({ status: client.status, clientType: client.clientType, productInterest: client.productInterest, existingBroker: client.existingBroker, tradingExperience: client.tradingExperience, expectedInvestment: client.expectedInvestment, fundingRecord: client.fundingRecord }) : [],
    portfolioAsOf: lastPosition?.asOfDate ?? null,
  };

  return { gate, adapter, legacy: legacyOpinionOf(intel), factsMissing: false };
}
