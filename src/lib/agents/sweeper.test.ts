import { describe, expect, it } from "vitest";
import { planSweep, sweepStuckApprovals, STUCK_APPROVAL_MS, type StuckRow, type SweepMessage, type SweepDeps } from "./sweeper";

const NOW = new Date("2026-10-09T12:00:00Z");
const MIN = 60_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const row = (over: Partial<StuckRow> = {}): StuckRow => ({ id: "p1", clientId: "c1", decidedById: "rm1", decidedAt: ago(30 * MIN), expiresAt: new Date(NOW.getTime() + 3600_000), ...over });
const msg = (over: Partial<SweepMessage> = {}): SweepMessage => ({ id: "m1", clientId: "c1", senderUserId: "rm1", createdAt: ago(29 * MIN), ...over });

describe("planSweep", () => {
  it("leaves a row alone until it has been APPROVED for 15 minutes", () => {
    expect(STUCK_APPROVAL_MS).toBe(15 * MIN);
    expect(planSweep([row({ decidedAt: ago(15 * MIN - 1) })], [], NOW)).toEqual([]);
    expect(planSweep([row({ decidedAt: ago(15 * MIN) })], [], NOW)).toHaveLength(1);
  });
  it("marks SENT with the message id when the approver's outbound message exists since approval", () => {
    expect(planSweep([row()], [msg()], NOW)).toEqual([{ id: "p1", to: "SENT", messageId: "m1" }]);
    expect(planSweep([row()], [msg({ createdAt: row().decidedAt! })], NOW)).toEqual([{ id: "p1", to: "SENT", messageId: "m1" }]);
  });
  it("ignores messages that do not prove the send: other client, other sender, or before approval", () => {
    for (const m of [msg({ clientId: "c2" }), msg({ senderUserId: "rm2" }), msg({ senderUserId: null }), msg({ createdAt: ago(31 * MIN) })]) {
      expect(planSweep([row()], [m], NOW)).toEqual([{ id: "p1", to: "DRAFT" }]);
    }
  });
  it("releases to DRAFT when no message exists and the draft is unexpired", () => {
    expect(planSweep([row()], [], NOW)).toEqual([{ id: "p1", to: "DRAFT" }]);
  });
  it("expires when no message exists and the draft has expired (boundary: expiresAt === now is expired)", () => {
    expect(planSweep([row({ expiresAt: NOW })], [], NOW)).toEqual([{ id: "p1", to: "EXPIRED" }]);
    expect(planSweep([row({ expiresAt: ago(MIN) })], [], NOW)).toEqual([{ id: "p1", to: "EXPIRED" }]);
  });
  it("a sent message wins over expiry (it did go out)", () => {
    expect(planSweep([row({ expiresAt: ago(MIN) })], [msg()], NOW)).toEqual([{ id: "p1", to: "SENT", messageId: "m1" }]);
  });
  it("plans each row independently and uses the earliest matching message", () => {
    const rows = [row({ id: "a", clientId: "c1" }), row({ id: "b", clientId: "c2" })];
    const msgs = [msg({ id: "late", createdAt: ago(5 * MIN) }), msg({ id: "early", createdAt: ago(25 * MIN) })];
    expect(planSweep(rows, msgs, NOW)).toEqual([{ id: "a", to: "SENT", messageId: "early" }, { id: "b", to: "DRAFT" }]);
  });
});

describe("sweepStuckApprovals", () => {
  function deps(rows: StuckRow[], msgs: SweepMessage[], won = true) {
    const calls: unknown[][] = [];
    const d: SweepDeps = {
      loadStuck: async (cutoff) => { calls.push(["cutoff", cutoff]); return rows; },
      loadMessages: async () => msgs,
      transition: async (...a) => { calls.push(a); return won; },
      now: () => NOW,
    };
    return { d, calls };
  }
  it("applies each plan through the compare-and-set transition from APPROVED", async () => {
    const { d, calls } = deps([row()], [msg()]);
    expect(await sweepStuckApprovals(d)).toEqual({ sent: 1, released: 0, expired: 0, lostRace: 0 });
    expect(calls[0]).toEqual(["cutoff", ago(STUCK_APPROVAL_MS)]);
    expect(calls[1]).toEqual(["p1", "APPROVED", "SENT", { messageId: "m1" }]);
  });
  it("releases and expires", async () => {
    const { d, calls } = deps([row({ id: "a" }), row({ id: "b", expiresAt: ago(MIN) })], []);
    expect(await sweepStuckApprovals(d)).toEqual({ sent: 0, released: 1, expired: 1, lostRace: 0 });
    expect(calls.slice(1)).toEqual([["a", "APPROVED", "DRAFT", undefined], ["b", "APPROVED", "EXPIRED", undefined]]);
  });
  it("a concurrent change makes the sweep lose the race and change nothing", async () => {
    const { d } = deps([row()], [], false);
    expect(await sweepStuckApprovals(d)).toEqual({ sent: 0, released: 0, expired: 0, lostRace: 1 });
  });
  it("one failing transition does not stop the rest", async () => {
    let n = 0;
    const d: SweepDeps = { loadStuck: async () => [row({ id: "a" }), row({ id: "b" })], loadMessages: async () => [], transition: async () => { if (n++ === 0) throw new Error("db"); return true; }, now: () => NOW };
    expect(await sweepStuckApprovals(d)).toEqual({ sent: 0, released: 1, expired: 0, lostRace: 0 });
  });
  it("does not query messages when nothing is stuck", async () => {
    let asked = false;
    const d: SweepDeps = { loadStuck: async () => [], loadMessages: async () => { asked = true; return []; }, transition: async () => true, now: () => NOW };
    expect(await sweepStuckApprovals(d)).toEqual({ sent: 0, released: 0, expired: 0, lostRace: 0 });
    expect(asked).toBe(false);
  });
});
