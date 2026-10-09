import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ReferralApiError,
  MAX_BODY_BYTES,
  assertSafeBaseUrl,
  createReferralApiClient,
} from "./referral-api";

type Call = { url: string; init: RequestInit };

function envelope(data: unknown, code = 2000) {
  return { code, msg: "ok", data, error: null };
}

function fakeFetch(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return responder(url, init ?? {});
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const base = "https://referral.example.test";
const mk = (f: typeof fetch, extra: Partial<Parameters<typeof createReferralApiClient>[0]> = {}) =>
  createReferralApiClient({ baseUrl: base, token: "secret-token-value", fetch: f, ...extra });

const summaryRaw = {
  referrers: { total: 10, active: 6, pending: 2 },
  referees: { total: 40, active: 20 },
  earnings: { lastMonth: "42.10" },
  monthly: [{ period: "2026-09", earnings: 42.1, referees: 3 }],
  topReferrers: [],
};

const referrerRow = {
  id: 7,
  fullName: "Asha Verma",
  referrerType: "EXTERNAL",
  status: "ACTIVE",
  kycStatus: "Accepted",
  referralCode: "REF_AB12CD",
  mobile: "+919812345678",
  pan: "ABCDE1234F",
  bankAccount: "123456789012",
  refereeCount: 12,
  earningsTotal: "1520.50",
  enrolledAt: "2026-08-01T10:00:00Z",
};

afterEach(() => vi.useRealTimers());

describe("assertSafeBaseUrl", () => {
  it("accepts https and strips a trailing slash", () => {
    expect(assertSafeBaseUrl("https://a.example.test/")).toBe("https://a.example.test");
    expect(assertSafeBaseUrl("https://a.example.test/prefix/")).toBe("https://a.example.test/prefix");
  });
  it("accepts plain http only for loopback hosts", () => {
    expect(assertSafeBaseUrl("http://localhost:4010")).toBe("http://localhost:4010");
    expect(assertSafeBaseUrl("http://127.0.0.1:4010")).toBe("http://127.0.0.1:4010");
    expect(() => assertSafeBaseUrl("http://referral.example.test")).toThrow(ReferralApiError);
  });
  it("refuses even loopback http in production", () => {
    const prev = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => assertSafeBaseUrl("http://localhost:4010")).toThrow(ReferralApiError);
      expect(assertSafeBaseUrl("https://a.example.test")).toBe("https://a.example.test");
    } finally {
      vi.unstubAllEnvs();
      expect(process.env.NODE_ENV).toBe(prev);
    }
  });
  it("rejects junk, other schemes and embedded credentials", () => {
    for (const bad of ["", "not a url", "ftp://x.example.test", "https://user:pw@x.example.test", "javascript:alert(1)"]) {
      expect(() => assertSafeBaseUrl(bad), bad).toThrow(ReferralApiError);
    }
  });
});

describe("request shape", () => {
  it("only ever issues GET with a bearer token and no body", async () => {
    const { fn, calls } = fakeFetch(() => json(envelope({ items: [], total: 0, limit: 25, offset: 0 })));
    const c = mk(fn);
    await c.listReferrers({});
    await c.listReferees({});
    await c.listWithdrawals({});
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.init.method).toBe("GET");
      expect(call.init.body).toBeUndefined();
      expect((call.init.headers as Record<string, string>).authorization).toBe("Bearer secret-token-value");
      expect(call.init.redirect).toBe("error");
    }
  });
  it("exposes no write methods", () => {
    const c = mk(fakeFetch(() => json({})).fn) as unknown as Record<string, unknown>;
    for (const name of Object.keys(c)) expect(name).not.toMatch(/^(create|update|delete|post|put|patch|approve|reject|send)/i);
  });
  it("builds filters and encodes the query, skipping empty values", async () => {
    const { fn, calls } = fakeFetch(() => json(envelope({ items: [], total: 0, limit: 10, offset: 20 })));
    await mk(fn).listReferrers({ limit: 10, offset: 20, status: "ACTIVE", kycStatus: "Pending Verification", search: "a&b=c", sort: undefined });
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/referrers");
    expect(u.searchParams.get("limit")).toBe("10");
    expect(u.searchParams.get("offset")).toBe("20");
    expect(u.searchParams.get("status")).toBe("ACTIVE");
    expect(u.searchParams.get("kycStatus")).toBe("Pending Verification");
    expect(u.searchParams.get("q")).toBe("a&b=c");
    expect(u.searchParams.has("sort")).toBe(false);
  });
  it("clamps silly page sizes and encodes path ids", async () => {
    const { fn, calls } = fakeFetch((url) =>
      url.includes("/referrers/") ? json(envelope(referrerRow)) : json(envelope({ items: [], total: 0, limit: 100, offset: 0 })),
    );
    const c = mk(fn);
    await c.listReferrers({ limit: 100000, offset: -5 });
    expect(new URL(calls[0].url).searchParams.get("limit")).toBe("100");
    expect(new URL(calls[0].url).searchParams.get("offset")).toBe("0");
    await c.getReferrer("ab-7_X");
    expect(calls[1].url).toContain("/referrers/ab-7_X");
  });
  it.each(["..", "%2e%2e", "", "a/b", "a b", "x".repeat(65), "a?x=1"])("refuses the referrer id %j without any request", async (bad) => {
    const { fn, calls } = fakeFetch(() => json(envelope(referrerRow)));
    const err = await mk(fn).getReferrer(bad).catch((e) => e);
    expect(err).toBeInstanceOf(ReferralApiError);
    expect(err.kind).toBe("bad_request");
    expect(calls).toHaveLength(0);
  });
  it("respects a base URL path prefix", async () => {
    const { fn, calls } = fakeFetch(() => json(envelope(summaryRaw)));
    await mk(fn, { baseUrl: `${base}/gw/` }).getSummary();
    expect(calls[0].url).toBe(`${base}/gw/reports/summary`);
  });
  it("uses paths relative to the base URL unless a path prefix setting is given", async () => {
    const { fn, calls } = fakeFetch(() => json(envelope(summaryRaw)));
    await mk(fn).getSummary();
    expect(new URL(calls[0].url).pathname).toBe("/reports/summary");
    await mk(fn, { pathPrefix: "/v9/admin/" }).getSummary();
    expect(new URL(calls[1].url).pathname).toBe("/v9/admin/reports/summary");
  });
});

describe("response parsing", () => {
  it("parses a referrer page, coercing money, stringifying ids and dropping PAN and bank fields", async () => {
    const { fn } = fakeFetch(() => json(envelope({ items: [referrerRow], total: 1, limit: 25, offset: 0 })));
    const page = await mk(fn).listReferrers({});
    expect(page.total).toBe(1);
    const r = page.items[0];
    expect(r.id).toBe("7");
    expect(r.earningsTotal).toBe(1520.5);
    expect(r.referralCode).toBe("REF_AB12CD");
    expect(JSON.stringify(page)).not.toContain("ABCDE1234F");
    expect(JSON.stringify(page)).not.toContain("123456789012");
    expect("pan" in r).toBe(false);
  });
  it("tolerates unknown extra fields and unknown statuses, and keeps genuinely optional values as null (never 0)", async () => {
    const { fn } = fakeFetch(() =>
      json(envelope({ items: [{ id: "x1", fullName: "B", status: "SOMETHING_NEW", earningsTotal: 0, refereeCount: 0, futureField: { a: 1 } }], total: 1, limit: 25, offset: 0 })),
    );
    const page = await mk(fn).listReferrers({});
    expect(page.items[0].status).toBe("SOMETHING_NEW");
    expect(page.items[0].referralCode).toBeNull();
    expect(page.items[0].enrolledAt).toBeNull();
  });
  it("reports an unknown total as null instead of inventing one from the page", async () => {
    const { fn } = fakeFetch(() => json(envelope({ items: [referrerRow], limit: 25, offset: 0 })));
    expect((await mk(fn).listReferrers({})).total).toBeNull();
  });
  it("parses the summary and keeps optional counts null when absent", async () => {
    const { fn } = fakeFetch(() => json(envelope({ ...summaryRaw, referrers: { total: 10 } })));
    const s = await mk(fn).getSummary();
    expect(s.referrers).toMatchObject({ total: 10, active: null, pending: null, suspended: null });
    expect(s.earnings.lastMonth).toBe(42.1);
    expect(s.monthly).toHaveLength(1);
  });
  const empties: [string, unknown][] = [
    ["an empty summary object", {}],
    ["a summary with a renamed anchor field", { ...summaryRaw, earnings: { lastMonthTotal: 5 } }],
    ["a summary missing referrers.total", { ...summaryRaw, referrers: { active: 1 } }],
    ["a summary missing monthly", { ...summaryRaw, monthly: undefined }],
    ["a summary missing topReferrers", { ...summaryRaw, topReferrers: undefined }],
    ["the wrong endpoint shape (a list)", { items: [], total: 0 }],
  ];
  it.each(empties)("rejects %s as invalid_response instead of showing zeros", async (_n, data) => {
    const { fn } = fakeFetch(() => json(envelope(data)));
    const err = await mk(fn).getSummary().catch((e) => e);
    expect(err).toBeInstanceOf(ReferralApiError);
    expect(err.kind).toBe("invalid_response");
  });
  it("rejects referrer rows without earningsTotal or refereeCount, and payouts without amount", async () => {
    const noMoney = fakeFetch(() => json(envelope({ items: [{ id: 1, fullName: "A", status: "X", refereeCount: 1 }], total: 1 })));
    expect((await mk(noMoney.fn).listReferrers({}).catch((e) => e)).kind).toBe("invalid_response");
    const noCount = fakeFetch(() => json(envelope({ items: [{ id: 1, fullName: "A", status: "X", earningsTotal: 1 }], total: 1 })));
    expect((await mk(noCount.fn).listReferrers({}).catch((e) => e)).kind).toBe("invalid_response");
    const noAmount = fakeFetch(() => json(envelope({ items: [{ id: 1, status: "X" }], total: 1 })));
    expect((await mk(noAmount.fn).listWithdrawals({}).catch((e) => e)).kind).toBe("invalid_response");
    const noItems = fakeFetch(() => json(envelope({})));
    expect((await mk(noItems.fn).listReferees({}).catch((e) => e)).kind).toBe("invalid_response");
  });
  it("parses withdrawals without any bank field", async () => {
    const w = { id: 3, withdrawalRef: "WD-1", referrerId: 7, referrerName: "Asha", status: "REQUESTED", amount: "500.00", requestedAt: "2026-10-01T00:00:00Z", bankSnapshot: { account: "999" } };
    const { fn } = fakeFetch(() => json(envelope({ items: [w], total: 1, limit: 25, offset: 0, summary: { byStatus: { REQUESTED: { count: 1, amount: "500.00" } } } })));
    const page = await mk(fn).listWithdrawals({});
    expect(page.items[0].amount).toBe(500);
    expect(JSON.stringify(page)).not.toContain("999");
    expect(page.summary?.byStatus.REQUESTED).toEqual({ count: 1, amount: 500 });
  });
  it("parses a referrer detail with wallet and activity", async () => {
    const { fn } = fakeFetch(() =>
      json(envelope({ ...referrerRow, clientCode: "C100", wallet: { available: "100.00", onHold: 20 }, activity: [{ at: "2026-09-01T00:00:00Z", action: "STATUS_CHANGED", label: "Activated" }] })),
    );
    const d = await mk(fn).getReferrer("7");
    expect(d.wallet).toEqual({ available: 100, onHold: 20 });
    expect(d.payouts).toBeNull();
    expect(d.activity[0].label).toBe("Activated");
    expect(d.clientCode).toBe("C100");
  });
});

describe("error mapping", () => {
  const cases: [number, string][] = [[401, "unauthorized"], [403, "forbidden"], [404, "not_found"], [422, "bad_request"], [429, "rate_limited"], [500, "server"], [502, "server"], [503, "server"]];
  it.each(cases)("maps HTTP %i to %s", async (status, kind) => {
    const { fn } = fakeFetch(() => json({ code: 9, msg: "internal stack trace with secret-token-value", data: null, error: "boom" }, status));
    const err = await mk(fn).getSummary().catch((e) => e);
    expect(err).toBeInstanceOf(ReferralApiError);
    expect(err.kind).toBe(kind);
    expect(err.status).toBe(status);
    expect(err.message).not.toContain("boom");
    expect(err.message).not.toContain("secret-token-value");
  });
  it("carries Retry-After on 429", async () => {
    const { fn } = fakeFetch(() => json({}, 429, { "retry-after": "12" }));
    const err = await mk(fn).getSummary().catch((e) => e);
    expect(err.retryAfterSeconds).toBe(12);
  });
  it("maps a plain 400 to bad_request", async () => {
    const { fn } = fakeFetch(() => json({ data: null }, 400));
    expect((await mk(fn).getSummary().catch((e) => e)).kind).toBe("bad_request");
  });
  it("maps a non-success envelope code on a 200 response generically", async () => {
    const bad = fakeFetch(() => json({ code: 5000, data: null }, 200));
    expect((await mk(bad.fn).getSummary().catch((e) => e)).kind).toBe("server");
    const other = fakeFetch(() => json({ code: 4100, data: null }, 200));
    expect((await mk(other.fn).getSummary().catch((e) => e)).kind).toBe("bad_request");
  });
  it("treats an absent envelope code or any 2xx-range code as success", async () => {
    for (const code of [undefined, 200, 201, 2000, 2010]) {
      const { fn } = fakeFetch(() => json({ ...(code === undefined ? {} : { code }), data: summaryRaw }));
      expect((await mk(fn).getSummary()).referrers.total).toBe(10);
    }
  });
  it("maps a network failure to network", async () => {
    const { fn } = fakeFetch(() => Promise.reject(new TypeError("fetch failed: ECONNREFUSED 10.0.0.5")));
    const err = await mk(fn).getSummary().catch((e) => e);
    expect(err.kind).toBe("network");
    expect(err.message).not.toContain("10.0.0.5");
  });
  it("times out a hung request", async () => {
    vi.useFakeTimers();
    const { fn } = fakeFetch((_u, init) => new Promise<Response>((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))));
    const p = mk(fn, { timeoutMs: 500 }).getSummary().catch((e) => e);
    await vi.advanceTimersByTimeAsync(600);
    const err = await p;
    expect(err.kind).toBe("timeout");
  });
  it("times out when the body stalls after the headers arrived", async () => {
    vi.useFakeTimers();
    const stalled = new ReadableStream<Uint8Array>({ start() {} });
    const { fn } = fakeFetch(() => new Response(stalled, { status: 200, headers: { "content-type": "application/json" } }));
    const p = mk(fn, { timeoutMs: 500 }).getSummary().catch((e) => e);
    await vi.advanceTimersByTimeAsync(700);
    expect((await p).kind).toBe("timeout");
  });
  it("rejects a body larger than the cap, by content-length and by actual size", async () => {
    const huge = "x".repeat(MAX_BODY_BYTES + 10);
    const declared = fakeFetch(() => new Response("{}", { status: 200, headers: { "content-length": String(MAX_BODY_BYTES + 1) } }));
    expect((await mk(declared.fn).getSummary().catch((e) => e)).kind).toBe("invalid_response");
    const actual = fakeFetch(() => new Response(JSON.stringify({ code: 2000, data: { pad: huge } }), { status: 200 }));
    expect((await mk(actual.fn).getSummary().catch((e) => e)).kind).toBe("invalid_response");
  });
  it("flags schema drift as invalid_response without leaking the body", async () => {
    const { fn } = fakeFetch(() => json(envelope({ items: [{ id: null, fullName: 5, secretLooking: "tok_live_abc" }], total: "many" })));
    const err = await mk(fn).listReferrers({}).catch((e) => e);
    expect(err.kind).toBe("invalid_response");
    expect(err.message).not.toContain("tok_live_abc");
  });
  it("flags a non-JSON 200 as invalid_response", async () => {
    const { fn } = fakeFetch(() => new Response("<html>gateway</html>", { status: 200 }));
    expect((await mk(fn).getSummary().catch((e) => e)).kind).toBe("invalid_response");
  });
  it("never logs the token or bodies", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { fn } = fakeFetch(() => json({ code: 5000, data: null, error: "boom secret-token-value" }, 500));
    await mk(fn).getSummary().catch(() => {});
    for (const s of spies) {
      expect(JSON.stringify(s.mock.calls)).not.toContain("secret-token-value");
      s.mockRestore();
    }
  });
});

describe("ping", () => {
  it("returns ok without throwing", async () => {
    const { fn } = fakeFetch(() => json(envelope(summaryRaw)));
    expect(await mk(fn).ping()).toEqual({ ok: true });
  });
  it("does not count an empty or wrong-shaped answer as a successful connection", async () => {
    for (const data of [{}, { referrers: {}, referees: {}, earnings: {} }, { items: [] }]) {
      const { fn } = fakeFetch(() => json(envelope(data)));
      const r = await mk(fn).ping();
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/shape/i);
    }
  });
  it("returns a short generic failure message", async () => {
    const { fn } = fakeFetch(() => json({}, 403));
    const r = await mk(fn).ping();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/permission/i);
  });
});
