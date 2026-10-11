import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const emitEvent = vi.fn(async (_input: unknown) => ({ status: "stored" }));
vi.mock("@/lib/events/emit-db", () => ({ emitEvent: (i: unknown) => emitEvent(i), emitEventInTx: vi.fn() }));

import { emitMemoryEvent, setMemoryEventSink, type MemoryEvent } from "./events";

const event: MemoryEvent = { type: "customer.memory.confirmed", occurredAt: new Date("2027-03-01T10:00:00Z"), clientId: "c1", itemId: "m1", class: "PREFERENCE", actorType: "RM", actorId: "u1", correlationId: null, causationId: null, dataClass: "PERSONAL" };

describe("memory events go through emit() (the audit-only sink is gone)", () => {
  beforeEach(() => { emitEvent.mockClear(); setMemoryEventSink(null); });
  afterEach(() => { delete process.env.CUSTOMER_EVENTS_ENABLED; setMemoryEventSink(null); });

  it("with the events flag on and no override, the transition is stored as a registered customer.memory.* event, without content", async () => {
    process.env.CUSTOMER_EVENTS_ENABLED = "1";
    await emitMemoryEvent(event);
    expect(emitEvent).toHaveBeenCalledTimes(1);
    const sent = emitEvent.mock.calls[0][0] as { type: string; clientId: string; metadata: Record<string, unknown> };
    expect(sent.type).toBe("customer.memory.confirmed");
    expect(sent.clientId).toBe("c1");
    expect(JSON.stringify(sent.metadata)).not.toMatch(/evidence|"value"/);
  });
  it("with the events flag off nothing is touched (the AuditLog row the store writes is the record)", async () => {
    await emitMemoryEvent(event);
    expect(emitEvent).not.toHaveBeenCalled();
  });
  it("a failing emit never fails the memory write it describes", async () => {
    process.env.CUSTOMER_EVENTS_ENABLED = "1";
    emitEvent.mockRejectedValueOnce(new Error("db gone"));
    await expect(emitMemoryEvent(event)).resolves.toBeUndefined();
  });
  it("a sink installed by a test still wins over the default", async () => {
    process.env.CUSTOMER_EVENTS_ENABLED = "1";
    const seen: string[] = [];
    setMemoryEventSink((e) => { seen.push(e.type); });
    await emitMemoryEvent(event);
    expect(seen).toEqual(["customer.memory.confirmed"]);
    expect(emitEvent).not.toHaveBeenCalled();
  });
});
