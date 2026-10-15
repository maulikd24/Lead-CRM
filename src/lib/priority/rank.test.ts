import { describe, expect, it } from "vitest";
import { PRIORITY_WEIGHTS, rankPriorityClients, type PriorityClientInput } from "./rank";

const base = (over: Partial<PriorityClientInput> & { clientId: string }): PriorityClientInput => ({
  name: `Client ${over.clientId}`,
  nba: { priority: "Low", priorityScore: 0, programme: "No Action / Do Not Pitch" },
  pendingCommitments: 0,
  overdueCommitments: false,
  openComplaints: 0,
  situations: [],
  daysSinceLastInteraction: 0,
  ...over,
});

describe("rankPriorityClients", () => {
  it("returns an empty list for no inputs", () => {
    expect(rankPriorityClients([])).toEqual([]);
  });

  it("scores a quiet, recently contacted Low client at zero and tiers it Low", () => {
    const [only] = rankPriorityClients([base({ clientId: "a" })]);
    expect(only.score).toBe(0);
    expect(only.tier).toBe("Low");
    expect(only.rank).toBe(1);
  });

  it("gives an open complaint and an overdue commitment the largest weight, and reports them explicitly", () => {
    const [top] = rankPriorityClients([
      base({
        clientId: "a",
        nba: { priority: "High", priorityScore: 80, programme: "Service / relationship follow-up" },
        openComplaints: 1,
        pendingCommitments: 1,
        overdueCommitments: true,
        daysSinceLastInteraction: 1,
      }),
    ]);
    // 40 (High) + 16 (80/5) + 25 (complaint) + 20 (overdue) = 101, clamped to 100
    expect(top.score).toBe(100);
    expect(top.tier).toBe("High");
    expect(top.reason).toBe("NBA High: Service / relationship follow-up; Open complaint; Commitment overdue.");
  });

  it("applies the documented tier thresholds", () => {
    // Score = NBA base + round(priorityScore / 5), nothing else set. High base 40 + 20 = 60; Medium base 20 + 15 = 35.
    const tierOf = (priority: "High" | "Medium", priorityScore: number) =>
      rankPriorityClients([base({ clientId: "t", nba: { priority, priorityScore, programme: "X" }, daysSinceLastInteraction: 0 })])[0];
    expect(tierOf("High", 100)).toMatchObject({ score: 60, tier: "High" });
    expect(tierOf("High", 95)).toMatchObject({ score: 59, tier: "Medium" });
    expect(tierOf("Medium", 75)).toMatchObject({ score: 35, tier: "Medium" });
    expect(tierOf("Medium", 70)).toMatchObject({ score: 34, tier: "Low" });
  });

  it("counts pending commitments without overdue at the lower weight", () => {
    const [c] = rankPriorityClients([base({ clientId: "a", pendingCommitments: 2, daysSinceLastInteraction: 0 })]);
    expect(c.score).toBe(PRIORITY_WEIGHTS.commitmentPending);
    expect(c.reason).toBe("NBA Low: No Action / Do Not Pitch; 2 commitments pending.");
  });

  it("caps high-urgency situations so they cannot dominate", () => {
    const situations = Array.from({ length: 6 }, (_, i) => ({ key: `s${i}`, severity: "high" as const }));
    const [c] = rankPriorityClients([base({ clientId: "a", situations, daysSinceLastInteraction: 0 })]);
    expect(c.score).toBe(PRIORITY_WEIGHTS.highSituationCap);
  });

  it("does not count medium or info situations", () => {
    const [c] = rankPriorityClients([
      base({ clientId: "a", daysSinceLastInteraction: 0, situations: [{ key: "x", severity: "medium" }, { key: "y", severity: "info" }] }),
    ]);
    expect(c.score).toBe(0);
  });

  it("adds staleness bands and treats no interaction on record as stale", () => {
    const score = (days: number | null) => rankPriorityClients([base({ clientId: "a", daysSinceLastInteraction: days })])[0].score;
    expect(score(null)).toBe(PRIORITY_WEIGHTS.noInteraction);
    expect(score(30)).toBe(15);
    expect(score(14)).toBe(10);
    expect(score(7)).toBe(5);
    expect(score(6)).toBe(0);
  });

  it("ranks by score, then by longer gap since contact, then name, then id", () => {
    const ranked = rankPriorityClients([
      base({ clientId: "z", name: "Same", daysSinceLastInteraction: 0, openComplaints: 1 }),
      base({ clientId: "b", name: "Same", daysSinceLastInteraction: 0, openComplaints: 1 }),
      base({ clientId: "c", name: "Same", daysSinceLastInteraction: 40, openComplaints: 1, nba: { priority: "Low", priorityScore: 0, programme: "X" } }),
      base({ clientId: "d", name: "Adam", daysSinceLastInteraction: 0, openComplaints: 1 }),
    ]);
    // Scores: c = 25 + 15 (40 days) = 40; d, b, z = 25 each. Among those, d sorts first on name, then b before z on id.
    expect(ranked.map((r) => r.clientId)).toEqual(["c", "d", "b", "z"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it("is deterministic: the same inputs in any order give the same ranking", () => {
    const inputs = [
      base({ clientId: "a", openComplaints: 1, daysSinceLastInteraction: 3 }),
      base({ clientId: "b", pendingCommitments: 1, daysSinceLastInteraction: 9 }),
      base({ clientId: "c", daysSinceLastInteraction: null }),
      base({ clientId: "d", name: "Other", daysSinceLastInteraction: 9 }),
    ];
    const forward = rankPriorityClients(inputs);
    const reversed = rankPriorityClients([...inputs].reverse());
    expect(reversed).toEqual(forward);
  });

  it("does not mutate its inputs", () => {
    const inputs = [base({ clientId: "b" }), base({ clientId: "a", openComplaints: 1 })];
    const snapshot = JSON.stringify(inputs);
    rankPriorityClients(inputs);
    expect(JSON.stringify(inputs)).toBe(snapshot);
  });

  it("keeps the reason to the three most important factors", () => {
    const [c] = rankPriorityClients([
      base({
        clientId: "a",
        nba: { priority: "High", priorityScore: 50, programme: "PMS / AIF opportunity" },
        openComplaints: 2,
        overdueCommitments: true,
        situations: [{ key: "k", severity: "high" }],
        daysSinceLastInteraction: 30,
      }),
    ]);
    expect(c.reason.split("; ")).toHaveLength(3);
    expect(c.reason.startsWith("NBA High: PMS / AIF opportunity; 2 open complaints; Commitment overdue")).toBe(true);
  });
});
