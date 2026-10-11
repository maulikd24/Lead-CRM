import { describe, expect, it } from "vitest";

import { CANONICAL_STATES, canMove, effectiveState, isTerminal } from "./state";

const now = new Date("2027-04-20T10:00:00Z");
const past = new Date("2027-04-20T09:59:59Z");
const future = new Date("2027-04-20T10:00:01Z");

describe("canonical approval states", () => {
  it("are exactly the seven agreed", () => {
    expect([...CANONICAL_STATES]).toEqual(["requested", "approved", "rejected", "expired", "executed", "failed", "cancelled"]);
  });

  it("moves only along the allowed edges", () => {
    expect(canMove("requested", "approved")).toBe(true);
    expect(canMove("requested", "rejected")).toBe(true);
    expect(canMove("requested", "expired")).toBe(true);
    expect(canMove("requested", "cancelled")).toBe(true);
    expect(canMove("approved", "executed")).toBe(true);
    expect(canMove("approved", "failed")).toBe(true);
    expect(canMove("failed", "approved")).toBe(true); // a released claim can be retried
    expect(canMove("rejected", "approved")).toBe(false);
    expect(canMove("executed", "approved")).toBe(false);
    expect(canMove("expired", "approved")).toBe(false);
    expect(canMove("requested", "executed")).toBe(false);
  });

  it("knows which states are final", () => {
    for (const s of ["rejected", "expired", "executed", "cancelled"] as const) expect(isTerminal(s), s).toBe(true);
    for (const s of ["requested", "approved", "failed"] as const) expect(isTerminal(s), s).toBe(false);
  });

  it("a request past its expiry reads as expired, exactly at the boundary too", () => {
    expect(effectiveState("requested", past, now)).toBe("expired");
    expect(effectiveState("requested", now, now)).toBe("expired");
    expect(effectiveState("requested", future, now)).toBe("requested");
    expect(effectiveState("requested", null, now)).toBe("requested");
  });

  it("expiry never rewrites a decision already made", () => {
    for (const s of ["approved", "rejected", "executed", "failed", "cancelled"] as const) expect(effectiveState(s, past, now)).toBe(s);
  });
});
