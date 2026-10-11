import { describe, expect, it } from "vitest";

import { DIAGNOSIS, coverageCounts } from "./diagnosis";

describe("the 14 diagnosis questions", () => {
  it("lists all 14, numbered 1 to 14", () => expect(DIAGNOSIS.map((d) => d.n)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1)));
  it("answers 5 fully, 5 partially, links 2 and defers 2, exactly as the Wave 0 pack says", () => {
    expect(coverageCounts()).toEqual({ full: 5, partial: 5, link: 2, deferred: 2 });
    expect(DIAGNOSIS.filter((d) => d.coverage === "full").map((d) => d.n)).toEqual([1, 2, 8, 10, 13]);
    expect(DIAGNOSIS.filter((d) => d.coverage === "partial").map((d) => d.n)).toEqual([3, 4, 6, 12, 14]);
    expect(DIAGNOSIS.filter((d) => d.coverage === "link").map((d) => d.n)).toEqual([7, 11]);
    expect(DIAGNOSIS.filter((d) => d.coverage === "deferred").map((d) => d.n)).toEqual([5, 9]);
  });
  it("points every answered question at a tab or a screen that exists", () => {
    for (const d of DIAGNOSIS.filter((x) => x.coverage !== "deferred")) expect(d.tab || d.href, `q${d.n}`).toBeTruthy();
    for (const d of DIAGNOSIS) if (d.tab) expect(["health", "jobs", "failures", "integrations"]).toContain(d.tab);
  });
});
