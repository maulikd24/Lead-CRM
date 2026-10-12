import { describe, expect, it } from "vitest";

import { quarterDateLine } from "./ist-date";

describe("quarterDateLine", () => {
  it("reads like Halden's: quarter, week of the quarter, weekday and date", () => {
    expect(quarterDateLine(new Date("2026-10-12T06:00:00Z"))).toBe("Q4 · Week 2 · Monday, 12 Oct");
  });
  it("counts weeks from the quarter's first day", () => {
    expect(quarterDateLine(new Date("2026-10-01T06:00:00Z"))).toBe("Q4 · Week 1 · Thursday, 1 Oct");
    expect(quarterDateLine(new Date("2026-10-07T06:00:00Z"))).toMatch(/Week 1 /);
    expect(quarterDateLine(new Date("2026-10-08T06:00:00Z"))).toMatch(/Week 2 /);
    expect(quarterDateLine(new Date("2026-12-31T06:00:00Z"))).toBe("Q4 · Week 14 · Thursday, 31 Dec");
  });
  it("uses the IST date, not the server's", () => {
    // 20:00 UTC on 31 Mar is already 1 Apr (Q2) in India.
    expect(quarterDateLine(new Date("2026-03-31T20:00:00Z"))).toBe("Q2 · Week 1 · Wednesday, 1 Apr");
  });
});
