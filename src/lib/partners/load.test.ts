import { describe, expect, it, vi } from "vitest";
import { errorCopy, loadNative, loadSample } from "./load";
import { PartnerReadError, type SamplePartnerPort } from "./sample-port";

describe("loadSample", () => {
  it("runs against the made-up data and marks it as sample", async () => {
    const r = await loadSample((api: SamplePartnerPort) => api.getSummary(), { env: { NODE_ENV: "development" } });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.sample).toBe(true);
      expect(r.source).toBe("sample");
      expect(r.data.referrers.total).toBeGreaterThan(0);
    }
  });
  it("in production it is not connected, and calls nothing, unless PARTNER_ALLOW_SAMPLE=1", async () => {
    const fn = vi.fn();
    expect(await loadSample(fn, { env: { NODE_ENV: "production" } })).toEqual({ status: "not_connected" });
    expect(fn).not.toHaveBeenCalled();
    const r = await loadSample(async () => 1, { env: { NODE_ENV: "production", PARTNER_ALLOW_SAMPLE: "1" } });
    expect(r.status).toBe("ok");
  });
  it("turns typed errors into an error result carrying only the kind", async () => {
    const r = await loadSample(async () => {
      throw new PartnerReadError("not_found");
    }, { env: {} });
    expect(r).toEqual({ status: "error", kind: "not_found" });
  });
  it("treats unexpected throws as a generic server error without leaking the message", async () => {
    const r = await loadSample(async () => {
      throw new Error("db password is hunter2");
    }, { env: {} });
    expect(r).toEqual({ status: "error", kind: "server" });
  });
});

describe("errorCopy", () => {
  it("has plain-language copy for every kind and never exposes internals", () => {
    for (const k of ["not_configured", "not_found", "server"] as const) {
      const c = errorCopy(k);
      expect(c.title.length).toBeGreaterThan(3);
      expect(c.description.length).toBeGreaterThan(10);
      expect(`${c.title} ${c.description}`).not.toMatch(/stack|exception|prisma|sql|token|http \d|500|undefined|referral api/i);
    }
  });
});

describe("loadNative", () => {
  const access = { source: "native" as const, scope: { kind: "ids" as const, ids: ["p1"], detailIds: ["p1"] }, role: "PARTNER" as const, session: {} as never };
  it("runs against a port built for the caller's scope and reports a trusted native result", async () => {
    const port = { marker: 1 } as never;
    const createPort = vi.fn(() => port);
    const r = await loadNative(access, async (p) => p, { createPort });
    expect(createPort).toHaveBeenCalledWith(access.scope);
    expect(r).toEqual({ status: "ok", data: port, sample: false, source: "native" });
  });
  it("folds a failure into an error result carrying only the kind", async () => {
    const r = await loadNative(access, async () => {
      throw new Error("select * from secrets");
    }, { createPort: () => ({}) as never });
    expect(r).toEqual({ status: "error", kind: "server" });
  });
  it("keeps a typed not_found", async () => {
    const r = await loadNative(access, async () => {
      throw new PartnerReadError("not_found");
    }, { createPort: () => ({}) as never });
    expect(r).toEqual({ status: "error", kind: "not_found" });
  });
});
