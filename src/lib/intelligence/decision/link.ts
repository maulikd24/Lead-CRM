// Links an agent draft to the decision it acts on (AgentProposal.nbaDecisionId, SET NULL on delete). Off with the engine: with NBA_ENGINE_V2 unset nothing is read or written.
// A draft is linked to the customer's newest recommendation that is still open (or accepted) and no older than a week; anything else leaves the link empty.
import { basePrisma } from "@/lib/db/prisma";
import { DAY_MS } from "./constants";
import { ENGINE_FLAG } from "./enabled";

export async function nbaDecisionIdFor(clientId: string, now: Date = new Date()): Promise<string | null> {
  if (process.env[ENGINE_FLAG] !== "1") return null;
  try {
    const row = await basePrisma.decisionRecord.findFirst({ where: { clientId, result: "RECOMMEND", status: { in: ["OPEN", "ACCEPTED"] }, createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS), lte: now } }, orderBy: { createdAt: "desc" }, select: { id: true } });
    return row?.id ?? null;
  } catch {
    return null; // the link is informational: a failed lookup never stops a draft
  }
}

export async function withDecisionLink<T extends { clientId: string }>(proposal: T, now: Date = new Date()): Promise<T & { nbaDecisionId?: string }> {
  const nbaDecisionId = await nbaDecisionIdFor(proposal.clientId, now);
  return nbaDecisionId ? { ...proposal, nbaDecisionId } : proposal;
}
