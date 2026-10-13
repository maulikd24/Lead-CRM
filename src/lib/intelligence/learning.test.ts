import { describe, expect, it } from "vitest";
import { makeFacts } from "@/test/factories";
import { computeAcceptance } from "./acceptance";
import { computeNextBestAction, type NextBestActionV2 } from "./nba";
import { acceptanceStep, communicationWeight, freshness, isLearningOutcome, nbaLearning, COMMUNICATION_WEIGHT_LIMIT, LEARNING_WINDOW_DAYS } from "./learning";
import type { Situation } from "./situations";

const NOW = new Date("2026-10-09T10:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
const at = (outcome: string, days: number, assetClass: string | null = "Mutual Funds") => ({ outcome, assetClass, createdAt: daysAgo(days) });

describe("acceptanceStep (learning step 1)", () => {
  it("moves acceptance on interest, conversion and decline", () => {
    expect(acceptanceStep("LOW", "INTERESTED", NOW)?.level).toBe("HIGH");
    expect(acceptanceStep("MEDIUM", "CONVERTED", NOW)?.level).toBe("HIGH");
    expect(acceptanceStep("HIGH", "NOT_INTERESTED", NOW)?.level).toBe("LOW");
  });

  it("always counts a Follow up: lifts LOW to MEDIUM and leaves other levels alone", () => {
    expect(acceptanceStep("LOW", "FOLLOW_UP", NOW)?.level).toBe("MEDIUM");
    expect(acceptanceStep("HIGH", "FOLLOW_UP", NOW)).toBeNull();
  });
});

describe("freshness", () => {
  it("is 1 on the day, half at mid-window, 0 at the window's end, and 1 for a future timestamp", () => {
    expect(freshness(NOW, NOW)).toBe(1);
    expect(freshness(daysAgo(LEARNING_WINDOW_DAYS / 2), NOW)).toBeCloseTo(0.5);
    expect(freshness(daysAgo(LEARNING_WINDOW_DAYS), NOW)).toBe(0);
    expect(freshness(new Date(NOW.getTime() + 60_000), NOW)).toBe(1);
  });
});

describe("communicationWeight (learning step 2)", () => {
  it("is zero with no outcomes", () => {
    expect(communicationWeight([], NOW)).toBe(0);
  });

  it("is negative after a fresh decline and positive after fresh interest", () => {
    expect(communicationWeight([at("NOT_INTERESTED", 0)], NOW)).toBe(-4);
    expect(communicationWeight([at("INTERESTED", 0)], NOW)).toBe(3);
  });

  it("ignores outcomes outside the window and outcomes that are not learning outcomes", () => {
    expect(communicationWeight([at("NOT_INTERESTED", 120)], NOW)).toBe(0);
    expect(communicationWeight([{ outcome: "RM_HANDOVER", assetClass: null, createdAt: NOW }], NOW)).toBe(0);
  });

  it("clamps to the limit", () => {
    const many = Array.from({ length: 10 }, () => at("INTERESTED", 0));
    expect(communicationWeight(many, NOW)).toBe(COMMUNICATION_WEIGHT_LIMIT);
    expect(communicationWeight(many.map((o) => ({ ...o, outcome: "NOT_INTERESTED" })), NOW)).toBe(-COMMUNICATION_WEIGHT_LIMIT);
  });
});

describe("nbaLearning (learning step 3)", () => {
  it("weights each asset class and lists classes converted inside the window", () => {
    const out = nbaLearning([at("INTERESTED", 0, "PMS"), at("NOT_INTERESTED", 0, "Bonds"), at("CONVERTED", 10, "Broking"), at("CONVERTED", 120, "AIF")], NOW);
    expect(out.classWeight).toEqual({ PMS: 3, Bonds: -4, Broking: 2 });
    expect(out.converted).toEqual(["Broking"]);
  });

  it("skips outcomes with no asset class", () => {
    const out = nbaLearning([at("NOT_INTERESTED", 0, null)], NOW);
    expect(out.classWeight).toEqual({});
    expect(out.communication).toBe(-4);
  });
});

describe("isLearningOutcome", () => {
  it("accepts the five learning outcomes only", () => {
    expect(["INTERESTED", "NOT_INTERESTED", "FOLLOW_UP", "CONVERTED", "NOT_RELEVANT"].every(isLearningOutcome)).toBe(true);
    expect(isLearningOutcome("RM_HANDOVER")).toBe(false);
  });
});

describe("the NBA reads the learning output", () => {
  const interest: Situation[] = [{ key: "recent_interest", label: "Recent interest", severity: "high", detail: "Showed interest in mutual funds.", assetClass: "Mutual Funds" }];
  const run = (outcomes: ReturnType<typeof at>[], withLearning: boolean): NextBestActionV2 => {
    const facts = makeFacts({ outcomes });
    const acceptance = computeAcceptance(facts);
    return computeNextBestAction(facts, "Active", interest, acceptance, withLearning ? { learning: nbaLearning(outcomes, NOW) } : {});
  };

  it("pitches the interested asset class when nothing has been converted", () => {
    expect(run([], true).programme).toBe("MF / SIP opportunity");
  });

  it("does not pitch a class the customer has just converted on", () => {
    const nba = run([at("CONVERTED", 3)], true);
    expect(nba.programme).toBe("No Action / Do Not Pitch");
    expect(nba.reason).toContain("Mutual Funds already converted");
  });

  it("lowers the priority score after a fresh decline and leaves the same suggestion without learning", () => {
    const without = run([], false);
    const withDecline = run([at("NOT_INTERESTED", 0, null)], true);
    expect(withDecline.priorityScore).toBeLessThan(without.priorityScore);
    expect(withDecline.programme).toBe(without.programme);
  });
});
