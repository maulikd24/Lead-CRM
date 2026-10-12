import { describe, expect, it } from "vitest";

import { classifyDrop, parseBoardFilter, stageWinRates } from "./board-logic";

describe("classifyDrop", () => {
  it("does nothing when dropped back on its own stage", () => {
    expect(classifyDrop(3, 3, "RM")).toEqual({ kind: "none" });
  });
  it("opens the next stage's own form for anyone", () => {
    expect(classifyDrop(2, 3, "RM").kind).toBe("advance");
    expect(classifyDrop(2, 3, "ADMIN").kind).toBe("advance");
  });
  it("treats skipping or going back as a correction for Managers and Admins", () => {
    expect(classifyDrop(1, 4, "MANAGER").kind).toBe("correct");
    expect(classifyDrop(4, 2, "ADMIN").kind).toBe("correct");
  });
  it("refuses skipping or going back for an RM, saying why", () => {
    const skip = classifyDrop(1, 3, "RM");
    const back = classifyDrop(3, 2, "RM");
    expect(skip.kind).toBe("denied");
    expect(back.kind === "denied" && back.message).toMatch(/back a stage/);
    expect(skip.kind === "denied" && skip.message).toMatch(/one stage at a time/);
  });
});

describe("stageWinRates", () => {
  const ids = ["s1", "s2", "s3"];
  const make = (n: number, reached: string[], completed: boolean) => Array.from({ length: n }, () => ({ reachedStageIds: reached, completed }));

  it("is the share of finished clients through a stage who completed", () => {
    const finished = [...make(6, ["s2", "s3"], true), ...make(4, ["s2"], false), ...make(10, [], false)];
    const rates = stageWinRates(ids, finished);
    expect(rates.get("s1")).toBeCloseTo(6 / 20); // everyone reached the first stage
    expect(rates.get("s2")).toBeCloseTo(6 / 10);
    expect(rates.get("s3")).toBeNull(); // only 6 got there: too few
  });
  it("shows nothing when there's no history", () => {
    expect([...stageWinRates(ids, []).values()]).toEqual([null, null, null]);
  });
});

describe("board helpers", () => {
  it("falls back to All for an unknown filter", () => {
    expect(parseBoardFilter("hot")).toBe("hot");
    expect(parseBoardFilter("nonsense")).toBe("all");
    expect(parseBoardFilter(undefined)).toBe("all");
  });
});
