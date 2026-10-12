import { afterEach, describe, expect, it, vi } from "vitest";

import { googleAdsAdapter } from "./google-ads";
import { googleAdsMockAdapter } from "./mock/google-ads.mock";

afterEach(() => vi.unstubAllGlobals());

describe("google_ads adapter", () => {
  it("is not configured until credentials arrive, and fails closed on webhooks", async () => {
    expect((await googleAdsAdapter.testConnection()).ok).toBe(false);
    expect(googleAdsAdapter.verifySignature({}, "")).toBe(false);
    expect(await googleAdsAdapter.handleWebhook({}, {})).toEqual([]);
    expect(googleAdsAdapter.actions).toEqual({});
  });

  it("the connection test makes one account read and reports name, currency and timezone without secrets", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "ACC", expires_in: 3600 }), { status: 200 });
        return new Response(JSON.stringify({ results: [{ customer: { descriptiveName: "Demo", currencyCode: "INR", timeZone: "Asia/Kolkata" } }] }), { status: 200 });
      }),
    );
    await googleAdsAdapter.configure({ customerId: "123-456-7890", developerToken: "DEVSECRET", clientId: "cid", clientSecret: "CSECRET", refreshToken: "RSECRET" }, {});
    const res = await googleAdsAdapter.testConnection();
    expect(res.ok).toBe(true);
    expect(res.message).toContain("Demo");
    for (const secret of ["DEVSECRET", "CSECRET", "RSECRET", "ACC"]) expect(res.message).not.toContain(secret);
    expect(calls.filter((c) => c.includes("googleads"))).toHaveLength(1);
  });

  it("a bad credential produces a safe message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("SECRET-BODY", { status: 400 })));
    await googleAdsAdapter.configure({ customerId: "1234567890", developerToken: "d", clientId: "c", clientSecret: "s", refreshToken: "r" }, {});
    const res = await googleAdsAdapter.testConnection();
    expect(res.ok).toBe(false);
    expect(res.message).not.toContain("SECRET-BODY");
  });

  it("the mock adapter makes no network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect((await googleAdsMockAdapter.testConnection()).ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
