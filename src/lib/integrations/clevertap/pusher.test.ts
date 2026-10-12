import { describe, expect, it, vi } from "vitest";
import { pushCustomerSignals, type PusherDeps } from "./pusher";
import type { CustomerSignals } from "./signals";

const signals: CustomerSignals = { lifecycleStage: "KYC", kycApproved: false, funded: false, nbaProgramme: "Complete KYC", priority: "High", acceptance: {}, salesPaused: false };

function deps(over: Partial<PusherDeps> = {}) {
  const sent: unknown[] = [];
  const ledger = new Map<string, string>();
  const d: PusherDeps = {
    region: "in1",
    mode: "live",
    load: async () => ({ identity: "riya@example.com", signals }),
    lastHash: async (id) => ledger.get(id) ?? null,
    send: async (payload) => { sent.push(payload); return { ok: true, status: 200 }; },
    record: async (id, hash) => { ledger.set(id, hash); },
    recordError: async () => {},
    ...over,
  };
  return { d, sent, ledger };
}

describe("pushCustomerSignals", () => {
  it("pushes once and records the hash", async () => {
    const { d, sent, ledger } = deps();
    expect(await pushCustomerSignals("c1", d)).toEqual({ status: "pushed" });
    expect(sent).toHaveLength(1);
    expect(ledger.has("c1")).toBe(true);
  });
  it("does not call CleverTap again for unchanged data", async () => {
    const { d, sent } = deps();
    await pushCustomerSignals("c1", d);
    expect(await pushCustomerSignals("c1", d)).toEqual({ status: "unchanged" });
    expect(sent).toHaveLength(1);
  });
  it("never sends outside India and says why", async () => {
    const { d, sent } = deps({ region: "eu1" });
    const res = await pushCustomerSignals("c1", d);
    expect(res).toMatchObject({ status: "skipped", reason: expect.stringMatching(/India/) });
    expect(sent).toHaveLength(0);
  });
  it("sends nothing in dry_run or mock mode", async () => {
    for (const mode of ["dry_run", "mock"] as const) {
      const { d, sent } = deps({ mode });
      expect(await pushCustomerSignals("c1", d)).toMatchObject({ status: "skipped" });
      expect(sent).toHaveLength(0);
    }
  });
  it("skips customers with no email or phone", async () => {
    const { d } = deps({ load: async () => ({ identity: null, signals }) });
    expect(await pushCustomerSignals("c1", d)).toMatchObject({ status: "skipped", reason: expect.stringMatching(/identity/i) });
  });
  it("asks for a retry on 429 and does not record success", async () => {
    const { d, ledger } = deps({ send: async () => ({ ok: false, status: 429 }) });
    expect(await pushCustomerSignals("c1", d)).toMatchObject({ status: "retry" });
    expect(ledger.size).toBe(0);
  });
  it("marks 5xx and network errors as failed without throwing or recording success", async () => {
    const { d, ledger } = deps({ send: async () => ({ ok: false, status: 503 }) });
    expect(await pushCustomerSignals("c1", d)).toMatchObject({ status: "failed" });
    const boom = deps({ send: async () => { throw new Error("ECONNRESET"); } });
    expect(await pushCustomerSignals("c1", boom.d)).toMatchObject({ status: "failed" });
    expect(ledger.size).toBe(0);
  });

  describe("never throws out of the function", () => {
    it("load throwing -> failed", async () => {
      const { d } = deps({ load: async () => { throw new Error("db down"); } });
      expect(await pushCustomerSignals("c1", d)).toEqual({ status: "failed", reason: "db down" });
    });
    it("lastHash throwing -> failed and nothing sent", async () => {
      const { d, sent } = deps({ lastHash: async () => { throw new Error("ledger read"); } });
      expect(await pushCustomerSignals("c1", d)).toMatchObject({ status: "failed", reason: "ledger read" });
      expect(sent).toHaveLength(0);
    });
    it("recordError throwing is swallowed (HTTP failure still reports failed)", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { d } = deps({ send: async () => ({ ok: false, status: 500 }), recordError: async () => { throw new Error("ledger write"); } });
      expect(await pushCustomerSignals("c1", d)).toEqual({ status: "failed", reason: "CleverTap responded 500" });
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
    it("recordError throwing is swallowed (network failure still reports failed)", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { d } = deps({ send: async () => { throw new Error("boom"); }, recordError: async () => { throw new Error("ledger write"); } });
      expect(await pushCustomerSignals("c1", d)).toEqual({ status: "failed", reason: "boom" });
      spy.mockRestore();
    });
    it("record throwing AFTER a successful send is still pushed, with a console.error", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { d, sent } = deps({ record: async () => { throw new Error("ledger write"); } });
      expect(await pushCustomerSignals("c1", d)).toEqual({ status: "pushed" });
      expect(sent).toHaveLength(1);
      expect(spy).toHaveBeenCalledWith(expect.stringMatching(/ledger/i), expect.anything());
      spy.mockRestore();
    });
  });
});
