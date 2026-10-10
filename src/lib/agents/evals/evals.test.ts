import { describe, expect, it } from "vitest";
import { ALL_CASES, LIVE_JUDGE_CASES } from "./cases";
import { evaluateAll } from "./evaluate";
import { FALSE_POSITIVE_TOLERANCE, MAX_KNOWN_GAPS, formatReport, gate, summarise } from "./report";

const results = await evaluateAll(ALL_CASES);
const summary = summarise(results);
const g = gate(summary);
const describeCase = (r: { case: { id: string }; detail: string }) => `${r.case.id}: ${r.detail}`;

describe("agent safety evals (offline, deterministic layers)", () => {
  it("covers every category the safety layer promises", () => {
    const cats = new Set(ALL_CASES.map((c) => c.category));
    for (const c of ["guaranteed_returns", "advice", "performance_claim", "pii_echo_outbound", "pii_vendor_scrub", "pii_vendor_payload", "handover", "consent", "out_of_window", "judge", "pipeline_nudger", "pipeline_reply", "benign", "evasion"]) {
      expect(cats.has(c), `missing category ${c}`).toBe(true);
    }
    expect(ALL_CASES.length).toBeGreaterThanOrEqual(300);
    for (const lang of ["en", "hinglish", "hi"]) expect(ALL_CASES.some((c) => c.lang === lang), lang).toBe(true);
  });

  it("has unique ids and both outcomes in every layer that can allow", () => {
    expect(new Set(ALL_CASES.map((c) => c.id)).size).toBe(ALL_CASES.length);
    expect(ALL_CASES.some((c) => c.expect === "allow")).toBe(true);
  });

  it("contains synthetic text only (no internal names, no real-looking secrets)", () => {
    const blob = JSON.stringify([...ALL_CASES, ...LIVE_JUDGE_CASES]);
    expect(blob).not.toMatch(new RegExp(`${["all", "vest"].join("")}|sk-ant|api[_-]?key|bearer`, "i"));
  });

  it("RELEASE BLOCKER: no must-block case passes the deterministic layers", () => {
    expect(summary.falseNegatives.map(describeCase)).toEqual([]);
  });

  it("no benign case is blocked unless documented as an accepted over-block", () => {
    expect(summary.falsePositives.map(describeCase)).toEqual([]);
  });

  it("stays inside the false-positive tolerance", () => {
    expect(g.falsePositiveRate).toBeLessThanOrEqual(FALSE_POSITIVE_TOLERANCE);
  });

  it("documented gaps do not grow unnoticed and none is stale", () => {
    expect(summary.knownGaps.length).toBeLessThanOrEqual(MAX_KNOWN_GAPS);
    expect(summary.staleKnown.map(describeCase)).toEqual([]);
    for (const r of [...summary.knownGaps, ...summary.knownOverBlocks]) expect(r.case.known?.length, r.case.id).toBeGreaterThan(10);
  });

  it("no evaluator errored", () => {
    expect(summary.errors.map(describeCase)).toEqual([]);
  });

  it("the overall gate agrees and the report prints", () => {
    expect(g.failures).toEqual([]);
    expect(formatReport(summary, g)).toContain("RESULT: PASS");
  });

  it("every scripted layer is deterministic: two runs give identical decisions", async () => {
    const again = await evaluateAll(ALL_CASES);
    expect(again.map((r) => r.actual)).toEqual(results.map((r) => r.actual));
  });
});
