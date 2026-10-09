import { describe, expect, it, vi } from "vitest";
import { errorCopy, runWithConnection } from "./load";
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
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 2000, data: { referrers: { total: 3 } } }), { status: 200 })) as unknown as typeof fetch;
    const r = await runWithConnection({ state: "live", baseUrl: "https://a.example.test", token: "t" }, (api) => api.getSummary(), { fetch: fetchImpl });
    expect(r.status === "ok" && r.sample).toBe(false);
    expect(r.status === "ok" && r.data.referrers.total).toBe(3);
  });
  it("turns typed errors into an error result carrying only the kind", async () => {
    const r = await runWithConnection({ state: "mock" }, async () => {
      throw new ReferralApiError("forbidden", 403);
    });
    expect(r).toEqual({ status: "error", kind: "forbidden" });
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
  it("tells admins to check Settings for credential problems", () => {
    expect(errorCopy("unauthorized").description).toMatch(/Settings/);
  });
});
