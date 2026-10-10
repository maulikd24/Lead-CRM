import { describe, expect, it, vi } from "vitest";
import { errorCopy, loadNative, runWithConnection } from "./load";
import { ReferralApiError, type ReferralApiPort } from "./referral-api";

describe("runWithConnection", () => {
  it("returns not_connected without calling anything", async () => {
    const fn = vi.fn();
    expect(await runWithConnection({ state: "not_connected" }, fn)).toEqual({ status: "not_connected" });
    expect(fn).not.toHaveBeenCalled();
  });
  it("runs against the mock port and marks the data as sample", async () => {
    const r = await runWithConnection({ state: "mock" }, (api: ReferralApiPort) => api.getSummary());
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.sample).toBe(true);
      expect(r.data.referrers.total).toBeGreaterThan(0);
    }
  });
  it("runs against a live client built from the connection, not marked as sample", async () => {
    const body = { code: 2000, data: { referrers: { total: 3 }, referees: { total: 1 }, earnings: { lastMonth: 0 }, monthly: [], topReferrers: [] } };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
    const r = await runWithConnection({ state: "live", baseUrl: "https://a.example.test", token: "t", pathPrefix: "/p", contractVerified: false }, (api) => api.getSummary(), { fetch: fetchImpl });
    expect(r.status === "ok" && r.sample).toBe(false);
    expect(r.status === "ok" && r.contractVerified).toBe(false);
    expect((fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]).toBe("https://a.example.test/p/reports/summary");
    expect(r.status === "ok" && r.data.referrers.total).toBe(3);
  });
  it("turns typed errors into an error result carrying only the kind", async () => {
    const r = await runWithConnection({ state: "mock" }, async () => {
      throw new ReferralApiError("forbidden", 403);
    });
    expect(r).toEqual({ status: "error", kind: "forbidden" });
  });
  it("a live connection answering with an empty body becomes an invalid_response error, not zeros", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 2000, data: {} }), { status: 200 })) as unknown as typeof fetch;
    const r = await runWithConnection({ state: "live", baseUrl: "https://a.example.test", token: "t", pathPrefix: "", contractVerified: true }, (api) => api.getSummary(), { fetch: fetchImpl });
    expect(r).toEqual({ status: "error", kind: "invalid_response" });
  });
  it("treats unexpected throws as a generic server error without leaking the message", async () => {
    const r = await runWithConnection({ state: "mock" }, async () => {
      throw new Error("db password is hunter2");
    });
    expect(r).toEqual({ status: "error", kind: "server" });
  });
});

describe("errorCopy", () => {
  it("has plain-language copy for every kind and never exposes internals", () => {
    const kinds = ["not_configured", "unauthorized", "forbidden", "not_found", "bad_request", "rate_limited", "server", "timeout", "network", "invalid_response"] as const;
    for (const k of kinds) {
      const c = errorCopy(k);
      expect(c.title.length).toBeGreaterThan(3);
      expect(c.description.length).toBeGreaterThan(10);
      expect(`${c.title} ${c.description}`).not.toMatch(/stack|exception|prisma|sql|token|http \d|500|undefined/i);
    }
  });
  it("describes a shape problem in plain words", () => {
    expect(errorCopy("invalid_response").title).toBe("The partner service returned data in an unexpected shape");
  });
  it("tells admins to check Settings for credential problems", () => {
    expect(errorCopy("unauthorized").description).toMatch(/Settings/);
  });
});

describe("loadNative", () => {
  const access = { source: "native" as const, scope: { kind: "ids" as const, ids: ["p1"] }, role: "PARTNER" as const, session: {} as never };
  it("runs against a port built for the caller's scope and reports a trusted native result", async () => {
    const port = { marker: 1 } as never;
    const createPort = vi.fn(() => port);
    const r = await loadNative(access, async (p) => p, { createPort });
    expect(createPort).toHaveBeenCalledWith(access.scope);
    expect(r).toEqual({ status: "ok", data: port, sample: false, contractVerified: true, source: "native" });
  });
  it("folds a failure into an error result carrying only the kind", async () => {
    const r = await loadNative(access, async () => {
      throw new Error("select * from secrets");
    }, { createPort: () => ({}) as never });
    expect(r).toEqual({ status: "error", kind: "server" });
  });
  it("keeps a typed not_found", async () => {
    const r = await loadNative(access, async () => {
      throw new ReferralApiError("not_found");
    }, { createPort: () => ({}) as never });
    expect(r).toEqual({ status: "error", kind: "not_found" });
  });
});
