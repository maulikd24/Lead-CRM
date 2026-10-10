import { beforeEach, describe, expect, it, vi } from "vitest";

import { freshdeskAdapter } from "@/lib/integrations/adapters/freshdesk";

const SECRET = "test-shared-secret";

const db = vi.hoisted(() => ({
  client: { findFirst: vi.fn(), findUnique: vi.fn() },
  integrationConfig: { findUnique: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
const rate = vi.hoisted(() => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/security/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/security/rate-limit")>()), rateLimit: rate.rateLimit }));
const dedupe = vi.hoisted(() => ({ claimWebhookDelivery: vi.fn(), releaseWebhookDelivery: vi.fn() }));
vi.mock("@/lib/security/webhook-dedupe", async (orig) => ({ ...(await orig<typeof import("@/lib/security/webhook-dedupe")>()), ...dedupe }));
vi.mock("@/lib/integrations/registry", () => ({ getAdapter: vi.fn(async () => freshdeskAdapter), isMockAdapter: () => false }));
const handoff = vi.hoisted(() => ({ maybeHandleHandoff: vi.fn() }));
vi.mock("@/lib/integrations/freshdesk/deps", () => handoff);
const side = vi.hoisted(() => ({ logActivity: vi.fn(), onEvent: vi.fn(), handleExternalTaskEvent: vi.fn(), resolveInboundClient: vi.fn() }));
vi.mock("@/lib/activities/log-activity", () => ({ logActivity: side.logActivity }));
vi.mock("@/lib/journeys/dispatch", () => ({ onEvent: side.onEvent }));
vi.mock("@/lib/integrations/task-sync", () => ({ handleExternalTaskEvent: side.handleExternalTaskEvent }));
vi.mock("@/lib/clients/inbound-contact", () => ({ resolveInboundClient: side.resolveInboundClient }));
vi.mock("@/lib/whatsapp/phone", () => ({ findClientByPhoneKey: vi.fn() }));

import { POST } from "./route";

const call = (body: string, headers: Record<string, string> = {}) =>
  POST(new Request("http://localhost/api/webhooks/freshdesk", { method: "POST", headers: { "content-type": "application/json", ...headers }, body }), { params: Promise.resolve({ provider: "freshdesk" }) });
const goodBody = JSON.stringify({ ticket_id: 7, status: "Open", channel: "Email", requester_email: "a@example.test" });

/** Nothing past the authentication step may have run. */
function expectNothingBeyondAuth() {
  expect(dedupe.claimWebhookDelivery).not.toHaveBeenCalled();
  expect(handoff.maybeHandleHandoff).not.toHaveBeenCalled();
  expect(side.logActivity).not.toHaveBeenCalled();
  expect(side.resolveInboundClient).not.toHaveBeenCalled();
  expect(side.onEvent).not.toHaveBeenCalled();
  expect(db.client.findFirst).not.toHaveBeenCalled();
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("FRESHDESK_HANDOFF_ENABLED", "1");
  rate.rateLimit.mockResolvedValue({ allowed: true, remaining: 100, retryAfterSeconds: 0 });
  dedupe.claimWebhookDelivery.mockResolvedValue(true);
  handoff.maybeHandleHandoff.mockResolvedValue(null);
  db.client.findFirst.mockResolvedValue(null);
  await freshdeskAdapter.configure({ domain: "acme", apiKey: "k", webhookSecret: SECRET });
});

describe("Freshdesk ingest: the signature is checked before anything else", () => {
  it("rejects a missing secret header with 401 and runs nothing", async () => {
    expect((await call(goodBody)).status).toBe(401);
    expectNothingBeyondAuth();
  });
  it("rejects a wrong secret with 401 and runs nothing", async () => {
    expect((await call(goodBody, { "x-webhook-secret": "nope" })).status).toBe(401);
    expectNothingBeyondAuth();
  });
  it("answers 401, not 400, for an unsigned malformed body (nothing is parsed before authentication)", async () => {
    expect((await call("{not json", {})).status).toBe(401);
    expectNothingBeyondAuth();
  });
  it("does not claim a delivery slot for unauthenticated junk, so junk cannot fill the dedupe table", async () => {
    await call(goodBody, { "x-webhook-secret": "x" });
    expect(dedupe.claimWebhookDelivery).not.toHaveBeenCalled();
  });
  it("fails closed when no webhook secret is configured at all, even if the caller sends an empty one", async () => {
    await freshdeskAdapter.configure({ domain: "acme", apiKey: "k" });
    expect((await call(goodBody, { "x-webhook-secret": "" })).status).toBe(401);
    expect((await call(goodBody)).status).toBe(401);
    expectNothingBeyondAuth();
  });
  it("is 429 for a flood, before the body is even read", async () => {
    rate.rateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 10 });
    expect((await call(goodBody, { "x-webhook-secret": SECRET })).status).toBe(429);
    expectNothingBeyondAuth();
  });
});

describe("Freshdesk ingest: once authenticated", () => {
  const signed = { "x-webhook-secret": SECRET };

  it("rejects a malformed body with 400 only after the signature passed", async () => {
    expect((await call("{not json", signed)).status).toBe(400);
    expect(dedupe.claimWebhookDelivery).not.toHaveBeenCalled();
  });
  it("acknowledges a retry of an already processed delivery without processing it again", async () => {
    dedupe.claimWebhookDelivery.mockResolvedValue(false);
    const res = await call(goodBody, signed);
    expect(await res.json()).toEqual({ ok: true, duplicate: true });
    expect(handoff.maybeHandleHandoff).not.toHaveBeenCalled();
  });
  it("hands a hand-off ticket to the hand-off processor and stops there", async () => {
    handoff.maybeHandleHandoff.mockResolvedValue({ status: "created" });
    const res = await call(goodBody, signed);
    expect(await res.json()).toEqual({ ok: true, handoff: "created" });
    expect(handoff.maybeHandleHandoff).toHaveBeenCalledWith("freshdesk", expect.objectContaining({ ticket_id: 7 }));
    expect(side.logActivity).not.toHaveBeenCalled();
  });
  it("releases the delivery claim when processing throws, so the provider's retry is processed", async () => {
    handoff.maybeHandleHandoff.mockRejectedValue(new Error("boom"));
    await expect(call(goodBody, signed)).rejects.toThrow("boom");
    expect(dedupe.releaseWebhookDelivery).toHaveBeenCalledWith("freshdesk", expect.stringMatching(/^sha256:/));
  });
});
