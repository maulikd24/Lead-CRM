import { describe, expect, it } from "vitest";
import { MAX_KNOWN_GAPS, formatReport, gate, summarise } from "./report";
import type { CaseResult, Decision, EvalCase } from "./types";

let n = 0;
const r = (expect: Decision, actual: Decision, extra: Partial<EvalCase> = {}, lang: "en" | "hi" = "en"): CaseResult => ({
  case: { id: `t${++n}`, category: "cat", lang, expect, kind: "guardrail", text: "x", ...extra } as EvalCase,
  actual,
  detail: "d",
});

describe("summarise", () => {
  it("builds the confusion matrix and splits regressions from documented cases", () => {
    const s = summarise([
      r("block", "block"), r("block", "block"), r("block", "allow"), r("block", "allow", { known: "documented" }),
      r("allow", "allow"), r("allow", "block"), r("allow", "block", { known: "by design" }), r("allow", "allow", { known: "stale" }),
    ]);
    expect(s.matrix).toEqual({ tp: 2, fn: 2, fp: 2, tn: 2 });
    expect(s.falseNegatives).toHaveLength(1);
    expect(s.knownGaps).toHaveLength(1);
    expect(s.falsePositives).toHaveLength(1);
    expect(s.knownOverBlocks).toHaveLength(1);
    expect(s.staleKnown).toHaveLength(1);
  });
  it("groups by category and language", () => {
    const s = summarise([r("block", "block"), r("allow", "block", {}, "hi")]);
    expect(s.byLang.map((x) => [x.name, x.total, x.passed])).toEqual([["en", 1, 1], ["hi", 1, 0]]);
    expect(s.byCategory[0]).toMatchObject({ name: "cat", total: 2, passed: 1, fn: 0, fp: 1 });
  });
});

describe("gate", () => {
  it("passes a clean run", () => expect(gate(summarise([r("block", "block"), r("allow", "allow")])).ok).toBe(true));
  it("fails on any undocumented false negative", () => expect(gate(summarise([r("block", "allow"), r("allow", "allow")])).ok).toBe(false));
  it("tolerates documented over-blocks up to the tolerance only", () => {
    const rows = [...Array(9).fill(0).map(() => r("allow", "allow")), r("allow", "block", { known: "by design" })];
    expect(gate(summarise(rows), 0.2).ok).toBe(true);
    expect(gate(summarise(rows), 0.05).ok).toBe(false);
  });
  it("fails on an undocumented false positive even inside the tolerance", () => {
    const rows = [...Array(50).fill(0).map(() => r("allow", "allow")), r("allow", "block")];
    expect(gate(summarise(rows), 0.5).ok).toBe(false);
  });
  it("fails when documented gaps exceed the cap, and on stale flags and errors", () => {
    expect(gate(summarise(Array(MAX_KNOWN_GAPS + 1).fill(0).map(() => r("block", "allow", { known: "documented gap" })))).ok).toBe(false);
    expect(gate(summarise([r("allow", "allow", { known: "stale" })])).ok).toBe(false);
    expect(gate(summarise([{ ...r("block", "block"), error: "boom" }])).ok).toBe(false);
  });
});

describe("formatReport", () => {
  it("prints the matrix, the per-category table and every regression", () => {
    const s = summarise([r("block", "allow", { text: "we guarantee 12%" } as Partial<EvalCase>), r("allow", "allow")]);
    const out = formatReport(s, gate(s));
    expect(out).toContain("Confusion matrix");
    expect(out).toContain("category");
    expect(out).toContain("REGRESSIONS: false negatives");
    expect(out).toContain("we guarantee 12%");
    expect(out).toContain("RESULT: FAIL");
  });
});
