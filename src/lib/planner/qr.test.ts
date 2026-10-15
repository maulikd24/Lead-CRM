import { describe, expect, it } from "vitest";

import { qrMatrix } from "./qr";

describe("qrMatrix", () => {
  it("returns a square matrix with the three finder patterns", () => {
    const m = qrMatrix("https://example.test/p?campaign_code=CP-7K3Q9X");
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((row) => row.length === m.length)).toBe(true);
    const n = m.length;
    for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      expect(m[r][c] && m[r][c + 6] && m[r + 6][c] && m[r + 6][c + 6] && m[r + 3][c + 3]).toBe(true);
      expect(m[r + 1][c + 1]).toBe(false);
    }
  });
  it("is deterministic and grows with the text", () => {
    expect(qrMatrix("abc")).toEqual(qrMatrix("abc"));
    expect(qrMatrix("x".repeat(120)).length).toBeGreaterThan(qrMatrix("x").length);
  });
  it("refuses empty text", () => {
    expect(() => qrMatrix("")).toThrow();
  });
});
