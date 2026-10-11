// THE contract: getRecommendations(clientId, viewer). Every screen that shows "what should happen next for this customer" is meant to go
// through here. In SHADOW mode (today) the answer for an ordinary screen is still the legacy opinions (so nothing changes for anyone), and
// the v2 decision is attached only for the people allowed to review it (see access.ts). The existing implementations are NOT deleted:
// they are the candidate generators behind candidates/adapters.ts.
import { basePrisma, prisma } from "@/lib/db/prisma";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { canViewClient } from "@/lib/clients/access";
import { canSeeDecision, drawerOffered, type Viewer } from "./access";
import { generateCandidates } from "./candidates/adapters";
import { loadDecisionInput } from "./loader";
import type { DecisionSeams } from "./seams";
import { toDecisionView, type DecisionView } from "./view";
import type { Candidate } from "./types";

export type Recommendation = {
  id: string;
  source: Candidate["source"] | "decision_v2";
  programme: string;
  action: string;
  topic: string | null;
  reason: string;
  priority: string;
  owner: string;
  channel: string;
  timing: string;
};

export type RecommendationSet = {
  clientId: string;
  /** "legacy": the existing implementations' opinions, as screens show them today. "decision_v2": the stored v2 decision (reviewers only, shadow). */
  mode: "legacy" | "decision_v2";
  items: Recommendation[];
  /** Present only when this viewer may review v2 decisions. */
  decision: DecisionView | null;
};

const asRec = (c: Candidate): Recommendation => ({ id: c.id, source: c.source, programme: c.programme, action: c.action, topic: c.topic, reason: c.reason, priority: c.priority, owner: c.owner, channel: c.channel, timing: c.timing });

export async function latestDecisionView(clientId: string): Promise<DecisionView | null> {
  const row = await basePrisma.decisionRecord.findFirst({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    include: { feedback: { orderBy: { createdAt: "asc" }, select: { kind: true, reason: true, createdAt: true, userId: true } }, outcomes: { orderBy: { occurredAt: "asc" }, select: { kind: true, daysAfter: true, detail: true } }, disagreement: { select: { kind: true, severity: true, summary: true } } },
  });
  return row ? toDecisionView(row) : null;
}

export async function getRecommendations(clientId: string, viewer: Viewer, opts: { env?: Record<string, string | undefined>; now?: Date; visibleUserIds?: string[] | null; seams?: Partial<DecisionSeams> } = {}): Promise<RecommendationSet | null> {
  const env = opts.env ?? process.env;
  // Default deny: only the three desk roles ever see recommendations; Marketing and the rest get nothing.
  if (!["ADMIN", "MANAGER", "RM"].includes(viewer.role)) return null;
  const client = await prisma.client.findFirst({ where: { id: clientId, isDeleted: false, mergedIntoId: null }, select: { assignedToId: true } });
  if (!client) return null;
  const visible = opts.visibleUserIds !== undefined ? opts.visibleUserIds : await getVisibleUserIds(viewer.id, viewer.role as never);
  // Same visibility the client page enforces, for both modes.
  if (!canViewClient(viewer.role, visible, client)) return null;
  const mayReview = canSeeDecision(viewer, visible, client, env) && drawerOffered(viewer.role, env);
  if (mayReview) {
    const decision = await latestDecisionView(clientId);
    if (decision) {
      return { clientId, mode: "decision_v2", decision, items: [{ id: decision.id, source: "decision_v2", programme: decision.programme, action: decision.action, topic: decision.topic, reason: decision.reason, priority: decision.priority, owner: decision.owner, channel: decision.channel, timing: decision.timing }] };
    }
  }
  const input = await loadDecisionInput(clientId, { now: opts.now, seams: opts.seams });
  if (!input) return null;
  return { clientId, mode: "legacy", decision: null, items: generateCandidates(input.adapter).map(asRec) };
}
