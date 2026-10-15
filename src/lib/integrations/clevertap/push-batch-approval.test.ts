import { beforeEach, describe, expect, it, vi } from "vitest";

const findApprovals = vi.fn();
const updateApprovals = vi.fn();
const findConfig = vi.fn();
const findClients = vi.fn(async () => []);
const selectBatch = vi.fn(async () => ["c2", "c1"]);
const requestApproval = vi.fn();
// The request check and create run in one transaction under an advisory lock. runInLock serializes transactions the way the lock does.
let lockTail: Promise<unknown> = Promise.resolve();
const runInLock = (fn: (tx: unknown) => Promise<unknown>) => {
  const run = lockTail.then(() => fn(tx));
  lockTail = run.catch(() => undefined);
  return run;
};
const tx = {
  approvalRequest: { findMany: (...a: unknown[]) => findApprovals(...a) },
  $executeRaw: (...a: unknown[]) => executeRaw(...a),
};
const executeRaw = vi.fn<(...args: unknown[]) => Promise<number>>(async () => 0);
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    integrationConfig: { findUnique: (...a: unknown[]) => findConfig(...a) },
    approvalRequest: { findMany: (...a: unknown[]) => findApprovals(...a), updateMany: (...a: unknown[]) => updateApprovals(...a) },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => runInLock(fn),
  },
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
import { batchHash, BATCH_TTL_MS } from "./push-approval";

const ZERO = { pushed: 0, unchanged: 0, skipped: 0, retry: 0, failed: 0 };
const ADMIN = { id: "u-maker", role: "ADMIN" as const };
// entityId is the batch hash the request was created with: the push recomputes it from the payload before it claims the batch.
const approved = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  status: "APPROVED",
  payload: { region: "in1", count: 2, clientIds: ["c2", "c1"], state: "ready" },
  entityId: batchHash("in1", ["c2", "c1"]),
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
      tx,
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

describe("the approved batch is bound to the ids the approver saw", () => {
  it("refuses a payload altered after approval: the recomputed hash no longer matches the request", async () => {
    findApprovals.mockResolvedValue([approved({ payload: { region: "in1", count: 2, clientIds: ["c2", "c3"], state: "ready" } })]);
    expect(await pushStaleSignals()).toEqual(ZERO);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateApprovals).not.toHaveBeenCalled();
    expect(String(warn?.mock.calls[0][0])).toContain("mismatch");
  });
});

describe("an expired batch neither sends nor blocks a new request", () => {
  it("a new request is accepted over an approved batch that has expired, and it expires after 24 hours", async () => {
    findApprovals.mockResolvedValue([approved({ expiresAt: new Date(Date.now() - 60_000) })]);
    requestApproval.mockResolvedValue({ id: "req-2" });
    const before = Date.now();
    const r = await requestCleverTapPushBatch(ADMIN, 25);
    expect(r.requestId).toBe("req-2");
    const input = (requestApproval.mock.calls[0][1] as { expiresAt: Date }).expiresAt;
    expect(input.getTime()).toBeGreaterThanOrEqual(before + BATCH_TTL_MS - 1000);
    expect(input.getTime()).toBeLessThanOrEqual(Date.now() + BATCH_TTL_MS);
  });

  it("an expired pending request does not block a new request either", async () => {
    findApprovals.mockResolvedValue([approved({ status: "PENDING", expiresAt: new Date(Date.now() - 60_000) })]);
    requestApproval.mockResolvedValue({ id: "req-3" });
    await expect(requestCleverTapPushBatch(ADMIN)).resolves.toMatchObject({ requestId: "req-3" });
  });
});

describe("two Admins asking at the same moment create one batch", () => {
  it("the second request, made while the first is being created, is refused and nothing else is created", async () => {
    let store: Array<Record<string, unknown>> = [];
    findApprovals.mockImplementation(async () => store);
    requestApproval.mockImplementation(async (_type: unknown, input: { entityId: string; payload: unknown; expiresAt?: Date }) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const row = { id: `req-${store.length + 1}`, status: "PENDING", payload: input.payload, entityId: input.entityId, expiresAt: input.expiresAt ?? null };
      store = [row, ...store];
      return { id: row.id };
    });
    const results = await Promise.allSettled([
      requestCleverTapPushBatch(ADMIN, 25),
      requestCleverTapPushBatch({ id: "u-maker-2", role: "ADMIN" }, 25),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toMatch(/already waiting/);
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalled();
  });
});

