import { afterEach, describe, expect, it, vi } from "vitest";
import { referralApiAdapter } from "./referral-api";
import { referralApiMockAdapter } from "./mock/referral-api.mock";

afterEach(() => vi.unstubAllGlobals());

describe("referral API adapter", () => {
  it("refuses to test without a base URL and token", async () => {
    await referralApiAdapter.configure({}, {});
    expect((await referralApiAdapter.testConnection()).ok).toBe(false);
  });
  it("tests with one read-only GET and reports success", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 2000, data: { referrers: {} } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await referralApiAdapter.configure({ baseUrl: "https://ra.example.test", token: "tok" }, {});
    expect(await referralApiAdapter.testConnection()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("GET");
  });
  it("reports a bad credential without leaking details", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await referralApiAdapter.configure({ baseUrl: "https://ra.example.test", token: "tok" }, {});
    const r = await referralApiAdapter.testConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/credential/i);
  });
  it("has no webhook or actions in either mode", async () => {
    for (const a of [referralApiAdapter, referralApiMockAdapter]) {
      expect(a.verifySignature({}, "")).toBe(false);
      expect(await a.handleWebhook({}, {})).toEqual([]);
      expect(a.actions).toEqual({});
    }
  });
  it("mock mode makes no network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await referralApiMockAdapter.testConnection()).ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
