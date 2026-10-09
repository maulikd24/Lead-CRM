import { beforeEach, describe, expect, it, vi } from "vitest";

const findConfig = vi.fn();
const findClients = vi.fn(async () => []);
vi.mock("@/lib/db/prisma", () => ({
  prisma: { integrationConfig: { findUnique: (...a: unknown[]) => findConfig(...a) }, client: { findMany: (...a: unknown[]) => findClients(...(a as [])) }, cleverTapSync: {} },
  basePrisma: { integrationConfig: { findUnique: (...a: unknown[]) => findConfig(...a) }, client: { findMany: (...a: unknown[]) => findClients(...(a as [])) }, cleverTapSync: {} },
}));
let creds: Record<string, unknown> = {};
vi.mock("@/lib/security/crypto", () => ({ decryptJson: () => creds }));
vi.mock("@/lib/intelligence/facts", () => ({ loadCustomerFacts: vi.fn() }));
vi.mock("@/lib/intelligence/refresh", () => ({ computeIntelligence: vi.fn() }));

import { pushStaleSignals } from "./push-batch";

const ZERO = { pushed: 0, unchanged: 0, skipped: 0, retry: 0, failed: 0 };
const live = { isEnabled: true, mode: "live", credentials: "enc" };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.unstubAllEnvs();
  findConfig.mockReset(); findClients.mockClear();
  creds = { accountId: "acc", passcode: "pass", region: "in1" };
  fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
});

describe("pushStaleSignals gating", () => {
  it.each([undefined, "true", "0"])("flag %s => zeros, no DB call", async (v) => {
    if (v !== undefined) vi.stubEnv("CLEVERTAP_PUSH_ENABLED", v);
    expect(await pushStaleSignals()).toEqual(ZERO);
    expect(findConfig).not.toHaveBeenCalled();
    expect(findClients).not.toHaveBeenCalled();
  });

  const cases: [string, unknown, Record<string, unknown>?][] = [
    ["no config", null],
    ["disabled", { ...live, isEnabled: false }],
    ["dry_run", { ...live, mode: "dry_run" }],
    ["mock", { ...live, mode: "mock" }],
    ["eu1", live, { accountId: "a", passcode: "p", region: "eu1" }],
    ["blank region", live, { accountId: "a", passcode: "p" }],
    ["empty passcode", live, { accountId: "a", passcode: "", region: "in1" }],
  ];
  it.each(cases)("%s => zeros, zero customer queries, zero fetches", async (_n, cfg, c) => {
    vi.stubEnv("CLEVERTAP_PUSH_ENABLED", "1");
    findConfig.mockResolvedValue(cfg);
    if (c) creds = c;
    expect(await pushStaleSignals()).toEqual(ZERO);
    expect(findClients).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("live + in1 with no customers => zeros after exactly one customer query, no fetch", async () => {
    vi.stubEnv("CLEVERTAP_PUSH_ENABLED", "1");
    findConfig.mockResolvedValue(live);
    expect(await pushStaleSignals()).toEqual(ZERO);
    expect(findClients).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
