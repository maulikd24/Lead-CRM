import { prisma } from "@/lib/db/prisma";
import { getProvider, type LlmProvider } from "@/lib/ai/provider";
import { canReplyTo, type InboxUser } from "@/lib/whatsapp/inbox-scope";
import { REPLY_KEY, suggestReply, unansweredInbound } from "./reply-assist";
import { deriveAssistView, recordSuggestionSent, type AssistView } from "./reply-assist-lifecycle";
import { decideDeps, isAgentEnabled, loadConversationMessages, replyAssistDeps, transitionProposal } from "./wiring";

/** What the inbox panel renders. `enabled: false` hides the whole panel (flag off, no permission, or manager view-only). */
export type AssistState = { enabled: boolean; auto: boolean; view: AssistView; message?: string };
const OFF: AssistState = { enabled: false, auto: false, view: { kind: "none" } };

export const assistFlagOn = (): Promise<boolean> => isAgentEnabled(REPLY_KEY);
const autoOn = () => process.env.WA_ASSIST_AUTO === "1";

async function mayAssist(user: InboxUser, clientId: string): Promise<boolean> {
  const client = await prisma.client.findFirst({ where: { id: clientId, isDeleted: false, mergedIntoId: null }, select: { assignedToId: true } });
  return !!client && canReplyTo(user, client);
}

/** Current panel state. Also retires any open suggestion that a newer customer message has made stale (compare-and-set DRAFT -> EXPIRED). */
export async function getAssistState(user: InboxUser, clientId: string): Promise<AssistState> {
  if (!(await assistFlagOn()) || !(await mayAssist(user, clientId))) return OFF;
  const now = new Date();
  const messages = await loadConversationMessages(clientId);
  const waiting = unansweredInbound(messages);
  const lastInboundAt = waiting.length ? waiting[waiting.length - 1].at : null;
  const lastOutbound = [...messages].reverse().find((m) => m.direction === "OUTBOUND");
  const rows = await prisma.agentProposal.findMany({
    where: { clientId, agentKey: REPLY_KEY }, orderBy: { createdAt: "desc" }, take: 10,
    select: { id: true, status: true, body: true, originalBody: true, reason: true, blockedReason: true, createdAt: true, expiresAt: true, inputTokens: true, outputTokens: true },
  });
  if (lastInboundAt) {
    const stale = rows.filter((r) => r.status === "DRAFT" && r.createdAt.getTime() < lastInboundAt.getTime());
    for (const r of stale) await transitionProposal(r.id, "DRAFT", "EXPIRED");
  }
  const live = rows.filter((r) => !(r.status === "DRAFT" && lastInboundAt && r.createdAt.getTime() < lastInboundAt.getTime()));
  return { enabled: true, auto: autoOn(), view: deriveAssistView({ rows: live, lastInboundAt, lastOutboundAt: lastOutbound?.at ?? null, unanswered: waiting.length > 0, now }) };
}

const MESSAGES: Record<string, string> = {
  "provider error; no draft created": "Could not draft a reply right now. Try again.",
  "no unanswered customer message": "Nothing to answer: you replied last.",
  cooldown: "A suggestion was just made. Give it a few seconds, then try again.",
};

export async function runSuggestion(user: InboxUser, clientId: string, opts: { regenerate?: boolean; auto?: boolean }, provider?: LlmProvider): Promise<AssistState> {
  if (!(await assistFlagOn())) return OFF;
  if (!(await mayAssist(user, clientId))) return OFF;
  if (opts.auto && !autoOn()) return getAssistState(user, clientId);
  let message: string | undefined;
  try {
    const res = await suggestReply(clientId, replyAssistDeps(provider ?? getProvider()), { regenerate: opts.regenerate });
    if (res.status === "skipped" && MESSAGES[res.reason]) message = MESSAGES[res.reason];
  } catch (error) {
    // Never log the error object (a vendor error can echo the request); log only that it failed.
    console.error("wa_reply: suggestion failed", error instanceof Error ? error.name : "error");
    message = "Could not draft a reply right now. Try again.";
  }
  return { ...(await getAssistState(user, clientId)), message };
}

export async function dismissSuggestion(user: InboxUser, clientId: string, proposalId: string): Promise<AssistState> {
  if (await mayAssist(user, clientId)) {
    const p = await prisma.agentProposal.findFirst({ where: { id: proposalId, clientId, agentKey: REPLY_KEY }, select: { id: true } });
    // The inbox owns wa_reply drafts: its own compare-and-set, scoped to this client and agent (the Agent drafts page never touches them).
    if (p) await transitionProposal(p.id, "DRAFT", "REJECTED", { decidedById: user.id, decidedAt: new Date() });
  }
  return getAssistState(user, clientId);
}

/** Non-fatal: the message is already queued when this runs. */
export async function recordSuggestionUsed(user: InboxUser, clientId: string, proposalId: string, finalBody: string, messageId: string): Promise<void> {
  try {
    const deps = decideDeps();
    await recordSuggestionSent(
      {
        load: async (id) => prisma.agentProposal.findUnique({ where: { id }, select: { id: true, agentKey: true, clientId: true, status: true } }),
        transition: deps.transition,
        now: () => new Date(),
      },
      { proposalId, clientId, userId: user.id, finalBody, messageId },
    );
  } catch (error) {
    console.error("wa_reply: could not record suggestion outcome", error instanceof Error ? error.name : "error");
  }
}
