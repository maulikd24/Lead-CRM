// Shadow exit criteria: written down, computed, pass or fail per criterion. A criterion with too little data says
// "insufficient data", never "pass". Moving from shadow to visible is a decision for people; this only reports the evidence.
import { EXIT_THRESHOLDS } from "./constants";

export type CriterionStatus = "pass" | "fail" | "insufficient_data";

export type ShadowStats = {
  decisions: number;
  /** Disagreements by severity. */
  materialRegressions: number;
  /** Daily buckets for the stability criterion (oldest first). */
  daily: { date: string; decisions: number; disagreements: number }[];
  consent: { checked: number; mismatches: number };
  productReview: { reviewedProductDecisions: number; seriousFalsePositives: number };
  /** From the last recorded gate run: "unknown" when none was recorded. */
  gates: { tests: "pass" | "fail" | "unknown"; evals: "pass" | "fail" | "unknown" };
};

export type CriterionResult = { id: string; title: string; status: CriterionStatus; measured: string; threshold: string; detail: string };
export type ExitReport = { ready: boolean; criteria: CriterionResult[]; summary: string };

const pct = (n: number, d: number) => (d === 0 ? 0 : (100 * n) / d);

export function evaluateExitCriteria(s: ShadowStats): ExitReport {
  const T = EXIT_THRESHOLDS;
  const out: CriterionResult[] = [];

  out.push({
    id: "no_material_suppression_regressions",
    title: "No material suppression regressions",
    status: s.decisions === 0 ? "insufficient_data" : s.materialRegressions <= T.maxMaterialRegressions ? "pass" : "fail",
    measured: `${s.materialRegressions} of ${s.decisions} decisions`,
    threshold: `${T.maxMaterialRegressions} allowed`,
    detail: "A material regression is the new engine recommending something the current engine told the RM not to raise (a declined class, sales during a service issue).",
  });

  out.push({
    id: "consent_policy_agreement",
    title: "Consent-policy agreement is 100%",
    status: s.consent.checked === 0 ? "insufficient_data" : s.consent.mismatches === 0 ? "pass" : "fail",
    measured: s.consent.checked === 0 ? "no contact decisions checked" : `${(100 - pct(s.consent.mismatches, s.consent.checked)).toFixed(2)}% (${s.consent.mismatches} mismatches in ${s.consent.checked})`,
    threshold: `${T.consentAgreementPct}%`,
    detail: "Every recommended contact channel is re-checked against the consent ledger by a second, independent implementation as of the moment of the decision.",
  });

  out.push({
    id: "no_serious_false_positive_products",
    title: "No serious false-positive product recommendations in sampled review",
    status: s.productReview.reviewedProductDecisions < T.minReviewedProductDecisions ? "insufficient_data" : s.productReview.seriousFalsePositives <= T.maxSeriousFalsePositives ? "pass" : "fail",
    measured: `${s.productReview.seriousFalsePositives} serious in ${s.productReview.reviewedProductDecisions} reviewed`,
    threshold: `at least ${T.minReviewedProductDecisions} reviewed, ${T.maxSeriousFalsePositives} serious`,
    detail: "Reviewers (Admin, Manager) mark a recommendation Wrong with a reason; wrong fact, wrong customer or wrong product on a product recommendation counts as serious.",
  });

  const days = s.daily.filter((d) => d.decisions > 0).slice(-T.disagreementWindowDays);
  const rates = days.map((d) => pct(d.disagreements, d.decisions));
  const spread = rates.length ? Math.max(...rates) - Math.min(...rates) : 0;
  out.push({
    id: "stable_disagreement_rate",
    title: "Disagreement rate is stable",
    status: days.length < T.disagreementMinDays ? "insufficient_data" : spread <= T.disagreementMaxSpreadPts ? "pass" : "fail",
    measured: days.length === 0 ? "no days with decisions" : `${days.length} days, spread ${spread.toFixed(1)} points (latest ${rates[rates.length - 1].toFixed(1)}%)`,
    threshold: `at least ${T.disagreementMinDays} days, spread at most ${T.disagreementMaxSpreadPts} points`,
    detail: "A rate that swings day to day means the engines react to something other than the customers (a data feed, a job, a rule edit).",
  });

  const g = s.gates;
  out.push({
    id: "existing_evals_and_tests_pass",
    title: "Existing evals and tests pass",
    status: g.tests === "fail" || g.evals === "fail" ? "fail" : g.tests === "pass" && g.evals === "pass" ? "pass" : "insufficient_data",
    measured: `tests ${g.tests}, evals ${g.evals}`,
    threshold: "both pass in the last recorded run",
    detail: "Read from the last gate run recorded by the report command (npm test and npm run evals).",
  });

  const ready = out.every((c) => c.status === "pass");
  const failing = out.filter((c) => c.status === "fail").length;
  const waiting = out.filter((c) => c.status === "insufficient_data").length;
  return { ready, criteria: out, summary: ready ? "All criteria pass. Moving beyond shadow is still a decision for a person." : `${failing} failing, ${waiting} waiting for data: not ready to leave shadow.` };
}
