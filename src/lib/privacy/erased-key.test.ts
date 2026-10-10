import { describe, expect, it } from "vitest";
import { erasedLedgerKey } from "./erased-key";

describe("erasedLedgerKey", () => {
  it("is a one-way, fixed-size, prefixed hash that does not contain the id", () => {
    const key = erasedLedgerKey("allvest_app", "user-12345");
    expect(key).toMatch(/^erased:[0-9a-f]{64}$/);
    expect(key).not.toContain("user-12345");
  });
  it("is deterministic and separates sources and ids", () => {
    expect(erasedLedgerKey("a", "1")).toBe(erasedLedgerKey("a", "1"));
    expect(erasedLedgerKey("a", "1")).not.toBe(erasedLedgerKey("b", "1"));
    expect(erasedLedgerKey("a", "1")).not.toBe(erasedLedgerKey("a", "2"));
    expect(erasedLedgerKey("ab", "c")).not.toBe(erasedLedgerKey("a", "bc"));
  });
});
