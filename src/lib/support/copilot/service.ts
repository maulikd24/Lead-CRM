import type { Role } from "@/generated/prisma/client";
import { canOpen360 } from "@/lib/clients/access";
import { getAdapter, isMockAdapter } from "@/lib/integrations/registry";
import { isOpenStatus, toTicketView, type HandoffTicketView } from "@/lib/integrations/freshdesk/ticket-view";
import { callModel } from "@/lib/ai/gateway";
import { draftContextFromBriefing, firstNameOf } from "@/lib/ai-execution/context";
import { sendEnabledFromEnv } from "@/lib/ai-execution/approval";
import { buildAgentBriefing } from "@/lib/intelligence/agent";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { prisma } from "@/lib/db/prisma";
import { requestApproval } from "@/lib/policy/approvals/service";
import "@/lib/policy/approvals/registry-init";
import type { Actor } from "@/lib/policy/types";
import { getCustomerTimeline } from "@/lib/timeline/reader";

import { generateCopilotDraft, checkReplyText, type CopilotDraftOutcome } from "./draft";
import { buildTicketFacts, summaryLines, type TicketFacts } from "./facts";
import { copilotEnabled } from "./flag";
import { dispatchApprovedReply, FRESHDESK_REPLY_DRAFT, requestReplyApproval, type ReplyApprovalRow, type ReplyPayload } from "./send";

/**
 * The co-pilot's database-backed wiring. The rules live in facts.ts, draft.ts and send.ts; this file only loads the ticket and the
 * customer, and runs them. Reads never write. The only write is the approval request (a draft for a person), and the send after approval.
 */

export type Viewer = { id: string; role: Role };

export type ApprovalSummary = { id: string; status: string; requestedById: string; decidedById: string | null; appliedAt: Date | null; expiresAt: Date | null };

export type CopilotState =
  | { status: "off" }
  | { status: "not_found" }
  | { status: "closed"; facts: TicketFacts; lines: string[]; ticketSummary: string; approval: ApprovalSummary | null }
  | {
      status: "ready";
      facts: TicketFacts;
      lines: string[];
      ticketSummary: string;
      /** Null when the caller asked for the facts only (no new model call). */
      draft: CopilotDraftOutcome | null;
      approval: ApprovalSummary | null;
      /** True when the viewer may send the approved reply (they are its approver). */
      canSend: boolean;
    };

type LoadedTicket = { activityId: string; clientId: string; clientName: string; view: HandoffTicketView; channel: string; excerpt: string; escalated: boolean };

/** The hand-off entry for one ticket, when the viewer may open that customer. Anything else is "not found", so no detail leaks. */
export async function loadTicketForViewer(viewer: Viewer, activityId: string): Promise<LoadedTicket | null> {
  const row = await prisma.activity.findUnique({
    where: { id: activityId },
    select: { id: true, clientId: true, type: true, payload: true, client: { select: { id: true, name: true, assignedToId: true, isDeleted: true, mergedIntoId: true } } },
  });
  if (!row || row.type !== "TICKET") return null;
  const view = toTicketView(row.payload, row.id, null);
  if (!view) return null;
  const visible = await getVisibleUserIds(viewer.id, viewer.role);
  if (!canOpen360(viewer.role, visible, row.client)) return null;
  const p = row.payload as Record<string, unknown>;
  return {
    activityId: row.id,
    clientId: row.clientId,
    clientName: row.client.name,
    view,
    channel: typeof p.channel === "string" ? p.channel : "Other",
    excerpt: typeof p.excerpt === "string" ? p.excerpt : "",
    escalated: p.escalated === true,
  };
}

async function latestApproval(clientId: string, ticketId: string): Promise<ApprovalSummary | null> {
  const row = await prisma.approvalRequest.findFirst({
    where: { actionType: FRESHDESK_REPLY_DRAFT, entity: "Client", entityId: clientId, payload: { path: ["ticketId"], equals: ticketId } },
    orderBy: { requestedAt: "desc" },
    select: { id: true, status: true, requestedById: true, decidedById: true, appliedAt: true, expiresAt: true },
  });
  return row;
}

async function respondedAt(clientId: string, ticketId: string): Promise<Date | null> {
  const task = await prisma.task.findFirst({ where: { clientId, source: `freshdesk-handoff:${ticketId}` }, select: { status: true, updatedAt: true } });
  return task?.status === "DONE" ? task.updatedAt : null;
}

/** Only the approver may send, and only an approved reply that has not gone yet. */
export function canSendFrom(approval: ApprovalSummary | null, viewerId: string): boolean {
  return approval !== null && approval.status === "APPROVED" && approval.appliedAt === null && approval.decidedById === viewerId;
}

/** The panel's state for one hand-off. Read only apart from the model call, which goes through the gateway and its consent check. */
export async function getCopilotState(viewer: Viewer, activityId: string, opts: { draft?: boolean; now?: Date } = {}): Promise<CopilotState> {
  const now = opts.now ?? new Date();
  if (!copilotEnabled()) return { status: "off" };
  const t = await loadTicketForViewer(viewer, activityId);
  if (!t) return { status: "not_found" };

  const timeline = await getCustomerTimeline(t.clientId, { viewer, limit: 100, includeEvents: false, now });
  if (!timeline.ok) return { status: "not_found" };
  const briefing = await buildAgentBriefing(t.clientId, { persist: false });
  if (!briefing) return { status: "not_found" };

  const facts = buildTicketFacts({
    view: t.view,
    now,
    respondedAt: await respondedAt(t.clientId, t.view.ticketId),
    history: timeline.items.map((i) => ({ kind: i.kind, at: new Date(i.at) })),
    openComplaints: briefing.openIssues.length,
    openCommitments: briefing.pendingCommitments.length,
    escalatedAtHandoff: t.escalated,
    channel: t.channel,
  });
  const approval = await latestApproval(t.clientId, t.view.ticketId);
  const lines = summaryLines(facts);

  if (!isOpenStatus(t.view.status)) return { status: "closed", facts, lines, ticketSummary: t.view.summary, approval };
  if (opts.draft === false) return { status: "ready", facts, lines, ticketSummary: t.view.summary, draft: null, approval, canSend: canSendFrom(approval, viewer.id) };

  const draft = await generateCopilotDraft(
    {
      ctx: draftContextFromBriefing(briefing, "service_response"),
      category: facts.category,
      firstName: firstNameOf(t.clientName),
      excerpt: t.excerpt,
      summary: t.view.summary,
      escalate: facts.escalate,
    },
    { callModel: (input) => callModel(input) },
  );
  return { status: "ready", facts, lines, ticketSummary: t.view.summary, draft, approval, canSend: canSendFrom(approval, viewer.id) };
}

/** Stores a reviewed reply for a Manager or Admin decision. Refused text stores nothing. Nothing is sent. */
export async function requestReplyForTicket(viewer: Viewer, activityId: string, body: string, source: "model" | "template", note: string | null): Promise<{ status: "requested"; approvalRequestId: string } | { status: "refused"; reason: string }> {
  if (!copilotEnabled()) return { status: "refused", reason: "The support co-pilot is off." };
  const t = await loadTicketForViewer(viewer, activityId);
  if (!t) return { status: "refused", reason: "Ticket not found." };
  if (!isOpenStatus(t.view.status)) return { status: "refused", reason: "This ticket is closed, so there is nothing to reply to." };
  const text = body.trim();
  const briefing = await buildAgentBriefing(t.clientId, { persist: false });
  if (!briefing) return { status: "refused", reason: "Customer not found." };
  const ctx = draftContextFromBriefing(briefing, "service_response");
  const check = checkReplyText(text, ctx);
  if (!check.ok) return { status: "refused", reason: check.reason };
  const actor: Actor = { id: viewer.id, role: viewer.role };
  const { approvalRequestId } = await requestReplyApproval(
    { clientId: t.clientId, ticketId: t.view.ticketId, body: text, source, note },
    actor,
    { requestApproval, now: () => new Date() },
  );
  return { status: "requested", approvalRequestId };
}

/** The approver sends the approved reply to Freshdesk. Every check runs again first; a mock or unconfigured Freshdesk sends nothing. */
export async function sendApprovedReply(viewer: Viewer, approvalRequestId: string): Promise<{ status: "sent"; replyId: string | null }> {
  if (!copilotEnabled()) throw new Error("The support co-pilot is off.");
  const actor: Actor = { id: viewer.id, role: viewer.role };
  // The approver must be able to open this customer today, like everyone else who sees it.
  const req = await prisma.approvalRequest.findUnique({ where: { id: approvalRequestId }, select: { entityId: true } });
  if (req) {
    const client = await prisma.client.findUnique({ where: { id: req.entityId }, select: { assignedToId: true, isDeleted: true, mergedIntoId: true } });
    const visible = await getVisibleUserIds(viewer.id, viewer.role);
    if (!client || !canOpen360(viewer.role, visible, client)) throw new Error("Not authorized to send this reply");
  }
  return dispatchApprovedReply(approvalRequestId, actor, {
    load: async (id) => {
      const row = await prisma.approvalRequest.findUnique({
        where: { id },
        select: { id: true, actionType: true, entity: true, entityId: true, status: true, payload: true, requestedById: true, decidedById: true, expiresAt: true, appliedAt: true },
      });
      return row as ReplyApprovalRow | null;
    },
    now: () => new Date(),
    isSendEnabled: () => sendEnabledFromEnv(process.env),
    recheck: async (payload: ReplyPayload) => {
      const ticket = await prisma.activity.findFirst({
        where: { clientId: payload.clientId, type: "TICKET", AND: [{ payload: { path: ["handoff"], equals: true } }, { payload: { path: ["ticketId"], equals: payload.ticketId } }] },
        select: { id: true, payload: true },
      });
      const view = ticket ? toTicketView(ticket.payload, ticket.id, null) : null;
      if (!view) return { ok: false, reason: "the ticket is no longer on record" };
      if (!isOpenStatus(view.status)) return { ok: false, reason: "the ticket is closed" };
      const briefing = await buildAgentBriefing(payload.clientId, { persist: false });
      if (!briefing) return { ok: false, reason: "the customer's context is no longer available" };
      const check = checkReplyText(payload.body, draftContextFromBriefing(briefing, "service_response"));
      return check.ok ? { ok: true } : { ok: false, reason: check.reason };
    },
    claimSend: async (id) => {
      const r = await prisma.approvalRequest.updateMany({ where: { id, status: "APPROVED", appliedAt: null }, data: { appliedAt: new Date() } });
      return r.count === 1;
    },
    releaseClaim: async (id) => {
      await prisma.approvalRequest.updateMany({ where: { id }, data: { appliedAt: null } });
    },
    send: async (payload) => {
      const adapter = await getAdapter("freshdesk");
      if (isMockAdapter(adapter) || !adapter.replyToTicket) return { ok: false, error: "Freshdesk is not connected live, so nothing was sent" };
      return adapter.replyToTicket(payload.ticketId, payload.body);
    },
  });
}

