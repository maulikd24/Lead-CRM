import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(async (): Promise<{ user: { id: string; role: string } }> => ({ user: { id: "u1", role: "MANAGER" } })),
  visible: vi.fn(async (): Promise<string[] | null> => ["m1", "rm1"]),
  rateLimit: vi.fn(async () => ({ allowed: true })),
  isAnthropicConfigured: vi.fn(() => false),
  askTheSystem: vi.fn(async (): Promise<{ answer: string; customers: unknown[]; tools: string[] }> => ({ answer: "Two customers.", customers: [], tools: ["find_customers"] })),
  listCustomers: vi.fn(async (_scope: unknown, _where: unknown, _limit?: number) => ({ total: 3, rows: [] })),
  listKycNotFunded: vi.fn(async (_scope: unknown, _limit?: number) => ({ total: 2, rows: [] })),
  listHniPmsHighAcceptance: vi.fn(async (_scope: unknown, _limit?: number) => ({ total: 0, rows: [] })),
  getFunnelTotals: vi.fn(async (_scope: unknown) => ({ leads: 0, kyc: 0, funded: 0, activated: 0 })),
  getTeamFollowups: vi.fn(async (_scope: unknown, _assignees?: unknown) => ({ rms: [] as { rm: string; open: number; overdue: number }[], unassigned: 0 })),
  getTopObjections: vi.fn(async (_scope: unknown) => [] as { text: string; assetClass: string | null }[]),
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
    listHniPmsHighAcceptance: mocks.listHniPmsHighAcceptance,
    getFunnelTotals: mocks.getFunnelTotals,
    getTeamFollowups: mocks.getTeamFollowups,
    getTopObjections: mocks.getTopObjections,
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

const RM_SCOPE = { OR: [{ assignedToId: { in: ["rm1"] } }] };
const SIX = [
  "Which RMs have overdue follow-ups?",
  "Which customers need attention today?",
  "Which HNI clients have high PMS acceptance?",
  KYC,
  "What are the most common customer objections?",
  "Where are we losing customers in the journey?",
];

describe("Co-pilot Ask: RM scope (own customers only)", () => {
  beforeEach(() => {
    mocks.requireAccess.mockImplementation(async () => ({ user: { id: "rm1", role: "RM" } }));
    mocks.visible.mockImplementation(async () => ["rm1"]);
    mocks.isAnthropicConfigured.mockImplementation(() => true);
  });

  it("an RM asking 'Which customers need attention today?' gets only their own customers", async () => {
    const r = await copilotAskAction("Which customers need attention today?");
    expect(r).toMatchObject({ ok: true });
    expect(mocks.requireAccess).toHaveBeenCalledWith("copilot");
    const [scope] = mocks.listCustomers.mock.calls[0] as unknown as [{ OR?: unknown[] }];
    expect(scope.OR).toEqual(RM_SCOPE.OR);
  });

  it("an RM gets no other RM's customers, counts or follow-ups from any of the six intents", async () => {
    for (const q of SIX) {
      const r = await copilotAskAction(q);
      expect(r.ok, q).toBe(true);
    }
    const scopes = [
      ...mocks.listCustomers.mock.calls,
      ...mocks.listKycNotFunded.mock.calls,
      ...mocks.listHniPmsHighAcceptance.mock.calls,
      ...mocks.getFunnelTotals.mock.calls,
      ...mocks.getTopObjections.mock.calls,
      ...mocks.getTeamFollowups.mock.calls,
    ] as unknown as [{ OR?: unknown[] }][];
    expect(scopes.length).toBeGreaterThanOrEqual(6);
    for (const [scope] of scopes) expect(scope.OR).toEqual(RM_SCOPE.OR);
    // Follow-up counts are grouped only over the RM's own tasks, so another user's name or count cannot come back.
    expect(mocks.getTeamFollowups.mock.calls[0][1]).toEqual(["rm1"]);
  });

  it("an unmatched question lists the six, even with an AI key, and runs no model call or query", async () => {
    const r = await copilotAskAction(AI);
    expect(r).toMatchObject({ ok: false, reason: "unsupported" });
    if (r.ok) return;
    expect(r.supported).toEqual(SUPPORTED_QUESTIONS);
    expect(r.supported).toHaveLength(6);
    expect(mocks.askTheSystem).not.toHaveBeenCalled();
    expect(mocks.listCustomers).not.toHaveBeenCalled();
  });

  it("the rate limit and the redacted failure log apply to an RM question too", async () => {
    mocks.rateLimit.mockImplementation(async () => ({ allowed: false }));
    const r = await copilotAskAction(KYC);
    expect(r).toMatchObject({ ok: false, reason: "error" });
    expect(mocks.rateLimit).toHaveBeenCalledWith("ask-system", "rm1", { limit: 20, windowSeconds: 3600 });
    expect(mocks.listKycNotFunded).not.toHaveBeenCalled();
  });
});

describe("Co-pilot Ask: role gate", () => {
  it("a role without the Co-pilot manage right is refused in the answer, and no customer query runs", async () => {
    mocks.requireAccess.mockImplementation(async () => ({ user: { id: "f1", role: "FINANCE" } }));
    const r = await copilotAskAction(KYC);
    expect(r).toMatchObject({ ok: false, reason: "forbidden" });
    expect(mocks.requireAccess).toHaveBeenCalledWith("copilot");
    expect(mocks.listKycNotFunded).not.toHaveBeenCalled();
    expect(mocks.askTheSystem).not.toHaveBeenCalled();
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
