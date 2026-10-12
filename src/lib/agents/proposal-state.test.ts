import { describe, expect, it } from "vitest";
import { assertTransition, canTransition } from "./proposal-state";

describe("proposal state machine", () => {
  it("allows the happy path DRAFT -> APPROVED -> SENT", () => {
    expect(canTransition("DRAFT", "APPROVED")).toBe(true);
    expect(canTransition("APPROVED", "SENT")).toBe(true);
  });
  it("allows rejecting or expiring a draft", () => {
    expect(canTransition("DRAFT", "REJECTED")).toBe(true);
    expect(canTransition("DRAFT", "EXPIRED")).toBe(true);
  });
  it("lets a failed send release its APPROVED claim back to DRAFT", () => {
    expect(canTransition("APPROVED", "DRAFT")).toBe(true);
    expect(canTransition("APPROVED", "REJECTED")).toBe(false);
  });
  it("lets the sweeper expire an APPROVED claim whose draft ran out while stuck", () => {
    expect(canTransition("APPROVED", "EXPIRED")).toBe(true);
  });
  it("never leaves a terminal state", () => {
    for (const s of ["SENT", "REJECTED", "EXPIRED", "BLOCKED"] as const) {
      for (const t of ["DRAFT", "APPROVED", "SENT", "REJECTED", "EXPIRED", "BLOCKED"] as const) {
        expect(canTransition(s, t)).toBe(false);
      }
    }
  });
  it("cannot skip approval", () => {
    expect(canTransition("DRAFT", "SENT")).toBe(false);
    expect(() => assertTransition("DRAFT", "SENT")).toThrow(/DRAFT -> SENT/);
  });
});
