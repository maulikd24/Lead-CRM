import { describe, expect, it, vi } from "vitest";
import { DEFAULT_GRAPH_VERSION, MetaAdsError, createMetaAdsClient, resolveGraphVersion } from "./meta-ads";

const TOKEN = "TOKEN_SECRET_VALUE";

function res(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

function row(over: Record<string, unknown> = {}) {
  return {
    campaign_id: "111",
    campaign_name: "Spring Brokerage",
    spend: "1234.56",
    impressions: "10000",
    clicks: "250",
    reach: "8000",
    actions: [{ action_type: "lead", value: "12" }],
    account_currency: "INR",
    date_start: "2026-10-01",
    date_stop: "2026-10-01",
    ...over,
  };
}

function make(fetchImpl: ReturnType<typeof vi.fn>, extra: Record<string, unknown> = {}) {
  return createMetaAdsClient({ accountId: "act_1234567890", accessToken: TOKEN, fetch: fetchImpl as unknown as typeof fetch, sleep: async () => {}, ...extra });
}

describe("resolveGraphVersion", () => {
  it("defaults, accepts vNN.N and rejects junk", () => {
    expect(resolveGraphVersion(undefined)).toBe(DEFAULT_GRAPH_VERSION);
    expect(resolveGraphVersion("v22.0")).toBe("v22.0");
    expect(resolveGraphVersion("22.0")).toBe("v22.0");
    expect(resolveGraphVersion("../evil")).toBe(DEFAULT_GRAPH_VERSION);
  });
});

describe("createMetaAdsClient configuration", () => {
  it("rejects a malformed account id or a missing token without calling the network", () => {
    const fetchImpl = vi.fn();
    expect(() => createMetaAdsClient({ accountId: "abc", accessToken: TOKEN, fetch: fetchImpl as unknown as typeof fetch })).toThrow(MetaAdsError);
    expect(() => createMetaAdsClient({ accountId: "1234567890", accessToken: "", fetch: fetchImpl as unknown as typeof fetch })).toThrow(MetaAdsError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("getAccount", () => {
  it("reads name, currency and timezone with a read-only GET and the token in the Authorization header only", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res({ name: "Main", currency: "INR", timezone_name: "Asia/Kolkata", id: "act_1234567890" }));
    const info = await make(fetchImpl).getAccount();
    expect(info).toEqual({ name: "Main", currency: "INR", timezoneName: "Asia/Kolkata" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(`https://graph.facebook.com/${DEFAULT_GRAPH_VERSION}/act_1234567890?fields=name%2Ccurrency%2Ctimezone_name`);
    expect(String(url)).not.toContain(TOKEN);
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.method ?? "GET").toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("getInsights", () => {
  it("requests campaign-level daily insights for the window and normalises rows to minor units", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res({ data: [row()] }));
    const rows = await make(fetchImpl).getInsights({ since: "2026-10-01", until: "2026-10-07" });
    expect(rows).toEqual([
      { campaignId: "111", campaignName: "Spring Brokerage", date: "2026-10-01", spendMinor: BigInt(123456), currency: "INR", impressions: 10000, clicks: 250, reach: 8000, leads: 12 },
    ]);
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.pathname).toBe(`/${DEFAULT_GRAPH_VERSION}/act_1234567890/insights`);
    expect(url.searchParams.get("level")).toBe("campaign");
    expect(url.searchParams.get("time_increment")).toBe("1");
    expect(JSON.parse(url.searchParams.get("time_range")!)).toEqual({ since: "2026-10-01", until: "2026-10-07" });
    expect(url.searchParams.get("fields")).toContain("spend");
    expect(url.searchParams.get("fields")).toContain("actions");
    expect(url.search).not.toContain(TOKEN);
  });

  it("supports adset level and returns the adset identity", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res({ data: [row({ adset_id: "9", adset_name: "Lookalike" })] }));
    const rows = await make(fetchImpl).getInsights({ since: "2026-10-01", until: "2026-10-01", level: "adset" });
    expect(new URL(String(fetchImpl.mock.calls[0][0])).searchParams.get("level")).toBe("adset");
    expect(rows[0]).toMatchObject({ adsetId: "9", adsetName: "Lookalike" });
  });

  it("counts the aggregate lead action once, falling back to other lead actions", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      res({
        data: [
          row({ actions: [{ action_type: "lead", value: "5" }, { action_type: "onsite_conversion.lead_grouped", value: "5" }] }),
          row({ campaign_id: "222", actions: [{ action_type: "onsite_conversion.lead_grouped", value: "3" }, { action_type: "link_click", value: "40" }] }),
          row({ campaign_id: "333", actions: undefined }),
        ],
      }),
    );
    const rows = await make(fetchImpl).getInsights({ since: "2026-10-01", until: "2026-10-01" });
    expect(rows.map((r) => r.leads)).toEqual([5, 3, 0]);
  });

  it("uses the default currency when the row has none, and fails when neither exists", async () => {
    const noCurrency = row({ account_currency: undefined });
    const ok = make(vi.fn().mockResolvedValue(res({ data: [noCurrency] })), { defaultCurrency: "USD" });
    expect((await ok.getInsights({ since: "2026-10-01", until: "2026-10-01" }))[0]).toMatchObject({ currency: "USD", spendMinor: BigInt(123456) });
    const bad = make(vi.fn().mockResolvedValue(res({ data: [noCurrency] })));
    await expect(bad.getInsights({ since: "2026-10-01", until: "2026-10-01" })).rejects.toMatchObject({ kind: "schema" });
  });

  it("follows paging.next on the same host, drops any token from the next URL and re-sends the header", async () => {
    const next = `https://graph.facebook.com/${DEFAULT_GRAPH_VERSION}/act_1234567890/insights?after=abc&access_token=LEAKED`;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res({ data: [row()], paging: { next } }))
      .mockResolvedValueOnce(res({ data: [row({ campaign_id: "222" })] }));
    const rows = await make(fetchImpl).getInsights({ since: "2026-10-01", until: "2026-10-01" });
    expect(rows).toHaveLength(2);
    const second = fetchImpl.mock.calls[1];
    expect(String(second[0])).toContain("after=abc");
    expect(String(second[0])).not.toContain("access_token");
    expect(second[1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("refuses a next link to another host, a non-https link, or another path", async () => {
    for (const next of [
      "https://evil.example.com/v23.0/act_1234567890/insights?after=1",
      `http://graph.facebook.com/${DEFAULT_GRAPH_VERSION}/act_1234567890/insights?after=1`,
      `https://graph.facebook.com/${DEFAULT_GRAPH_VERSION}/act_999/insights?after=1`,
      "not a url",
    ]) {
      const fetchImpl = vi.fn().mockResolvedValue(res({ data: [row()], paging: { next } }));
      await expect(make(fetchImpl).getInsights({ since: "2026-10-01", until: "2026-10-01" })).rejects.toMatchObject({ kind: "paging" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("stops at the page cap and at a repeated cursor instead of looping", async () => {
    const next = `https://graph.facebook.com/${DEFAULT_GRAPH_VERSION}/act_1234567890/insights?after=same`;
    const loop = vi.fn().mockImplementation(async () => res({ data: [row()], paging: { next } }));
    await expect(make(loop).getInsights({ since: "2026-10-01", until: "2026-10-01" })).rejects.toMatchObject({ kind: "paging" });
    expect(loop.mock.calls.length).toBeLessThanOrEqual(2);

    let n = 0;
    const endless = vi.fn().mockImplementation(async () => res({ data: [row()], paging: { next: `${next.split("after=")[0]}after=${++n}` } }));
    await expect(make(endless, { maxPages: 3 }).getInsights({ since: "2026-10-01", until: "2026-10-01" })).rejects.toMatchObject({ kind: "paging" });
    expect(endless).toHaveBeenCalledTimes(3);
  });

  it("treats a schema change as a typed error, never as zeros", async () => {
    for (const body of [{ nope: 1 }, { data: [row({ spend: "abc" })] }, { data: [row({ date_start: "yesterday" })] }, "not json"]) {
      const err = await make(vi.fn().mockResolvedValue(res(body))).getInsights({ since: "2026-10-01", until: "2026-10-01" }).catch((e) => e);
      expect(err).toBeInstanceOf(MetaAdsError);
      expect(err.kind).toBe("schema");
    }
  });
});

describe("errors", () => {
  const call = async (r: Response): Promise<MetaAdsError> => {
    try {
      await make(vi.fn().mockResolvedValue(r)).getInsights({ since: "2026-10-01", until: "2026-10-01" });
    } catch (e) {
      return e as MetaAdsError;
    }
    throw new Error("expected the call to fail");
  };

  it("maps HTTP 429 and Graph rate-limit codes to rate_limit and does not retry", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res({ error: { code: 4, message: "x" } }, 400));
    const e1 = await make(fetchImpl).getInsights({ since: "2026-10-01", until: "2026-10-01" }).catch((e) => e);
    expect(e1.kind).toBe("rate_limit");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await call(res({}, 429, { "Retry-After": "30" }))).retryAfterMs).toBe(30000);
    for (const code of [4, 17, 32, 613, 80000, 80004, 80014]) {
      expect((await call(res({ error: { code } }, 400))).kind).toBe("rate_limit");
    }
  });

  it("maps token and permission problems to auth", async () => {
    for (const [status, code] of [[401, undefined], [400, 190], [403, 200], [400, 10]] as const) {
      expect((await call(res({ error: { code } }, status))).kind).toBe("auth");
    }
  });

  it("retries a transient 5xx once, then reports it", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(res({ error: { code: 2 } }, 500)).mockResolvedValueOnce(res({ data: [row()] }));
    expect(await make(fetchImpl).getInsights({ since: "2026-10-01", until: "2026-10-01" })).toHaveLength(1);
    const always = vi.fn().mockImplementation(async () => res({}, 503));
    const err = await make(always).getInsights({ since: "2026-10-01", until: "2026-10-01" }).catch((e) => e);
    expect(err.kind).toBe("transient");
    expect(always).toHaveBeenCalledTimes(2);
  });

  it("maps an aborted or failed request to timeout/transient without leaking the token", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    const e1 = await make(vi.fn().mockRejectedValue(abort), { timeoutMs: 5 }).getAccount().catch((e) => e);
    expect(e1.kind).toBe("timeout");
    const e2 = await make(vi.fn().mockRejectedValue(new Error(`boom ${TOKEN}`))).getAccount().catch((e) => e);
    expect(e2.kind).toBe("transient");
    expect(String(e2.message)).not.toContain(TOKEN);
  });

  it("never includes the response body or the token in error messages", async () => {
    const err = await call(res({ error: { code: 100, message: `secret body ${TOKEN}`, type: "OAuthException" } }, 400));
    expect(err.kind).toBe("http");
    expect(err.message).not.toContain("secret body");
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).toContain("100");
  });
});

describe("time limits", () => {
  const win = { since: "2026-10-01", until: "2026-10-01" };

  it("caps an in-request retry sleep at 5 seconds even when Retry-After says an hour", async () => {
    const sleeps: number[] = [];
    const fetchImpl = vi.fn().mockResolvedValueOnce(res({}, 503, { "Retry-After": "3600" })).mockResolvedValueOnce(res({ data: [row()] }));
    const client = createMetaAdsClient({ accountId: "1234567890", accessToken: TOKEN, fetch: fetchImpl as unknown as typeof fetch, sleep: async (ms) => void sleeps.push(ms) });
    await client.getInsights(win);
    expect(sleeps).toEqual([5000]);
  });

  it("refuses to start a request after the deadline and says so with a typed error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res({ data: [row()] }));
    const err = await make(fetchImpl, { now: () => 2000 }).getInsights({ ...win, deadlineMs: 1000 }).catch((e) => e);
    expect(err).toMatchObject({ kind: "deadline" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stops between pages once the deadline passes", async () => {
    let clock = 0;
    let n = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      clock += 600;
      return res({ data: [row()], paging: { next: `https://graph.facebook.com/${DEFAULT_GRAPH_VERSION}/act_1234567890/insights?after=${++n}` } });
    });
    const err = await make(fetchImpl, { now: () => clock }).getInsights({ ...win, deadlineMs: 1000 }).catch((e) => e);
    expect(err).toMatchObject({ kind: "deadline" });
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("bounds each request's abort timer by the time left to the deadline", async () => {
    const seen: number[] = [];
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      seen.push(ms);
      return new AbortController().signal;
    });
    await make(vi.fn().mockResolvedValue(res({ data: [row()] })), { now: () => 0, timeoutMs: 10_000 }).getInsights({ ...win, deadlineMs: 3000 });
    spy.mockRestore();
    expect(seen[0]).toBeLessThanOrEqual(3000);
  });

  it("defaults to at most 10 pages", async () => {
    let n = 0;
    const endless = vi.fn().mockImplementation(async () => res({ data: [row()], paging: { next: `https://graph.facebook.com/${DEFAULT_GRAPH_VERSION}/act_1234567890/insights?after=${++n}` } }));
    await expect(make(endless).getInsights(win)).rejects.toMatchObject({ kind: "paging" });
    expect(endless).toHaveBeenCalledTimes(10);
  });
});

describe("malformed rows", () => {
  it("skips a row with no campaign id, reports the count, and keeps the rest of the window", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res({ data: [row(), { ...row(), campaign_id: undefined }, { spend: "1" }, row({ campaign_id: "222" })] }));
    let skipped = 0;
    const rows = await make(fetchImpl).getInsights({ since: "2026-10-01", until: "2026-10-01", onSkip: (n) => (skipped += n) });
    expect(rows.map((r) => r.campaignId)).toEqual(["111", "222"]);
    expect(skipped).toBe(2);
  });
});
