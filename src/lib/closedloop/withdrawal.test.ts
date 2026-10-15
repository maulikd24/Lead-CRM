import { describe, expect, it } from "vitest";

import { MemoryOutbox } from "./memory-store";
import { cancelOnWithdrawal } from "./withdrawal";

const NOW = new Date("2027-03-20T10:00:00Z");
const ins = (s: MemoryOutbox, clientId: string, dedupId: string) => s.insertIfAbsent({ clientId, destination: "fake", eventType: "KYC_COMPLETE", qualifier: "", dedupId, occurredAt: NOW, identity: {}, value: null }, NOW);

describe("cancelOnWithdrawal", () => {
  it("skips the customer's unsent rows when ad measurement consent is withdrawn, leaving sent rows and other customers alone", async () => {
    const s = new MemoryOutbox();
    await ins(s, "c1", "a");
    await ins(s, "c1", "b");
    await ins(s, "c2", "c");
    await s.markSent(s.rows[1].id, NOW, null);
    const n = await cancelOnWithdrawal(s, { clientId: "c1", purpose: "ADS_MEASUREMENT", status: "WITHDRAWN" });
    expect(n).toBe(1);
    expect(s.rows.map((r) => r.status)).toEqual(["SKIPPED", "SENT", "PENDING"]);
    expect(s.rows[0].reason).toBe("CONSENT_WITHDRAWN");
  });
  it("does nothing for a grant, or for any other purpose", async () => {
    const s = new MemoryOutbox();
    await ins(s, "c1", "a");
    expect(await cancelOnWithdrawal(s, { clientId: "c1", purpose: "ADS_MEASUREMENT", status: "GRANTED" })).toBe(0);
    expect(await cancelOnWithdrawal(s, { clientId: "c1", purpose: "MARKETING_COMMS", status: "WITHDRAWN" })).toBe(0);
    expect(s.rows[0].status).toBe("PENDING");
  });
  it("never throws into the consent write: a store failure is swallowed (the send-time gate still blocks)", async () => {
    const s = new MemoryOutbox();
    s.cancelUnsentForClient = async () => { throw new Error("db down"); };
    expect(await cancelOnWithdrawal(s, { clientId: "c1", purpose: "ADS_MEASUREMENT", status: "WITHDRAWN" })).toBe(0);
  });
});
