import { beforeEach, describe, expect, it, vi } from "vitest";

const findApprovals = vi.fn();
const updateApprovals = vi.fn();
const findConfig = vi.fn();
const findClients = vi.fn(async () => []);
const selectBatch = vi.fn(async () => ["c2", "c1"]);
const requestApproval = vi.fn();
vi.mock("@/lib/db/prisma", () => ({
  prisma: { integrationConfig: { findUnique: (...a: unknown[]) => findConfig(...a) }, approvalRequest: { findMany: (...a: unknown[]) => findApprovals(...a), updateMany: (...a: unknown[]) => updateApprovals(...a) } },
  basePrisma: { integrationConfig: { findUnique: (...a: unknown[]) => findConfig(...a) }, approvalRequest: { findMany: (...a: unknown[]) => findApprovals(...a), updateMany: (...a: unknown[]) => updateApprovals(...a) }, $queryRaw: (...a: unknown[]) => findClients(...(a as [])) },
}));
vi.mock("@/lib/policy/approvals/service", () => ({ requestApproval: (...a: unknown[]) => requestApproval(...a) }));
vi.mock("@/lib/security/crypto", () => ({ decryptJson: () => ({ accountId: "acc", passcode: "pass", region: "in1" }) }));
vi.mock("@/lib/consent/enforce", () => ({ consentEnforced: () => false }));
vi.mock("@/lib/consent/coarse", () => ({ coarseMarketingWhere: () => undefined }));
vi.mock("@/lib/consent/push", () => ({ applyPushStance: (x: unknown) => x, pushStanceFor: vi.fn() }));
vi.mock("./select-batch", () => ({ prismaSelectDb: () => ({}), selectBatch: (...a: unknown[]) => selectBatch(...(a as [])) }));
vi.mock("./ledger", () => ({ getLastHash: vi.fn(), recordChecked: vi.fn(async () => {}), recordFailure: vi.fn(), recordSuccess: vi.fn() }));
vi.mock("./identity", () => ({ loadAppUserId: vi.fn() }));
vi.mock("@/lib/intelligence/facts", () => ({ loadCustomerFacts: vi.fn() }));
vi.mock("@/lib/intelligence/refresh", () => ({ computeIntelligence: vi.fn() }));
// The per-customer pusher is replaced by one that sends one profile through the deps it is given, so the stubbed fetch is the only transport.
vi.mock("./pusher", () => ({
  pushCustomerSignals: vi.fn(async (_id: string, deps: { send: (p: unknown) => Promise<{ ok: boolean; status: number }> }) => {
    await deps.send({ d: { identity: "app-1" } });
    return { status: "pushed" };
  }),
}));

import { pushStaleSignals } from "./push-batch";
import { requestCleverTapPushBatch } from "./batch-request";

const ZERO = { pushed: 0, unchanged: 0, skipped: 0, retry: 0, failed: 0 };
const ADMIN = { id: "u-maker", role: "ADMIN" as const };
const approved = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  status: "APPROVED",
  payload: { region: "in1", count: 2, clientIds: ["c2", "c1"], state: "ready" },
  expiresAt: null,
  ...over,
});
let fetchMock: ReturnType<typeof vi.fn>;
let warn: { mockRestore: () => void; mock: { calls: unknown[][] } } | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CLEVERTAP_PUSH_ENABLED", "1");
  findConfig.mockResolvedValue({ isEnabled: true, mode: "live", credentials: "enc" });
  findApprovals.mockResolvedValue([]);
  updateApprovals.mockResolvedValue({ count: 1 });
  selectBatch.mockResolvedValue(["c2", "c1"]);
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  warn?.mockRestore();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("CleverTap push sends only the frozen, approved batch", () => {
  it("with no request at all, nothing is sent and no customer is selected", async () => {
    expect(await pushStaleSignals()).toEqual(ZERO);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(selectBatch).not.toHaveBeenCalled();
    expect(String(warn?.mock.calls[0][0])).toContain("no_approval");
  });

  it.each([
    ["pending", { status: "PENDING" }],
    ["rejected", { status: "REJECTED" }],
  ])("refuses when the latest request is %s", async (reason, over) => {
    findApprovals.mockResolvedValue([approved(over)]);
    expect(await pushStaleSignals()).toEqual(ZERO);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(warn?.mock.calls[0][0])).toContain(reason);
    expect(updateApprovals).not.toHaveBeenCalled();
  });

  it("refuses an approved batch that has passed its expiry", async () => {
    findApprovals.mockResolvedValue([approved({ expiresAt: new Date(Date.now() - 60_000) })]);
    expect(await pushStaleSignals()).toEqual(ZERO);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(warn?.mock.calls[0][0])).toContain("expired");
  });

  it("refuses an approved batch whose region does not match the live integration", async () => {
    findApprovals.mockResolvedValue([approved({ payload: { region: "eu1", count: 2, clientIds: ["c1", "c2"], state: "ready" } })]);
    expect(await pushStaleSignals()).toEqual(ZERO);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(warn?.mock.calls[0][0])).toContain("mismatch");
  });

  it("sends exactly the approved ids, in the approved order, and claims the request before sending", async () => {
    findApprovals.mockResolvedValue([approved()]);
    const result = await pushStaleSignals();
    expect(result.pushed).toBe(2);
    expect(selectBatch).not.toHaveBeenCalled();
    expect(updateApprovals).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "r1", status: "APPROVED", payload: { path: ["state"], equals: "ready" } }) }),
    );
    expect(updateApprovals.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://in1.api.clevertap.com/1/upload");
    expect(init.headers).toMatchObject({ "X-CleverTap-Account-Id": "acc" });
  });

  it("an approved batch is used once: when the claim finds it already sent, nothing is sent", async () => {
    findApprovals.mockResolvedValue([approved()]);
    updateApprovals.mockResolvedValue({ count: 0 });
    expect(await pushStaleSignals()).toEqual(ZERO);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(warn?.mock.calls[0][0])).toContain("used");
  });

  it("a second tick after a send finds the request used and sends nothing", async () => {
    findApprovals.mockResolvedValue([approved({ payload: { region: "in1", count: 2, clientIds: ["c2", "c1"], state: "sent", sentAt: "2026-10-13T00:00:00.000Z" } })]);
    expect(await pushStaleSignals()).toEqual(ZERO);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateApprovals).not.toHaveBeenCalled();
  });
});

describe("requesting a batch freezes the selection into the approval", () => {
  it("creates one CLEVERTAP_PUSH_BATCH request with the region, count and the exact ids", async () => {
    requestApproval.mockResolvedValue({ id: "req-1" });
    const r = await requestCleverTapPushBatch(ADMIN, 25);
    expect(r).toEqual({ requestId: "req-1", count: 2, region: "in1" });
    expect(requestApproval).toHaveBeenCalledWith(
      "CLEVERTAP_PUSH_BATCH",
      expect.objectContaining({ entity: "CleverTapPushBatch", payload: { region: "in1", count: 2, clientIds: ["c2", "c1"], state: "ready" } }),
      ADMIN,
    );
    const reason = (requestApproval.mock.calls[0][1] as { reason: string }).reason;
    expect(reason).not.toContain("c1");
  });

  it("refuses while another batch is waiting for a decision", async () => {
    findApprovals.mockResolvedValue([approved({ status: "PENDING" })]);
    await expect(requestCleverTapPushBatch(ADMIN)).rejects.toThrow(/already waiting/);
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("refuses while an approved batch is still unsent", async () => {
    findApprovals.mockResolvedValue([approved()]);
    await expect(requestCleverTapPushBatch(ADMIN)).rejects.toThrow(/already waiting/);
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("does not request anything when no customer is ready", async () => {
    selectBatch.mockResolvedValue([]);
    await expect(requestCleverTapPushBatch(ADMIN)).rejects.toThrow(/No customers/);
    expect(requestApproval).not.toHaveBeenCalled();
  });
});
