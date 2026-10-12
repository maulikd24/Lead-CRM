import { beforeEach, describe, expect, it, vi } from "vitest";

import { exotelAdapter } from "@/lib/integrations/adapters/exotel";

const SECRET = "exotel-secret";

const db = vi.hoisted(() => ({
  client: { findFirst: vi.fn(), findUnique: vi.fn() },
  conversationReview: { create: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
const rate = vi.hoisted(() => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/security/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/security/rate-limit")>()), rateLimit: rate.rateLimit }));
const dedupe = vi.hoisted(() => ({ claimWebhookDelivery: vi.fn(), releaseWebhookDelivery: vi.fn() }));
vi.mock("@/lib/security/webhook-dedupe", async (orig) => ({ ...(await orig<typeof import("@/lib/security/webhook-dedupe")>()), ...dedupe }));
vi.mock("@/lib/integrations/registry", () => ({ getAdapter: vi.fn(async () => exotelAdapter), isMockAdapter: () => false }));
vi.mock("@/lib/integrations/freshdesk/deps", () => ({ maybeHandleHandoff: vi.fn(async () => null) }));
const side = vi.hoisted(() => ({ logActivity: vi.fn(), onEvent: vi.fn(), resolveInboundClient: vi.fn() }));
vi.mock("@/lib/activities/log-activity", () => ({ logActivity: side.logActivity }));
vi.mock("@/lib/journeys/dispatch", () => ({ onEvent: side.onEvent }));
vi.mock("@/lib/integrations/task-sync", () => ({ handleExternalTaskEvent: vi.fn() }));
vi.mock("@/lib/clients/inbound-contact", () => ({ resolveInboundClient: side.resolveInboundClient }));
const calls = vi.hoisted(() => ({ findCallSessionByCallId: vi.fn(), markCallAnswered: vi.fn(), completeCallSession: vi.fn() }));
vi.mock("@/lib/click-to-call/sessions", () => calls);

import { POST } from "./route";

const post = (fields: Record<string, string>) =>
  POST(
    new Request(`http://localhost/api/webhooks/exotel?secret=${SECRET}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    }),
    { params: Promise.resolve({ provider: "exotel" }) },
  );

const client = { id: "c1", assignedToId: "rm1" };
const session = { id: "s1", clientId: "c1", userId: "rm1", provider: "exotel", providerCallId: "CA1", answeredAt: null, client };

beforeEach(async () => {
  vi.clearAllMocks();
  rate.rateLimit.mockResolvedValue({ allowed: true, remaining: 100, retryAfterSeconds: 0 });
  dedupe.claimWebhookDelivery.mockResolvedValue(true);
  await exotelAdapter.configure({ sid: "s", apiKey: "k", apiToken: "t", callerId: "0800", webhookSecret: SECRET }, {});
  exotelAdapter.actions.triggerVoiceAnalysis = vi.fn(async () => ({ success: true }));
});

describe("Exotel callbacks for calls placed from Supportify", () => {
  it("marks the call answered and logs nothing yet", async () => {
    calls.findCallSessionByCallId.mockResolvedValue(session);
    const res = await post({ CallSid: "CA1", EventType: "answered", Direction: "outbound-api", From: "09123456780", To: "09876543210" });
    expect(res.status).toBe(200);
    expect(calls.markCallAnswered).toHaveBeenCalledWith("s1");
    expect(side.logActivity).not.toHaveBeenCalled();
    expect(side.resolveInboundClient).not.toHaveBeenCalled();
  });

  it("finishes the session on its own client — never matched (or created) from the RM's phone — and queues the review", async () => {
    calls.findCallSessionByCallId.mockResolvedValue(session);
    calls.completeCallSession.mockResolvedValue({ created: true, activity: { id: "a1" }, status: "COMPLETED" });
    await post({ CallSid: "CA1", EventType: "terminal", Status: "completed", Direction: "outbound-api", From: "09123456780", To: "09876543210", ConversationDuration: "95" });
    expect(calls.completeCallSession).toHaveBeenCalledWith(session, { status: "completed", durationSeconds: 95, recordingUrl: undefined });
    expect(side.resolveInboundClient).not.toHaveBeenCalled();
    expect(db.conversationReview.create).toHaveBeenCalledWith({ data: expect.objectContaining({ clientId: "c1", sourceActivityId: "a1", exotelCallSid: "CA1" }) });
    expect(side.onEvent).toHaveBeenCalledWith("webhook_received", "c1");
  });

  it("does nothing more for a repeated final callback", async () => {
    calls.findCallSessionByCallId.mockResolvedValue(session);
    calls.completeCallSession.mockResolvedValue({ created: false });
    await post({ CallSid: "CA1", Status: "completed", Direction: "outbound-api", From: "09123456780", To: "09876543210" });
    expect(db.conversationReview.create).not.toHaveBeenCalled();
    expect(side.onEvent).not.toHaveBeenCalled();
  });

  it("doesn't send an unanswered call for review", async () => {
    calls.findCallSessionByCallId.mockResolvedValue(session);
    calls.completeCallSession.mockResolvedValue({ created: true, activity: { id: "a1" }, status: "NO_ANSWER" });
    await post({ CallSid: "CA1", Status: "no-answer", Direction: "outbound-api", From: "09123456780", To: "09876543210" });
    expect(db.conversationReview.create).not.toHaveBeenCalled();
  });

  it("leaves other calls on the existing path (matched by the caller's number)", async () => {
    calls.findCallSessionByCallId.mockResolvedValue(null);
    side.resolveInboundClient.mockResolvedValue({ client });
    side.logActivity.mockResolvedValue({ id: "a2" });
    await post({ CallSid: "CA9", Status: "completed", Direction: "inbound", From: "09876543210" });
    expect(side.resolveInboundClient).toHaveBeenCalledWith(expect.objectContaining({ phone: "09876543210" }));
    expect(calls.completeCallSession).not.toHaveBeenCalled();
  });
});
