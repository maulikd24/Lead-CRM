import { basePrisma, prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { buildAgentBriefing } from "@/lib/intelligence/agent";
import { queueWhatsAppReply } from "@/lib/whatsapp/send";
import { getProvider, type LlmProvider } from "@/lib/ai/provider";
import { agentEnabled } from "./enabled";
import { NUDGER_KEY, NUDGER_PROGRAMMES, draftNudge, type NudgerDeps } from "./nudger";
import { blockingProposalWhere } from "./cooldown";
import type { SweepDeps } from "./sweeper";
import { sweepStuckApprovals } from "./sweeper";
import type { BatchDeps } from "./nudger-batch";
import { assertTransition } from "./proposal-state";
import type { DecideDeps } from "./decide";
import { consentGate, consentEnforced, filterConsented } from "@/lib/consent/enforce";
import { coarseMarketingWhere } from "@/lib/consent/coarse";

export function isAgentEnabled(agentKey: string): Promise<boolean> {
  return agentEnabled(agentKey, process.env, (key) => prisma.agentSetting.findUnique({ where: { agentKey: key }, select: { enabled: true } }));
}

/** Pass a provider to override (tests, local runs with FakeProvider); default is the configured real one. */
export function nudgerDeps(provider: LlmProvider = getProvider()): NudgerDeps {
  return {
    // persist:false: a cron-driven draft-only agent must not write intelligence or fire journey triggers (which can send without approval).
    briefing: (clientId) => buildAgentBriefing(clientId, { persist: false }),
    provider,
    isEnabled: () => isAgentEnabled(NUDGER_KEY),
    // createdAt OR decidedAt: a draft created 15 days ago and rejected yesterday must still cool the customer down; APPROVED blocks at any age.
    recentProposals: (clientId, since) =>
      prisma.agentProposal.findMany({ where: { clientId, agentKey: NUDGER_KEY, OR: [{ createdAt: { gte: since } }, { decidedAt: { gte: since } }, { status: "APPROVED" }] }, select: { status: true, createdAt: true, decidedAt: true, expiresAt: true } }),
    save: async (p) => {
      // Re-check right before the insert. This narrows the read-then-insert race between overlapping batches but cannot close it:
      // without a unique constraint (no migration for that) two concurrent callers can both pass the check.
      const open = await prisma.agentProposal.count({ where: { clientId: p.clientId, agentKey: p.agentKey, OR: [{ status: "DRAFT", expiresAt: { gt: new Date() } }, { status: "APPROVED" }] } });
      if (open > 0) return { duplicate: true as const };
      return { id: (await prisma.agentProposal.create({ data: p, select: { id: true } })).id };
    },
    now: () => new Date(),
    ...consentSpread(),
  };
}

/** Empty unless CONSENT_ENFORCEMENT=1, so the deps object is unchanged while the flag is off. */
function consentSpread(): Pick<NudgerDeps, "consent"> {
  const consent = consentGate("MARKETING_COMMS", "whatsapp");
  return consent ? { consent } : {};
}

/** The one compare-and-set write: moves a row from `from` to `to` only if it is still in `from` (and, with notExpiredAt, unexpired). */
const transitionProposal: DecideDeps["transition"] = async (id, from, to, patch, opts) => {
  assertTransition(from, to);
  const { count } = await prisma.agentProposal.updateMany({
    where: { id, status: from, ...(opts?.notExpiredAt ? { expiresAt: { gt: opts.notExpiredAt } } : {}) },
    data: { status: to, ...patch },
  });
  return count === 1;
};

export function decideDeps(): DecideDeps {
  return {
    load: async (id) => {
      const p = await prisma.agentProposal.findUnique({ where: { id }, include: { client: { select: { assignedToId: true } } } });
      return p && { id: p.id, clientId: p.clientId, assignedToId: p.client.assignedToId, status: p.status, body: p.body, expiresAt: p.expiresAt };
    },
    transition: transitionProposal,
    send: async ({ user, clientId, body }) => ({ messageId: (await queueWhatsAppReply({ user, clientId, body })).id }),
    now: () => new Date(),
  };
}

/**
 * Cheap pre-filter for the batch; draftNudge stays the final judge (it recomputes the briefing and enforces every rule).
 * Uses the persisted next-best-action programme (CustomerIntelligence.nbaProgramme), so no recompute and no writes here.
 * Customers in cooldown, and customers with an open complaint-type insight, are excluded. Order: never considered first,
 * then least recently considered (CustomerIntelligence.nudgerConsideredAt, written by markConsidered before every attempt),
 * so a customer that is always skipped moves to the back instead of starving the rest.
 */
export async function loadNudgerCandidates(limit: number, now: Date = new Date(), extraWhere?: Prisma.ClientWhereInput): Promise<string[]> {
  const rows = await prisma.client.findMany({
    where: {
      ...(extraWhere ? { AND: [extraWhere] } : {}),
      status: "ACTIVE",
      isDeleted: false,
      mergedIntoId: null,
      assignedToId: { not: null },
      intelligence: { is: { nbaProgramme: { in: [...NUDGER_PROGRAMMES] }, doNotDiscuss: { equals: [] } } },
      agentProposals: { none: blockingProposalWhere(now) },
      insights: { none: { status: "OPEN", kind: { in: ["COMPLAINT", "INCORRECT_INFO", "COMPLIANCE_CONCERN"] } } },
    },
    orderBy: [{ intelligence: { nudgerConsideredAt: { sort: "asc", nulls: "first" } } }, { createdAt: "asc" }],
    select: { id: true },
    take: limit,
  });
  return rows.map((r) => r.id);
}

/** With enforcement on: skip customers with no consent evidence in the query, then confirm each with the full decision (DND, withdrawals, expiry). */
const CONSENT_OVERFETCH = 4;
export async function loadConsentedNudgerCandidates(limit: number, now: Date = new Date()): Promise<string[]> {
  const ids = await loadNudgerCandidates(limit * CONSENT_OVERFETCH, now, coarseMarketingWhere());
  return (await filterConsented(ids, "MARKETING_COMMS", "whatsapp")).slice(0, limit);
}

export function batchDeps(provider?: LlmProvider): BatchDeps {
  // The provider is built lazily, after isEnabled passes: an unknown AI_PROVIDER must not make the cron job throw while the agent is off.
  let deps: NudgerDeps | undefined;
  const lazy = () => (deps ??= nudgerDeps(provider));
  return {
    isEnabled: () => isAgentEnabled(NUDGER_KEY),
    loadCandidates: (limit) => (consentEnforced() ? loadConsentedNudgerCandidates(limit) : loadNudgerCandidates(limit)),
    // updateMany: a customer with no intelligence row yet is simply not marked (the pre-filter requires the row anyway).
    markConsidered: async (clientId, now) => { await basePrisma.customerIntelligence.updateMany({ where: { clientId }, data: { nudgerConsideredAt: now } }); },
    draft: (id) => draftNudge(id, lazy()),
    now: () => new Date(),
  };
}

export function sweepDeps(): SweepDeps {
  return {
    loadStuck: (cutoff) => prisma.agentProposal.findMany({ where: { agentKey: NUDGER_KEY, status: "APPROVED", decidedAt: { lte: cutoff } }, select: { id: true, clientId: true, decidedById: true, decidedAt: true, expiresAt: true }, take: 200 }),
    loadMessages: async (rows) => {
      const since = new Date(Math.min(...rows.map((r) => r.decidedAt?.getTime() ?? Date.now())));
      return prisma.message.findMany({
        where: { direction: "OUTBOUND", createdAt: { gte: since }, clientId: { in: rows.map((r) => r.clientId) }, senderUserId: { in: rows.flatMap((r) => (r.decidedById ? [r.decidedById] : [])) } },
        select: { id: true, clientId: true, senderUserId: true, createdAt: true },
      });
    },
    transition: transitionProposal,
    now: () => new Date(),
  };
}

/** Cron entry: same kill switch as the nudger. Switching the agent off must not strand a claim, but it also stops all agent work. */
export async function runAgentSweeper() {
  if (!(await isAgentEnabled(NUDGER_KEY))) return { sent: 0, released: 0, expired: 0, lostRace: 0 };
  return sweepStuckApprovals(sweepDeps());
}
