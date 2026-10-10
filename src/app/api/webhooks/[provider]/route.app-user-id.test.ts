import { beforeEach, describe, expect, it, vi } from "vitest";

/** Inbound CleverTap events are matched to a customer by app user id through the signup ledger (APP_USER_ID_LINKING=1). */
const db = vi.hoisted(() => ({
  client: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  leadIntake: { findUnique: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/security/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/security/rate-limit")>()), rateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, retryAfterSeconds: 0 })) }));
vi.mock("@/lib/security/webhook-dedupe", () => ({ claimWebhookDelivery: vi.fn(async () => true), releaseWebhookDelivery: vi.fn(), deliveryKey: () => "k" }));
const events = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("@/lib/integrations/registry", () => ({
  getAdapter: vi.fn(async () => ({ verifySignature: () => true, handleWebhook: async () => events.list })),
  isMockAdapter: () => false,
}));
vi.mock("@/lib/integrations/freshdesk/deps", () => ({ maybeHandleHandoff: vi.fn(async () => null) }));
const side = vi.hoisted(() => ({ logActivity: vi.fn(async () => ({ id: "a1" })), onEvent: vi.fn(), findClientByIdentity: vi.fn(), resolveInboundClient: vi.fn() }));
vi.mock("@/lib/activities/log-activity", () => ({ logActivity: side.logActivity }));
vi.mock("@/lib/journeys/dispatch", () => ({ onEvent: side.onEvent }));
vi.mock("@/lib/integrations/task-sync", () => ({ handleExternalTaskEvent: vi.fn() }));
vi.mock("@/lib/clients/inbound-contact", () => ({ resolveInboundClient: side.resolveInboundClient }));
vi.mock("@/lib/clients/identity", () => ({ findClientByIdentity: side.findClientByIdentity }));

import { POST } from "./route";

const post = () => POST(new Request("http://localhost/api/webhooks/clevertap", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), { params: Promise.resolve({ provider: "clevertap" }) });
const appEvent = { type: "campaign_event", appUserId: "sub-1", payload: { eventName: "Opened", message: "App event: Opened" } };

beforeEach(() => {
  vi.clearAllMocks();
  events.list = [appEvent];
  side.findClientByIdentity.mockResolvedValue({ match: null });
  db.leadIntake.findUnique.mockResolvedValue({ clientId: "c-old", status: "CREATED" });
  db.client.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === "c-old" ? { mergedIntoId: "c-new", isDeleted: false } : where.id === "c-new" ? { id: "c-new", mergedIntoId: null, isDeleted: false } : null);
  db.client.findUniqueOrThrow.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id }));
});

describe("CleverTap events matched by app user id", () => {
  it("does nothing with the switch off: an event carrying only an app user id is dropped", async () => {
    vi.stubEnv("APP_USER_ID_LINKING", "");
    expect(await (await post()).json()).toEqual({ ok: true, eventsProcessed: 1 });
    expect(side.logActivity).not.toHaveBeenCalled();
    expect(db.leadIntake.findUnique).not.toHaveBeenCalled();
  });
  it("with the switch on, files the event on the surviving customer of the ledger row (follows a merge)", async () => {
    vi.stubEnv("APP_USER_ID_LINKING", "1");
    await post();
    expect(db.leadIntake.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { source_externalId: { source: "allvest_app", externalId: "sub-1" } } }));
    expect(side.logActivity).toHaveBeenCalledWith(expect.objectContaining({ clientId: "c-new" }));
  });
  it("with the switch on and no ledger row, still drops the event (nothing is created from an opaque id)", async () => {
    vi.stubEnv("APP_USER_ID_LINKING", "1");
    db.leadIntake.findUnique.mockResolvedValue(null);
    await post();
    expect(side.logActivity).not.toHaveBeenCalled();
    expect(side.resolveInboundClient).not.toHaveBeenCalled();
  });
});
