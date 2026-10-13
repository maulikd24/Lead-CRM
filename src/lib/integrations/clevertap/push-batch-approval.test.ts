import { beforeEach, describe, expect, it, vi } from "vitest";

const findApprovals = vi.fn();
const findConfig = vi.fn();
vi.mock("@/lib/db/prisma", () => ({
  prisma: { integrationConfig: { findUnique: (...a: unknown[]) => findConfig(...a) }, approvalRequest: { findMany: (...a: unknown[]) => findApprovals(...a) } },
  basePrisma: { integrationConfig: { findUnique: (...a: unknown[]) => findConfig(...a) }, approvalRequest: { findMany: (...a: unknown[]) => findApprovals(...a) } },
}));
vi.mock("@/lib/security/crypto", () => ({ decryptJson: () => ({ accountId: "acc", passcode: "pass", region: "in1" }) }));
vi.mock("@/lib/consent/enforce", () => ({ consentEnforced: () => false }));
vi.mock("@/lib/consent/coarse", () => ({ coarseMarketingWhere: () => undefined }));
vi.mock("@/lib/consent/push", () => ({ applyPushStance: (x: unknown) => x, pushStanceFor: vi.fn() }));
vi.mock("./select-batch", () => ({ prismaSelectDb: () => ({}), selectBatch: vi.fn(async () => ["c2", "c1"]) }));
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

import { batchRef } from "./push-approval";
import { pushStaleSignals } from "./push-batch";

const ZERO = { pushed: 0, unchanged: 0, skipped: 0, retry: 0, failed: 0 };
const REF = batchRef("in1", ["c1", "c2"]);
let fetchMock: ReturnType<typeof vi.fn>;
let warn: { mockRestore: () => void; mock: { calls: unknown[][] } } | undefined;

beforeEach(() => {
  vi.stubEnv("CLEVERTAP_PUSH_ENABLED", "1");
  findConfig.mockReset().mockResolvedValue({ isEnabled: true, mode: "live", credentials: "enc" });
  findApprovals.mockReset().mockResolvedValue([]);
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  warn?.mockRestore();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("CleverTap push needs an approved batch", () => {
  it("refuses with no approval request: nothing is sent, counts only are logged", async () => {
    const result = await pushStaleSignals(25);
    expect(result).toEqual({ ...ZERO, skipped: 2 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn?.mock.calls).toHaveLength(1);
    const line = String(warn?.mock.calls[0][0]);
    expect(line).toContain("no_approval");
    expect(line).toContain("2 customers");
    expect(line).not.toContain("c1");
  });

  it("refuses when the only request for this batch was rejected", async () => {
    findApprovals.mockResolvedValue([{ id: "r1", status: "REJECTED", payload: { region: "in1", count: 2 }, expiresAt: null }]);
    expect(await pushStaleSignals(25)).toEqual({ ...ZERO, skipped: 2 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(warn?.mock.calls[0][0])).toContain("rejected");
  });

  it("refuses when the approval is still pending", async () => {
    findApprovals.mockResolvedValue([{ id: "r1", status: "PENDING", payload: { region: "in1", count: 2 }, expiresAt: null }]);
    expect(await pushStaleSignals(25)).toEqual({ ...ZERO, skipped: 2 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an approval whose payload does not match the batch", async () => {
    findApprovals.mockResolvedValue([{ id: "r1", status: "APPROVED", payload: { region: "in1", count: 9 }, expiresAt: null }]);
    expect(await pushStaleSignals(25)).toEqual({ ...ZERO, skipped: 2 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends with an approved request for exactly this batch (region, count, hash)", async () => {
    findApprovals.mockResolvedValue([{ id: "r1", status: "APPROVED", payload: { region: "in1", count: 2 }, expiresAt: null }]);
    const result = await pushStaleSignals(25);
    expect(result.pushed).toBe(2);
    expect(findApprovals).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ entityId: REF.hash }) }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://in1.api.clevertap.com/1/upload");
    expect(init.headers).toMatchObject({ "X-CleverTap-Account-Id": "acc" });
  });

  it("the batch hash is order independent and changes with the region or the ids", () => {
    expect(batchRef("in1", ["c2", "c1"]).hash).toBe(REF.hash);
    expect(batchRef("eu1", ["c1", "c2"]).hash).not.toBe(REF.hash);
    expect(batchRef("in1", ["c1", "c3"]).hash).not.toBe(REF.hash);
  });
});
