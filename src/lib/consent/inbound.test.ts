import { describe, expect, it, vi } from "vitest";
import { applyInboundOptOut, type InboundDeps } from "./inbound";
import { createMemoryStore } from "./memory-store";
import { recordConsent } from "./ledger";
import { consentDecision } from "./decision";

const NOW = new Date("2026-10-09T10:00:00Z");

function setup(over: Partial<InboundDeps> = {}) {
  const store = createMemoryStore();
  const createTask = vi.fn(async (_t: Parameters<InboundDeps["createTask"]>[0]) => {});
  const deps: InboundDeps = {
    enforced: () => true,
    store,
    loadClient: async () => ({ assignedToId: "rm1", legacyMarketingConsentAt: null }),
    createTask,
    now: () => NOW,
    ...over,
  };
  return { store, createTask, deps };
}

describe("applyInboundOptOut", () => {
  it("does nothing at all while the flag is off", async () => {
    const loadClient = vi.fn();
    const { deps, store, createTask } = setup({ enforced: () => false, loadClient });
    expect(await applyInboundOptOut({ clientId: "c1", text: "STOP", messageRef: "m1" }, deps)).toEqual({ applied: false, reason: "flag off" });
    expect(loadClient).not.toHaveBeenCalled();
    expect(await store.listForClient("c1")).toEqual([]);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("ignores ordinary messages", async () => {
    const { deps, store, createTask } = setup();
    expect(await applyInboundOptOut({ clientId: "c1", text: "please stop my SIP", messageRef: "m1" }, deps)).toEqual({ applied: false, reason: "no keyword" });
    expect(await store.listForClient("c1")).toEqual([]);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("records a WITHDRAWN marketing row for WhatsApp and asks the RM to review", async () => {
    const { deps, store, createTask } = setup();
    expect(await applyInboundOptOut({ clientId: "c1", text: "STOP", messageRef: "m1" }, deps)).toEqual({ applied: true, taskCreated: true });
    const rows = await store.listForClient("c1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: "MARKETING_COMMS", channel: "whatsapp", status: "WITHDRAWN", source: "WHATSAPP_KEYWORD", evidenceRef: "message:m1", capturedById: null });
    expect(JSON.stringify(rows[0])).not.toContain("STOP");
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask.mock.calls[0][0]).toMatchObject({ clientId: "c1", assignedToId: "rm1", source: "consent:optout" });
    expect(consentDecision(rows, "MARKETING_COMMS", "whatsapp", NOW).allowed).toBe(false);
    expect(consentDecision(rows, "MARKETING_COMMS", "email", NOW, { legacyMarketingConsentAt: new Date("2026-01-01") }).allowed).toBe(true);
  });

  it("works in Hindi", async () => {
    const { deps, store } = setup();
    expect(await applyInboundOptOut({ clientId: "c1", text: "बंद करो", messageRef: "m2" }, deps)).toMatchObject({ applied: true });
    expect(await store.listForClient("c1")).toHaveLength(1);
  });

  it("writes no task when nobody owns the customer, but still records the withdrawal", async () => {
    const { deps, store, createTask } = setup({ loadClient: async () => ({ assignedToId: null, legacyMarketingConsentAt: null }) });
    expect(await applyInboundOptOut({ clientId: "c1", text: "stop", messageRef: "m1" }, deps)).toEqual({ applied: true, taskCreated: false });
    expect(await store.listForClient("c1")).toHaveLength(1);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("does not stack rows when the customer already opted out", async () => {
    const { deps, store, createTask } = setup();
    await recordConsent(store, { clientId: "c1", purpose: "MARKETING_COMMS", channel: null, status: "WITHDRAWN", source: "API" }, new Date("2026-09-01T00:00:00Z"));
    expect(await applyInboundOptOut({ clientId: "c1", text: "stop", messageRef: "m3" }, deps)).toEqual({ applied: false, reason: "already withdrawn" });
    expect(await store.listForClient("c1")).toHaveLength(1);
    expect(createTask).not.toHaveBeenCalled();
  });

  it("has no way to send a reply: the deps expose no send function", () => {
    const { deps } = setup();
    expect(Object.keys(deps).sort()).toEqual(["createTask", "enforced", "loadClient", "now", "store"]);
  });
});
