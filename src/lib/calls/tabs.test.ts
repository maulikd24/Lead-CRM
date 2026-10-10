import { describe, expect, it } from "vitest";

import { CALL_DETAIL_TAB_KEYS, callDetailTabs, listStats, listTabs, parseListTab } from "./tabs";
import type { CallRow } from "./view-model";

const row = (over: Partial<CallRow> = {}): CallRow => ({
  id: "1", occurredAt: new Date("2026-10-01T10:00:00Z"), direction: "outbound", outcome: "connected", durationSeconds: 60, durationLabel: "1:00", customerName: "A", clientId: "c", rmId: "r", rmName: "R",
  score: 80, band: "high", sentiment: "positive", flags: [], hasRecording: true, hasTranscript: true, reviewed: false, analysis: "done", ...over,
});

describe("detail tabs", () => {
  it("are transcript, scores, actions, recording in that order", () => {
    expect(CALL_DETAIL_TAB_KEYS).toEqual(["transcript", "scores", "actions", "recording"]);
  });
  it("count what came up on the Actions tab", () => {
    const tabs = callDetailTabs({ flagDetails: 2, commitments: 1, objections: 1 });
    expect(tabs.find((t) => t.key === "actions")?.count).toBe(4);
    expect(tabs.find((t) => t.key === "scores")?.count).toBeNull();
  });
});

describe("list tabs", () => {
  it("managers with calls get Calls and Rollup", () => {
    expect(listTabs({ isManager: true, hasCalls: true }).map((t) => t.key)).toEqual(["calls", "rollup"]);
  });
  it("an RM, or an empty list, gets Calls only", () => {
    expect(listTabs({ isManager: false, hasCalls: true }).map((t) => t.key)).toEqual(["calls"]);
    expect(listTabs({ isManager: true, hasCalls: false }).map((t) => t.key)).toEqual(["calls"]);
  });
  it("parseListTab falls back to calls for unknown values and for rollup when not allowed", () => {
    expect(parseListTab("rollup", { isManager: true, hasCalls: true })).toBe("rollup");
    expect(parseListTab("rollup", { isManager: false, hasCalls: true })).toBe("calls");
    expect(parseListTab("nope", { isManager: true, hasCalls: true })).toBe("calls");
    expect(parseListTab(["rollup"], { isManager: true, hasCalls: true })).toBe("rollup");
    expect(parseListTab(undefined, { isManager: true, hasCalls: true })).toBe("calls");
  });
});

describe("listStats", () => {
  it("summarises the rows in view", () => {
    const s = listStats([row(), row({ id: "2", score: 40, flags: ["compliance"], reviewed: true }), row({ id: "3", score: null, analysis: "none" })]);
    expect(s).toEqual({ total: 3, averageScore: 60, flagged: 1, reviewed: 1 });
  });
  it("has no average when nothing is scored", () => {
    expect(listStats([row({ score: null })]).averageScore).toBeNull();
    expect(listStats([])).toEqual({ total: 0, averageScore: null, flagged: 0, reviewed: 0 });
  });
});
