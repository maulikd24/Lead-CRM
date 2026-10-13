import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(async (): Promise<{ user: { id: string; role: string } }> => ({ user: { id: "u1", role: "MANAGER" } })),
  visible: vi.fn(async (): Promise<string[] | null> => ["m1", "rm1"]),
  rateLimit: vi.fn(async () => ({ allowed: true })),
  isAnthropicConfigured: vi.fn(() => false),
  askTheSystem: vi.fn(async (): Promise<{ answer: string; customers: unknown[]; tools: string[] }> => ({ answer: "Two customers.", customers: [], tools: ["find_customers"] })),
  listCustomers: vi.fn(async (_scope: unknown, _where: unknown, _limit?: number) => ({ total: 3, rows: [] })),
  listKycNotFunded: vi.fn(async (_scope: unknown, _limit?: number) => ({ total: 2, rows: [] })),
}));

vi.mock("@/lib/auth/require-role", () => ({ requireAccess: mocks.requireAccess }));
vi.mock("@/lib/auth/visibility", () => ({ getVisibleUserIds: mocks.visible }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/ai/gateway", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/ai/gateway")>()), isAnthropicConfigured: mocks.isAnthropicConfigured }));
vi.mock("@/lib/intelligence/ask", () => ({ askTheSystem: mocks.askTheSystem }));
vi.mock("@/lib/intelligence/management", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/intelligence/management")>();
  return {
    ...real,
    listCustomers: mocks.listCustomers,
    listKycNotFunded: mocks.listKycNotFunded,
    getFunnelTotals: vi.fn(async () => ({ leads: 0, kyc: 0, funded: 0, activated: 0 })),
    getTeamFollowups: vi.fn(async () => ({ rms: [], unassigned: 0 })),
    getTopObjections: vi.fn(async () => []),
    listHniPmsHighAcceptance: vi.fn(async () => ({ total: 0, rows: [] })),
  };
});

import { copilotAskAction } from "./actions";
import { SUPPORTED_QUESTIONS } from "@/lib/intelligence/ask-intents";

const KYC = "Which KYC customers have not funded?";
const AI = "Which customers are quiet this month?";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockImplementation(async () => ({ user: { id: "u1", role: "MANAGER" } }));
  mocks.visible.mockImplementation(async () => ["m1", "rm1"]);
  mocks.rateLimit.mockImplementation(async () => ({ allowed: true }));
  mocks.isAnthropicConfigured.mockImplementation(() => false);
});
afterEach(() => vi.restoreAllMocks());

describe("Co-pilot Ask: role gate (same as Ask the system)", () => {
  it("an RM is refused in the answer, and no customer query runs", async () => {
    mocks.requireAccess.mockImplementation(async () => ({ user: { id: "rm1", role: "RM" } }));
    const r = await copilotAskAction(KYC);
    expect(r).toMatchObject({ ok: false, reason: "forbidden" });
    expect(mocks.requireAccess).toHaveBeenCalledWith("copilot");
    expect(mocks.listKycNotFunded).not.toHaveBeenCalled();
    expect(mocks.askTheSystem).not.toHaveBeenCalled();
  });

  it("an RM cannot reach another RM's customers through the chat, even with an AI key", async () => {
    mocks.requireAccess.mockImplementation(async () => ({ user: { id: "rm1", role: "RM" } }));
    mocks.isAnthropicConfigured.mockImplementation(() => true);
    const r = await copilotAskAction(AI);
    expect(r.ok).toBe(false);
    expect(mocks.askTheSystem).not.toHaveBeenCalled();
    expect(mocks.visible).not.toHaveBeenCalled();
  });
});

describe("Co-pilot Ask: scope and sources", () => {
  it("a manager's deterministic answer is limited to the visible customers and names its source and as-of time", async () => {
    const before = Date.now();
    const r = await copilotAskAction(KYC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answer).toMatch(/2 KYC-approved customers have not funded yet/);
    expect(r.source).toMatch(/KycRecord \(APPROVED\)/);
    expect(Date.parse(r.asOf)).toBeGreaterThanOrEqual(before);
    const [scope] = mocks.listKycNotFunded.mock.calls[0] as unknown as [{ OR?: unknown[] }];
    expect(scope.OR).toEqual([{ assignedToId: { in: ["m1", "rm1"] } }, { assignedToId: null }]);
  });

  it("an admin (no visibility limit) gets the unrestricted management scope", async () => {
    mocks.requireAccess.mockImplementation(async () => ({ user: { id: "a1", role: "ADMIN" } }));
    mocks.visible.mockImplementation(async () => null);
    await copilotAskAction(KYC);
    const [scope] = mocks.listKycNotFunded.mock.calls[0] as unknown as [{ OR?: unknown }];
    expect(scope.OR).toBeUndefined();
  });

  it("a question with no intent and no AI key lists the supported questions and runs no model call", async () => {
    const r = await copilotAskAction(AI);
    expect(r).toMatchObject({ ok: false, reason: "unsupported" });
    if (r.ok) return;
    expect(r.supported).toEqual(SUPPORTED_QUESTIONS);
    expect(r.supported).toHaveLength(6);
    expect(mocks.askTheSystem).not.toHaveBeenCalled();
  });

  it("with an AI key, an unmatched question goes to the Ask loop with the same scope, and its tools are the source", async () => {
    mocks.isAnthropicConfigured.mockImplementation(() => true);
    const r = await copilotAskAction(AI);
    expect(mocks.askTheSystem).toHaveBeenCalledWith(AI, expect.any(Object), ["m1", "rm1"], "MANAGER");
    expect(r).toMatchObject({ ok: true, answer: "Two customers.", source: "AI answer from live data (read-only tools: find_customers)" });
  });

  it("a matched intent is answered deterministically even when an AI key is set", async () => {
    mocks.isAnthropicConfigured.mockImplementation(() => true);
    await copilotAskAction(KYC);
    expect(mocks.askTheSystem).not.toHaveBeenCalled();
  });
});

describe("Co-pilot Ask: input and failure handling", () => {
  it("a short question is refused without a query", async () => {
    const r = await copilotAskAction("hi");
    expect(r).toMatchObject({ ok: false, reason: "unsupported" });
    expect(mocks.listKycNotFunded).not.toHaveBeenCalled();
  });

  it("the rate limit stops the question before any query", async () => {
    mocks.rateLimit.mockImplementation(async () => ({ allowed: false }));
    const r = await copilotAskAction(KYC);
    expect(r).toMatchObject({ ok: false, reason: "error" });
    expect(mocks.listKycNotFunded).not.toHaveBeenCalled();
    expect(mocks.rateLimit).toHaveBeenCalledWith("ask-system", "u1", { limit: 20, windowSeconds: 3600 });
  });

  it("a failure is logged only in redacted form, with no PAN or email from the question", async () => {
    mocks.isAnthropicConfigured.mockImplementation(() => true);
    mocks.askTheSystem.mockImplementation(async () => {
      throw new Error("model down");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await copilotAskAction("Why did ABCDE1234F and jo@example.com not fund yet?");
    expect(r).toMatchObject({ ok: false, reason: "error", message: "Couldn't answer that right now." });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("ABCDE1234F");
    expect(logged).not.toContain("jo@example.com");
  });
});
