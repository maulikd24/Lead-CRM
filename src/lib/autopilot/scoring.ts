import { CATEGORIES, type Category, type ControlResult, type Severity } from "./types";

/**
 * Health score and evidence coverage, always reported together. Controls are pass / fail / unknown / not_applicable;
 * a failed control costs its severity weight. Informational controls carry no weight. Unknown controls are not
 * guessed: they lower COVERAGE, not the score. No letter grades.
 */

export const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 5, high: 3, medium: 1, informational: 0 };

export type Score = {
  /** 0..100, or null when no weighted control could be judged. */
  score: number | null;
  /** Share of applicable controls that could be judged, 0..1. */
  coverage: number;
  judged: number;
  applicable: number;
  /** "normal" at 80% coverage and above, "provisional" at 60% and above, otherwise "low". */
  confidence: "normal" | "provisional" | "low";
};

export function scoreControls(results: ControlResult[]): Score {
  const applicable = results.filter((r) => r.state !== "not_applicable");
  const judgedAll = applicable.filter((r) => r.state === "pass" || r.state === "fail");
  const weighted = judgedAll.filter((r) => SEVERITY_WEIGHT[r.severity] > 0);
  const total = weighted.reduce((a, r) => a + SEVERITY_WEIGHT[r.severity], 0);
  const lost = weighted.filter((r) => r.state === "fail").reduce((a, r) => a + SEVERITY_WEIGHT[r.severity], 0);
  const coverage = applicable.length ? judgedAll.length / applicable.length : 0;
  return {
    score: total > 0 ? Math.round(((total - lost) / total) * 100) : null,
    coverage,
    judged: judgedAll.length,
    applicable: applicable.length,
    confidence: coverage >= 0.8 ? "normal" : coverage >= 0.6 ? "provisional" : "low",
  };
}

export type CategoryCard = Score & { category: Category; findings: ControlResult[] };

const RANK: Record<Severity, number> = { critical: 3, high: 2, medium: 1, informational: 0 };

/** One card per category, each with its score, its coverage and the two findings that matter most. */
export function categoryScorecard(results: ControlResult[]): CategoryCard[] {
  return CATEGORIES.map((category) => {
    const mine = results.filter((r) => r.category === category);
    const order = (r: ControlResult) => (r.state === "fail" ? 0 : r.state === "unknown" ? 2 : 1) * 10 - RANK[r.severity];
    const findings = [...mine].filter((r) => r.state !== "not_applicable").sort((a, b) => order(a) - order(b)).slice(0, 2);
    return { category, ...scoreControls(mine), findings };
  });
}
