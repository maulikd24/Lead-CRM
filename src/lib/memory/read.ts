import { can } from "@/lib/access/policy";
import { prisma } from "@/lib/db/prisma";

import { authoriseMemory, type Viewer } from "./access";
import { consentDecision, type ConsentRow } from "@/lib/consent/decision";
import { resolvePolicy } from "@/lib/consent/policy";
import { buildDecisionMemory, buildMemoryView, excludeWithdrawn, type CustomerMemoryView, type DecisionMemory, type MemoryRow } from "./view";

const LIMIT = 300;
/** Expired items stay visible for 90 days past expiry so a person can reconfirm them; after that they drop out of the panel. */
const EXPIRED_VISIBLE_DAYS = 90;

const select = {
  id: true, class: true, key: true, value: true, sourceType: true, sourceRef: true, evidence: true, confidence: true, observedAt: true, freshUntil: true,
  lastReconfirmedAt: true, confirmation: true, confirmedAt: true, disputedReason: true, conflictsWithId: true, dataClass: true, consentBasis: true, createdAt: true,
} as const;

/** The purposes (of the two memory can derive under) the customer has withdrawn or let lapse right now. */
async function deniedPurposes(clientId: string, now: Date): Promise<Set<string>> {
  const rows = (await prisma.consentRecord.findMany({ where: { clientId, purpose: { in: ["AI_PROCESSING_OF_CHATS", "CALL_RECORDING"] } }, select: { id: true, purpose: true, channel: true, status: true, capturedAt: true, expiresAt: true, source: true, noticeVersion: true }, take: 100 })) as ConsentRow[];
  const policy = resolvePolicy();
  const denied = new Set<string>();
  for (const purpose of ["AI_PROCESSING_OF_CHATS", "CALL_RECORDING"] as const) if (!consentDecision(rows, purpose, null, now, { policy }).allowed) denied.add(purpose);
  return denied;
}

/**
 * The Customer 360 memory panel. Authorised here (registry area + the customer's record scope), so no caller can forget it:
 * returns null when the viewer may not see this customer, and the page answers "not found". Read-only: viewing never writes.
 */
export async function getCustomerMemory(viewer: Viewer, clientId: string, now: Date = new Date()): Promise<CustomerMemoryView | null> {
  const auth = await authoriseMemory(viewer, clientId);
  if (!auth.ok) return null;
  const since = new Date(now.getTime() - EXPIRED_VISIBLE_DAYS * 86_400_000);
  const raw: MemoryRow[] = await prisma.customerMemoryItem.findMany({
    where: { clientId, confirmation: { notIn: ["REJECTED", "SUPERSEDED"] }, OR: [{ freshUntil: null }, { freshUntil: { gt: since } }] },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
    select,
  });
  const rows = excludeWithdrawn(raw, await deniedPurposes(clientId, now));
  return buildMemoryView(rows, { canManage: auth.canManage, canSeeCalls: can(viewer.role, "calls", "view") }, now);
}

/**
 * The read API for other modules: what the decision engine, agents and the attention engine may rely on for one customer.
 * authoritative items can block or drive an action; advisory ones may only downrank, hint or prompt a question; contested
 * ones mean "evidence conflicts: abstain or ask". The caller is a server module that has ALREADY authorised the customer
 * (same contract as the Customer 360 loaders); it returns no evidence text and never reads for a marketing caller.
 */
export async function getMemoryForDecisions(clientId: string, now: Date = new Date()): Promise<DecisionMemory> {
  const raw = await prisma.customerMemoryItem.findMany({ where: { clientId, confirmation: { in: ["UNCONFIRMED", "CONFIRMED", "DISPUTED"] } }, take: LIMIT, select });
  return buildDecisionMemory(excludeWithdrawn(raw, await deniedPurposes(clientId, now)), now);
}
