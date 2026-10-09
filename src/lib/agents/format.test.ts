import { describe, expect, it } from "vitest";
import { expiresInLabel } from "./format";

const now = new Date("2026-10-09T10:00:00Z");
const at = (ms: number) => new Date(now.getTime() + ms);
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("expiresInLabel", () => {
  it("shows whole hours when an hour or more is left", () => {
    expect(expiresInLabel(at(31 * HOUR + 20 * MIN), now)).toBe("expires in 31 h");
    expect(expiresInLabel(at(HOUR), now)).toBe("expires in 1 h");
    expect(expiresInLabel(at(47 * HOUR), now)).toBe("expires in 47 h");
  });
  it("shows minutes under an hour", () => {
    expect(expiresInLabel(at(20 * MIN), now)).toBe("expires in 20 min");
    expect(expiresInLabel(at(59 * MIN + 59_000), now)).toBe("expires in 59 min");
    expect(expiresInLabel(at(59 * MIN), now)).toBe("expires in 59 min");
  });
  it("floors minutes with a 1-minute minimum", () => {
    expect(expiresInLabel(at(10_000), now)).toBe("expires in 1 min");
  });
  it("says expired at or after the deadline", () => {
    expect(expiresInLabel(at(0), now)).toBe("expired");
    expect(expiresInLabel(at(-5 * MIN), now)).toBe("expired");
  });
});
