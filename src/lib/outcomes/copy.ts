import { checkCopy } from "@/lib/agents/guardrails";

import { formatInr, formatPct } from "./format";
import type { GoalProgress, GoalStatusLabel } from "./progress";

/**
 * Every word the Goals and Outcomes feature shows about money, in one place so one test can run all of it through the
 * same language guardrails the agents and ad copy use (src/lib/agents/guardrails.ts). The feature is illustrative
 * arithmetic on stated assumptions: none of this text may predict, promise or recommend.
 */

export const DEFAULT_DISCLAIMER =
  "Illustrative only. These figures are simple arithmetic on assumed rates that you can change. They are not a forecast or a prediction, and actual results will differ. Investments are subject to market risk.";

const DISCLAIMER_MAX = 600;

/** The mandatory disclaimer, optionally replaced through OUTCOMES_DISCLAIMER. A text that is blank, too long, fails the guardrails or drops the illustrative marker is ignored: the default is used. */
export function resolveDisclaimer(env: Record<string, string | undefined> = process.env): string {
  const configured = (env.OUTCOMES_DISCLAIMER ?? "").trim();
  if (!configured) return DEFAULT_DISCLAIMER;
  if (!checkCopy(configured, DISCLAIMER_MAX).ok) return DEFAULT_DISCLAIMER;
  if (!/illustrative/i.test(configured) || !/assum/i.test(configured)) return DEFAULT_DISCLAIMER;
  return configured;
}

export const STATUS_LABEL: Record<GoalStatusLabel, string> = {
  achieved: "Target reached",
  ahead: "Ahead at the assumed rate",
  on_track: "On track at the assumed rate",
  behind: "Behind at the assumed rate",
};

export const STATIC_COPY = {
  tabTitle: "Goals and outcomes",
  tabIntro: "Goals the relationship manager keeps with the customer. Progress is worked out from the linked holdings and the assumptions shown on each goal.",
  illustrativeBadge: "Illustrative",
  noGoals: "No goals recorded yet. Add one with the customer and link the holdings that belong to it.",
  noHoldingsLinked: "No holdings linked yet, so progress shows as zero. Link the holdings that belong to this goal.",
  assumptionsHeading: "Assumptions used",
  assumedRateLabel: "Assumed growth rate per year",
  plannedMonthlyLabel: "Stated monthly amount",
  defaultRateNote: "Default assumed rate. Change it on the goal.",
  holdingsReadOnly: "Linked holdings are read from the portfolio record and cannot be edited here.",
  attentionTitle: "Needs attention today",
  attentionIntro: "Customers with an overdue review, a gap or a signal worth a look, from fixed rules. Every line shows why.",
  attentionEmpty: "Nothing needs attention today.",
  suggestionsTitle: "Suggested next steps",
  suggestionsEmpty: "No suggestions from the rules right now.",
  rulesNote: "Rule based, no AI. Each suggestion lists the inputs it used and can be dismissed.",
  riskTitle: "Attention score",
  riskNote: "A weighted rule set, not a model. Higher means more attention is warranted. It is not a prediction about the customer.",
  tasksOnly: "Actions create tasks for the relationship manager. Nothing is sent to the customer.",
  draftNote: "A draft message goes to Agent drafts for a person to review. It is never sent automatically.",
} as const;

export function progressSentence(p: GoalProgress): string {
  if (p.status === "achieved") return `The linked holdings are worth ${formatInr(p.currentValue)}, which is at or above the ${formatInr(p.targetAmount)} target.`;
  if (p.assumptions.months === 0) return `The target date has been reached. The linked holdings are worth ${formatInr(p.currentValue)} against a ${formatInr(p.targetAmount)} target.`;
  const stated = p.assumptions.plannedMonthly && p.assumptions.plannedMonthly > 0 ? ` and ${formatInr(p.assumptions.plannedMonthly)} a month` : "";
  const required = p.requiredMonthly === null ? "" : ` To reach the target at the assumed rate, about ${formatInr(p.requiredMonthly)} a month would be needed.`;
  return `At an assumed growth rate of ${formatPct(p.assumptions.annualRatePct)} per year, the linked holdings${stated} would illustratively be worth ${formatInr(p.projectedAtAssumed)} by the target date.${required}`;
}

export function assumptionsLine(p: GoalProgress): string {
  const a = p.assumptions;
  const rate = `${formatPct(a.annualRatePct)} per year${a.rateIsDefault ? " (default)" : ""}`;
  const monthly = a.plannedMonthly && a.plannedMonthly > 0 ? `${formatInr(a.plannedMonthly)} a month` : "no monthly amount stated";
  return `Assumed growth rate ${rate}, ${monthly}, ${a.months} months to the target date. Lower case ${formatPct(a.lowerRatePct)} per year.`;
}

/** Templates for a suggested message. A person reviews and sends from Agent drafts; none is sent automatically. No amounts, no performance, no product talk. */
export const DRAFT_TEMPLATES = {
  review_overdue: "Hi {name}, it has been a while since we last went through your goals together. Would you like to set up a short call? Reply with a day and time that suits you.",
  goal_checkin: "Hi {name}, I would like to check in on the goals we discussed. Is there a good time this week for a short call?",
  key_date: "Hi {name}, one of the dates we noted together is coming up. Shall we find a few minutes to talk it through?",
} as const;
export type DraftTemplateKey = keyof typeof DRAFT_TEMPLATES;

export function renderDraft(key: DraftTemplateKey, firstName: string): string {
  return DRAFT_TEMPLATES[key].replace("{name}", firstName);
}
