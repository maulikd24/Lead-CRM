import { afterEach, describe, expect, it, vi } from "vitest";
import { clevertapAdapter } from "./clevertap";

const client = { id: "c1", name: "Test", email: "t@example.com", mobile: null, status: "ACTIVE" } as never;
const creds = { accountId: "acc-test", passcode: "pass-test" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("clevertap adapter write guard", () => {
  it("blocks syncProfile outside India without any network call", async () => {
    vi.stubEnv("CLEVERTAP_PUSH_ENABLED", "1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const region of ["eu1", "EU1", "us1", ""]) {
      await clevertapAdapter.configure({ ...creds, region }, {});
      const res = await clevertapAdapter.actions.syncProfile(client, {});
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/India/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows syncProfile in in1 against the India host with both auth headers", async () => {
    vi.stubEnv("CLEVERTAP_PUSH_ENABLED", "1");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "success" }) });
    vi.stubGlobal("fetch", fetchMock);
    await clevertapAdapter.configure({ ...creds, region: "in1" }, {});
    const res = await clevertapAdapter.actions.syncProfile(client, {});
    expect(res.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://in1.api.clevertap.com/1/upload");
    expect((init.headers as Record<string, string>)["X-CleverTap-Account-Id"]).toBeTruthy();
    expect((init.headers as Record<string, string>)["X-CleverTap-Passcode"]).toBeTruthy();
  });

  it("blocks syncProfile in in1 unless CLEVERTAP_PUSH_ENABLED is exactly 1", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await clevertapAdapter.configure({ ...creds, region: "in1" }, {});
    for (const flag of [undefined, "true", "0", ""]) {
      if (flag === undefined) vi.stubEnv("CLEVERTAP_PUSH_ENABLED", undefined as never);
      else vi.stubEnv("CLEVERTAP_PUSH_ENABLED", flag);
      const res = await clevertapAdapter.actions.syncProfile(client, {});
      expect(res.success).toBe(false);
      expect(res.error).toBe("CleverTap writes are switched off (CLEVERTAP_PUSH_ENABLED is not 1).");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
