import { formatDate, formatInr, formatInrFull } from "./format";
import { assumptionsLine, progressSentence, STATUS_LABEL } from "./copy";
import type { OutcomeBundle } from "./loaders";
import type { RiskBand } from "./risk";
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
  linked: { label: string; detail: string; valueText: string }[];
  form: { name: string; targetAmount: number; targetDate: string; priority: string; status: string; annualRatePct: number | null; plannedMonthly: number | null; notes: string; linkedAccountIds: string[]; linkedHoldingKeys: string[] };
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
  holdingOptions: { key: string; label: string; detail: string; valueText: string }[];
  accountOptions: { id: string; label: string }[];
};

const BAND_LABEL: Record<RiskBand, string> = { high: "High attention", medium: "Medium attention", low: "Low attention" };

export function toOutcomesViewModel(b: OutcomeBundle, opts: { canEdit: boolean; draftsOn: boolean; disclaimer: string }): OutcomesViewModel {
  const { score, review, subject } = b;
  const topReasons = [...score.factors].filter((f) => f.points > 0).sort((x, y) => y.points - x.points).slice(0, 3).map((f) => `${f.label}: ${f.input}`);

  const goals = b.goals.map((g): GoalCardModel => ({
    id: g.id, name: g.name, priority: g.priority, status: g.status, progressStatus: g.progress.status, statusLabel: STATUS_LABEL[g.progress.status], notes: g.notes,
    targetAmountText: formatInr(g.targetAmount), targetDateText: formatDate(g.targetDate), progressPct: g.progress.progressPct,
    currentValue: g.progress.currentValue, currentValueText: formatInr(g.progress.currentValue),
    requiredMonthlyText: g.progress.requiredMonthly === null ? null : formatInr(g.progress.requiredMonthly),
    requiredLowerText: g.progress.requiredMonthlyLowerRate === null ? null : formatInr(g.progress.requiredMonthlyLowerRate),
    projectedText: formatInr(g.progress.projectedAtAssumed),
    sentence: progressSentence(g.progress), assumptionsLine: assumptionsLine(g.progress),
    rate: g.progress.assumptions.annualRatePct, rateIsDefault: g.progress.assumptions.rateIsDefault, plannedMonthly: g.plannedMonthly, hasLinks: g.hasLinks,
    linked: g.linked.map((h) => ({ label: h.name, detail: h.accountLabel ?? "", valueText: formatInrFull(h.value) })),
    form: { name: g.name, targetAmount: g.targetAmount, targetDate: g.targetDate.toISOString().slice(0, 10), priority: g.priority, status: g.status, annualRatePct: g.annualRatePct, plannedMonthly: g.plannedMonthly, notes: g.notes ?? "", linkedAccountIds: g.linkedAccountIds, linkedHoldingKeys: g.linkedHoldingKeys },
  }));

  const accounts = new Map<string, string>();
  for (const h of b.holdings) if (!accounts.has(h.accountId)) accounts.set(h.accountId, h.accountLabel ?? "account");

  const summary = review.cadenceDays === null
    ? "No review cadence yet, because there are no holdings."
    : `${review.tierLabel}, reviewed every ${review.cadenceDays} days. ${subject.lastReviewAt ? `Last review ${formatDate(subject.lastReviewAt)}.` : "No review recorded yet."} ${review.overdue ? `${review.daysOverdue} days overdue.` : review.dueAt ? `Next due ${formatDate(review.dueAt)}.` : ""}`.trim();

  return {
    clientId: subject.clientId,
    canEdit: opts.canEdit,
    disclaimer: opts.disclaimer,
    score: { value: score.score, band: score.band, bandLabel: BAND_LABEL[score.band], topReasons: topReasons.length ? topReasons : ["Nothing is flagged by the rules."], factors: score.factors.map((f) => ({ label: f.label, weight: f.weight, points: f.points, input: f.input })) },
    review: { summary, overdue: review.overdue, tierLabel: review.tierLabel, hasCadence: review.cadenceDays !== null },
    goals,
    suggestions: b.suggestions.map((s) => ({ ruleKey: s.ruleKey, fingerprint: s.fingerprint, title: s.title, detail: s.detail, severity: s.severity, why: s.why, canAct: opts.canEdit, canDraft: opts.canEdit && opts.draftsOn && s.draft !== null })),
    holdingOptions: b.holdings.map((h) => ({ key: `${h.accountId}:${h.productId}`, label: h.name, detail: h.accountLabel ?? "", valueText: formatInrFull(h.value) })),
    accountOptions: [...accounts].map(([id, label]) => ({ id, label })),
  };
}
