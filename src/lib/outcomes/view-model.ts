import { formatDate, formatInr } from "./format";
import { ASSET_CLASSES, assetClassOf, classLabel } from "./goals";
import { assumptionsLine, progressSentence, STATUS_LABEL } from "./copy";
import type { OutcomeBundle } from "./loaders";
import { topScoreReasons, type RiskBand } from "./risk";
import type { GoalStatusLabel } from "./progress";
import type { Severity, WhyInput } from "./types";

/**
 * Everything the Goals and outcomes tab shows, as plain serialisable data with the words already written (dates as
 * strings, no functions), so the server can hand it to client components. All wording lives in copy.ts and the engines.
 */

export type GoalCardModel = {
  id: string;
  name: string;
  priority: string;
  status: string;
  progressStatus: GoalStatusLabel;
  statusLabel: string;
  notes: string | null;
  targetAmountText: string;
  targetDateText: string;
  progressPct: number;
  currentValue: number;
  currentValueText: string;
  requiredMonthlyText: string | null;
  requiredLowerText: string | null;
  projectedText: string;
  sentence: string;
  assumptionsLine: string;
  rate: number;
  rateIsDefault: boolean;
  plannedMonthly: number | null;
  hasLinks: boolean;
  /** Asset classes the goal reads from, with the class total only (never a product, account or holding). */
  linkedClasses: { key: string; label: string; valueText: string }[];
  form: { name: string; targetAmount: number; targetDate: string; priority: string; status: string; annualRatePct: number | null; plannedMonthly: number | null; notes: string; linkedAssetClasses: string[] };
};

export type SuggestionModel = { ruleKey: string; fingerprint: string; title: string; detail: string; severity: Severity; why: WhyInput[]; canAct: boolean; canDraft: boolean };

export type OutcomesViewModel = {
  clientId: string;
  canEdit: boolean;
  disclaimer: string;
  score: { value: number; band: RiskBand; bandLabel: string; topReasons: string[]; factors: { label: string; weight: number; points: number; input: string }[] };
  review: { summary: string; overdue: boolean; tierLabel: string | null; hasCadence: boolean };
  goals: GoalCardModel[];
  suggestions: SuggestionModel[];
  /** Aggregates the goals are linked to: total AUM, last trading date, and each asset class as a share of AUM. No individual holdings. */
  portfolio: { aumText: string; lastTradingDateText: string | null; classes: { key: string; label: string; sharePct: number }[] };
  classOptions: { key: string; label: string; sharePct: number }[];
};

const BAND_LABEL: Record<RiskBand, string> = { high: "High attention", medium: "Medium attention", low: "Low attention" };

export function toOutcomesViewModel(b: OutcomeBundle, opts: { canEdit: boolean; draftsOn: boolean; disclaimer: string }): OutcomesViewModel {
  const { score, review, subject } = b;

  const goals = b.goals.map((g): GoalCardModel => ({
    id: g.id, name: g.name, priority: g.priority, status: g.status, progressStatus: g.progress.status, statusLabel: STATUS_LABEL[g.progress.status], notes: g.notes,
    targetAmountText: formatInr(g.targetAmount), targetDateText: formatDate(g.targetDate), progressPct: g.progress.progressPct,
    currentValue: g.progress.currentValue, currentValueText: formatInr(g.progress.currentValue),
    requiredMonthlyText: g.progress.requiredMonthly === null ? null : formatInr(g.progress.requiredMonthly),
    requiredLowerText: g.progress.requiredMonthlyLowerRate === null ? null : formatInr(g.progress.requiredMonthlyLowerRate),
    projectedText: formatInr(g.progress.projectedAtAssumed),
    sentence: progressSentence(g.progress), assumptionsLine: assumptionsLine(g.progress),
    rate: g.progress.assumptions.annualRatePct, rateIsDefault: g.progress.assumptions.rateIsDefault, plannedMonthly: g.plannedMonthly, hasLinks: g.hasLinks,
    linkedClasses: g.linkedClasses.map((c) => ({ key: c.key, label: classLabel(c.key), valueText: formatInr(c.value) })),
    form: { name: g.name, targetAmount: g.targetAmount, targetDate: g.targetDate.toISOString().slice(0, 10), priority: g.priority, status: g.status, annualRatePct: g.annualRatePct, plannedMonthly: g.plannedMonthly, notes: g.notes ?? "", linkedAssetClasses: g.linkedClasses.map((c) => c.key) },
  }));

  const total = b.holdings.reduce((sum, h) => sum + h.value, 0);
  const classes = ASSET_CLASSES.map((c) => ({ key: c.key as string, label: c.label as string, sharePct: total > 0 ? Math.round((b.holdings.filter((h) => assetClassOf(h.category) === c.key).reduce((sum, h) => sum + h.value, 0) / total) * 1000) / 10 : 0 }));

  const summary = review.cadenceDays === null
    ? "No review cadence yet, because there are no holdings."
    : `${review.tierLabel}, reviewed every ${review.cadenceDays} days. ${subject.lastReviewAt ? `Last review ${formatDate(subject.lastReviewAt)}.` : "No review recorded yet."} ${review.overdue ? `${review.daysOverdue} days overdue.` : review.dueAt ? `Next due ${formatDate(review.dueAt)}.` : ""}`.trim();

  return {
    clientId: subject.clientId,
    canEdit: opts.canEdit,
    disclaimer: opts.disclaimer,
    score: { value: score.score, band: score.band, bandLabel: BAND_LABEL[score.band], topReasons: topScoreReasons(score), factors: score.factors.map((f) => ({ label: f.label, weight: f.weight, points: f.points, input: f.input })) },
    review: { summary, overdue: review.overdue, tierLabel: review.tierLabel, hasCadence: review.cadenceDays !== null },
    goals,
    suggestions: b.suggestions.map((s) => ({ ruleKey: s.ruleKey, fingerprint: s.fingerprint, title: s.title, detail: s.detail, severity: s.severity, why: s.why, canAct: opts.canEdit, canDraft: opts.canEdit && opts.draftsOn && s.draft !== null })),
    portfolio: { aumText: formatInr(subject.aum), lastTradingDateText: subject.lastTransactionAt ? formatDate(subject.lastTransactionAt) : null, classes },
    classOptions: classes,
  };
}
