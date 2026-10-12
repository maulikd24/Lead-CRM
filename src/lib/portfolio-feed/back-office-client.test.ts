import { describe, expect, it, vi } from "vitest";

import { createHttpBackOfficeClient, parseBackOfficeConfig, pullCustomerEntry, type BackOfficeClient } from "./back-office-client";
import { mapCustomerEntry } from "./mapper";

const config = { baseUrl: "https://backoffice.example.test/api", token: "t0k" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("parseBackOfficeConfig", () => {
  it("is disabled unless the feed flag is on", () => {
    expect(parseBackOfficeConfig({ settings: { baseUrl: config.baseUrl }, credentials: { token: "t" }, flagOn: false })).toEqual({ ok: false, reason: "disabled" });
  });
  it("needs an https base URL and a token", () => {
    expect(parseBackOfficeConfig({ settings: { baseUrl: "http://x.example.test" }, credentials: { token: "t" }, flagOn: true })).toEqual({ ok: false, reason: "invalid_base_url" });
    expect(parseBackOfficeConfig({ settings: { baseUrl: config.baseUrl }, credentials: {}, flagOn: true })).toEqual({ ok: false, reason: "missing_token" });
    expect(parseBackOfficeConfig({ settings: {}, credentials: { token: "t" }, flagOn: true })).toEqual({ ok: false, reason: "invalid_base_url" });
  });
  it("accepts a valid config and trims the trailing slash", () => {
    expect(parseBackOfficeConfig({ settings: { baseUrl: "https://b.example.test/api/" }, credentials: { token: "t" }, flagOn: true })).toEqual({ ok: true, config: { baseUrl: "https://b.example.test/api", token: "t" } });
  });
});

describe("createHttpBackOfficeClient", () => {
  it("fetches holdings with a bearer token, an injected fetch and an abort signal", async () => {
    const fetchFn = vi.fn(async () => json({ holdings: [{ accountNumber: "A", productCode: "P", quantity: 1, asOfDate: "2026-10-08" }] }));
    const client = createHttpBackOfficeClient({ ...config, fetch: fetchFn as unknown as typeof fetch });
    const r = await client.getHoldings({ clientCode: "CL-1" });
    expect(r).toMatchObject({ ok: true, data: [{ accountNumber: "A" }] });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://backoffice.example.test/api/v1/customers/CL-1/holdings");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer t0k");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("passes the since filter for transactions", async () => {
    const fetchFn = vi.fn(async () => json({ transactions: [] }));
    const client = createHttpBackOfficeClient({ ...config, fetch: fetchFn as unknown as typeof fetch });
    await client.getTransactions({ clientCode: "CL-1" }, { since: new Date("2026-10-01T00:00:00Z") });
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toContain("since=2026-10-01T00%3A00%3A00.000Z");
  });
  it.each([
    [401, "unauthorized"],
    [404, "not_found"],
    [429, "rate_limited"],
    [500, "unavailable"],
  ])("maps HTTP %i to %s without exposing the body", async (status, reason) => {
    const client = createHttpBackOfficeClient({ ...config, fetch: (async () => json({ secret: "do-not-leak" }, status)) as typeof fetch });
    const r = await client.getHoldings({ clientCode: "CL-1" });
    expect(r).toEqual({ ok: false, reason });
  });
  it("maps a network error and an unreadable body", async () => {
    const down = createHttpBackOfficeClient({ ...config, fetch: (async () => { throw new Error("ECONNRESET"); }) as typeof fetch });
    expect(await down.getHoldings({ clientCode: "CL-1" })).toEqual({ ok: false, reason: "unavailable" });
    const bad = createHttpBackOfficeClient({ ...config, fetch: (async () => new Response("<html>", { status: 200 })) as typeof fetch });
    expect(await bad.getHoldings({ clientCode: "CL-1" })).toEqual({ ok: false, reason: "invalid_response" });
    const shape = createHttpBackOfficeClient({ ...config, fetch: (async () => json({ nope: 1 })) as typeof fetch });
    expect(await shape.getHoldings({ clientCode: "CL-1" })).toEqual({ ok: false, reason: "invalid_response" });
  });
  it("never follows redirects (a redirect could carry the bearer token elsewhere) and bounds the response size", async () => {
    const fetchFn = vi.fn(async () => json({ holdings: [] }));
    const client = createHttpBackOfficeClient({ ...config, fetch: fetchFn as unknown as typeof fetch });
    await client.getHoldings({ clientCode: "CL-1" });
    expect((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe("error");

    const huge = createHttpBackOfficeClient({ ...config, maxBytes: 100, fetch: (async () => new Response(JSON.stringify({ holdings: ["x".repeat(500)] }), { status: 200 })) as typeof fetch });
    expect(await huge.getHoldings({ clientCode: "CL-1" })).toEqual({ ok: false, reason: "invalid_response" });
    const declared = createHttpBackOfficeClient({ ...config, maxBytes: 100, fetch: (async () => new Response("{}", { status: 200, headers: { "content-length": "5000" } })) as typeof fetch });
    expect(await declared.getHoldings({ clientCode: "CL-1" })).toEqual({ ok: false, reason: "invalid_response" });
  });
  it("treats a redirect (which fetch rejects with redirect: error) as unavailable", async () => {
    const client = createHttpBackOfficeClient({ ...config, fetch: (async () => { throw new TypeError("redirect"); }) as typeof fetch });
    expect(await client.getHoldings({ clientCode: "CL-1" })).toEqual({ ok: false, reason: "unavailable" });
  });
  it("refuses to call without any customer reference", async () => {
    const fetchFn = vi.fn();
    const client = createHttpBackOfficeClient({ ...config, fetch: fetchFn as unknown as typeof fetch });
    expect(await client.getHoldings({})).toEqual({ ok: false, reason: "invalid_request" });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("pullCustomerEntry", () => {
  it("builds the same entry shape the push route accepts, so the pull model can replace it", async () => {
    const fake: BackOfficeClient = {
      getHoldings: async () => ({ ok: true, data: [{ accountNumber: "ACC-1", productCode: "SYN-1", quantity: 2, currentValue: 50, asOfDate: "2026-10-08", revision: 1 }] }),
      getTransactions: async () => ({ ok: true, data: [{ externalRef: "T-1", accountNumber: "ACC-1", type: "BUY", date: "2026-10-08T00:00:00Z", grossAmount: 50, revision: 1 }] }),
    };
    const r = await pullCustomerEntry(fake, { clientCode: "CL-1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(mapCustomerEntry(r.entry)).toMatchObject({ ok: true, holdings: [{ accountNumber: "ACC-1" }], transactions: [{ externalRef: "T-1" }] });
  });
  it("propagates a failure from either call", async () => {
    const fake: BackOfficeClient = { getHoldings: async () => ({ ok: true, data: [] }), getTransactions: async () => ({ ok: false, reason: "rate_limited" }) };
    expect(await pullCustomerEntry(fake, { clientCode: "CL-1" })).toEqual({ ok: false, reason: "rate_limited" });
  });
});
