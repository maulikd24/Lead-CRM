import type { DraftContext } from "@/lib/ai-execution/draft";
import type { HandoffTicketView } from "@/lib/integrations/freshdesk/ticket-view";
import type { CallInput, GatewayResult } from "@/lib/ai/gateway/types";

/** Shared test data for the co-pilot tests. Plain objects only: no database, no network. */

export const NOW = new Date("2026-10-14T06:00:00.000Z");

export function view(over: Partial<HandoffTicketView> = {}): HandoffTicketView {
  return {
    activityId: "act-1",
    ticketId: "4521",
    subject: "Statement request",
    status: "open",
    priority: "medium",
    intent: "Statement request",
    sentiment: "neutral",
    summary: "The customer asks for the latest account statement.",
    handoffAt: new Date("2026-10-14T04:00:00.000Z"),
    firstResponseDueAt: new Date("2026-10-14T10:00:00.000Z"),
    resolutionDueAt: new Date("2026-10-16T10:00:00.000Z"),
    resolvedAt: null,
    link: null,
    ...over,
  };
}

export function ctx(over: Partial<DraftContext> = {}): DraftContext {
  return {
    clientId: "client-1",
    firstName: "Asha",
    language: "English",
    kind: "service_response",
    acceptance: [],
    lastInteraction: null,
    pendingCommitments: 0,
    blockedAssetClasses: [],
    blockedTopics: [],
    openIssueKinds: [],
    ...over,
  };
}

/** A gateway result the way the gateway returns it, for the fake model. */
export function ok(text: string): GatewayResult {
  return { kind: "ok", text, runId: null, correlationId: "c", toolUses: [] } as unknown as GatewayResult;
}
export function failed(errorClass: string): GatewayResult {
  return { kind: "failed", errorClass, retryable: false, attempts: 0, correlationId: "c", runId: null } as unknown as GatewayResult;
}
export function blocked(reason: string): GatewayResult {
  return { kind: "blocked", reason, correlationId: "c", runId: null } as unknown as GatewayResult;
}

/** A fake gateway: the copilot purpose gets `reply`; the compliance judge gets `judge` (default SAFE). Every call is recorded. */
export function fakeModel(reply: GatewayResult, judge: GatewayResult = ok("SAFE")) {
  const calls: CallInput[] = [];
  const callModel = async (input: CallInput): Promise<GatewayResult> => {
    calls.push(input);
    return input.purpose === "compliance.judge" ? judge : reply;
  };
  return { callModel, calls };
}
