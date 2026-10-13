import { describe, expect, it } from "vitest";
import { applyOutcomeToAcceptance, computeAcceptance } from "./acceptance";
import { makeFacts } from "@/test/factories";

const NOW = new Date("2026-10-09T10:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
const outcome = (value: string, days: number, assetClass: string | null = "Mutual Funds") => ({ outcome: value, assetClass, createdAt: daysAgo(days) });

describe("applyOutcomeToAcceptance", () => {
  it("sets interested and converted to HIGH, with the same reason text the engine has always logged", () => {
    expect(applyOutcomeToAcceptance("LOW", "INTERESTED", new Date("2026-10-01T06:00:00Z"))).toEqual({ level: "HIGH", reason: "Outcome logged: interested (2026-10-01)" });
    expect(applyOutcomeToAcceptance("MEDIUM", "CONVERTED", new Date("2026-10-01T06:00:00Z"))).toEqual({ level: "HIGH", reason: "Outcome logged: converted (2026-10-01)" });
  });

  it("sets not interested and not relevant to LOW", () => {
    expect(applyOutcomeToAcceptance("HIGH", "NOT_INTERESTED", new Date("2026-10-01T06:00:00Z"))?.level).toBe("LOW");
    expect(applyOutcomeToAcceptance("HIGH", "NOT_RELEVANT", new Date("2026-10-01T06:00:00Z"))?.level).toBe("LOW");
  });

  it("treats follow up as warm: lifts LOW to MEDIUM and changes nothing otherwise", () => {
    expect(applyOutcomeToAcceptance("LOW", "FOLLOW_UP", new Date("2026-10-01T06:00:00Z"))).toEqual({ level: "MEDIUM", reason: "Asked for a follow-up (2026-10-01)" });
    expect(applyOutcomeToAcceptance("MEDIUM", "FOLLOW_UP", NOW)).toBeNull();
    expect(applyOutcomeToAcceptance("HIGH", "FOLLOW_UP", NOW)).toBeNull();
  });

  it("returns null for outcomes that say nothing about acceptance", () => {
    expect(applyOutcomeToAcceptance("MEDIUM", "RM_HANDOVER", NOW)).toBeNull();
    expect(applyOutcomeToAcceptance("MEDIUM", "SERVICE_ISSUE", NOW)).toBeNull();
    expect(applyOutcomeToAcceptance("MEDIUM", "UNKNOWN", NOW)).toBeNull();
  });
});

describe("computeAcceptance with logged outcomes", () => {
  it("keeps the previous behaviour for interested and not interested, flag on or off", () => {
    for (const opts of [{}, { outcomeLearning: true }]) {
      const map = computeAcceptance(makeFacts({ outcomes: [outcome("INTERESTED", 3)] }), opts);
      expect(map["Mutual Funds"]).toEqual({ level: "HIGH", source: "outcome", reason: "Outcome logged: interested (2026-10-06)" });
      const declined = computeAcceptance(makeFacts({ outcomes: [outcome("NOT_INTERESTED", 3)] }), opts);
      expect(declined["Mutual Funds"].level).toBe("LOW");
    }
  });

  it("leaves a follow up out of acceptance while outcome learning is off (the previous behaviour)", () => {
    const f = makeFacts({ outcomes: [outcome("NOT_INTERESTED", 5), outcome("FOLLOW_UP", 2)] });
    const entry = computeAcceptance(f)["Mutual Funds"];
    expect(entry.level).toBe("LOW");
    expect(entry.reason).toBe("Outcome logged: not interested (2026-10-04)");
  });

  it("lifts LOW to MEDIUM after a follow up when outcome learning is on", () => {
    const f = makeFacts({ outcomes: [outcome("NOT_INTERESTED", 5), outcome("FOLLOW_UP", 2)] });
    expect(computeAcceptance(f, { outcomeLearning: true })["Mutual Funds"]).toEqual({ level: "MEDIUM", source: "outcome", reason: "Asked for a follow-up (2026-10-07)" });
  });

  it("does not change HIGH on a follow up, so the earlier interest stays the reason", () => {
    const f = makeFacts({ outcomes: [outcome("INTERESTED", 6), outcome("FOLLOW_UP", 1)] });
    expect(computeAcceptance(f, { outcomeLearning: true })["Mutual Funds"]).toEqual({ level: "HIGH", source: "outcome", reason: "Outcome logged: interested (2026-10-03)" });
  });

  it("ignores outcomes with no asset class", () => {
    const f = makeFacts({ outcomes: [outcome("FOLLOW_UP", 1, null)] });
    expect(computeAcceptance(f, { outcomeLearning: true })["Mutual Funds"].source).toBe("rule");
  });

  it("ignores outcomes older than 90 days", () => {
    const f = makeFacts({ outcomes: [outcome("NOT_INTERESTED", 120), outcome("FOLLOW_UP", 100)] });
    expect(computeAcceptance(f, { outcomeLearning: true })["Mutual Funds"].source).toBe("rule");
  });

  it("lets an RM's manual setting override a follow up", () => {
    const f = makeFacts({
      outcomes: [outcome("NOT_INTERESTED", 5), outcome("FOLLOW_UP", 2)],
      manualAcceptance: [{ assetClass: "Mutual Funds", level: "LOW", updatedAt: NOW }],
    });
    expect(computeAcceptance(f, { outcomeLearning: true })["Mutual Funds"]).toEqual({ level: "LOW", source: "manual", reason: "Set by the RM" });
  });
});
