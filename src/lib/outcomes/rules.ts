import { reviewStatus, DAY_MS } from "./cadence";
import { OUTCOME_CONFIG, type OutcomeConfig } from "./config";
import { formatDate, formatInr } from "./format";
import type { Dismissal, OutcomeSubject, Severity, Suggestion } from "./types";

/**
 * The rules-based next-best-action engine. NOT a model: a short, fixed list of checks over plain data, in code a
 * person can read. Each suggestion carries the inputs it used (`why`) so the relationship manager can see exactly
 * why it appeared, and can be dismissed. Suggestions are for people to act on as tasks; nothing here sends anything.
 */

const severityOf = (rank: number): Severity => (rank >= 70 ? "high" : rank >= 40 ? "medium" : "low");
const canBeMessaged = (c: OutcomeSubject["marketingConsent"]) => c === "given" || c === "not_recorded";

type Draft = Omit<Suggestion, "severity" | "rank"> & { rank: number };

const ruleReviewOverdue = (s: OutcomeSubject, now: Date, config: OutcomeConfig): Draft[] => {
  const r = reviewStatus({ aum: s.aum, lastReviewAt: s.lastReviewAt, createdAt: s.createdAt, now }, config);
  if (!r.overdue || r.cadenceDays === null) return [];
  const rank = Math.min(75, 45 + Math.round((r.daysOverdue / r.cadenceDays) * 30));
  return [{
    ruleKey: "review_overdue",
    fingerprint: s.lastReviewAt ? s.lastReviewAt.toISOString().slice(0, 10) : "never",
    title: "Review is overdue",
    detail: `${r.tierLabel} customers are reviewed every ${r.cadenceDays} days. This one is ${r.daysOverdue} days past due.`,
    rank,
    why: [
      { label: "Tier", value: `${r.tierLabel} (holdings worth ${formatInr(s.aum)})` },
      { label: "Review cadence", value: `every ${r.cadenceDays} days` },
      { label: "Last review", value: s.lastReviewAt ? formatDate(s.lastReviewAt) : `never recorded, counted from ${formatDate(s.createdAt)}` },
      { label: "Days overdue", value: String(r.daysOverdue) },
    ],
    task: { title: "Hold the portfolio and goals review", dueInDays: 3 },
    draft: canBeMessaged(s.marketingConsent) ? "review_overdue" : null,
  }];
};

const ruleIdleCash = (s: OutcomeSubject, now: Date, config: OutcomeConfig): Draft[] => {
  const cash = s.idleCash;
  if (!cash || cash.amount < config.rules.idleCashMin) return [];
  const share = cash.amount / (s.aum + cash.amount);
  if (share < config.rules.idleCashShare) return [];
  const rank = share >= 0.3 ? 62 : 48;
  return [{
    ruleKey: "idle_cash",
    // A new amount (to the nearest lakh) is a new situation.
    fingerprint: String(Math.round(cash.amount / 100_000)),
    title: "Uninvested cash noted",
    detail: `An estimated ${formatInr(cash.amount)} is sitting uninvested. Worth raising at the next conversation.`,
    rank,
    why: [
      { label: "Idle cash estimate", value: formatInr(cash.amount) },
      { label: "Source of estimate", value: cash.source ? { rm: "entered by the relationship manager", ai: "read from a conversation", import: "imported" }[cash.source] ?? cash.source : "not recorded" },
      { label: "Estimate dated", value: cash.updatedAt ? formatDate(cash.updatedAt) : "date not recorded" },
      { label: "Share of cash plus holdings", value: `${Math.round(share * 100)}%` },
      { label: "Threshold", value: `${formatInr(config.rules.idleCashMin)} and ${Math.round(config.rules.idleCashShare * 100)}% or more` },
    ],
    task: { title: "Ask about the uninvested cash and note what the customer plans", dueInDays: 5 },
    draft: null,
  }];
};

const ruleConcentration = (s: OutcomeSubject, now: Date, config: OutcomeConfig): Draft[] => {
  if (s.aum < config.rules.concentrationMinAum) return [];
  const top = [...s.allocation].sort((a, b) => b.pct - a.pct)[0];
  if (!top || top.pct < config.rules.concentrationTopPct) return [];
  return [{
    ruleKey: "concentration",
    fingerprint: top.bucket,
    title: "Holdings sit mostly in one asset class",
    detail: `${top.pct}% of the holdings are in ${top.bucket}. Worth looking at together at the next review.`,
    rank: top.pct >= 90 ? 55 : 42,
    why: [
      { label: "Largest asset class", value: `${top.bucket}, ${top.pct}%` },
      { label: "Threshold", value: `${config.rules.concentrationTopPct}% or more of holdings worth ${formatInr(config.rules.concentrationMinAum)} or more` },
      { label: "Holdings value", value: formatInr(s.aum) },
    ],
    task: { title: `Go through the asset mix (mostly ${top.bucket}) with the customer`, dueInDays: 10 },
    draft: null,
  }];
};

const ruleKycGap = (s: OutcomeSubject): Draft[] => {
  if (s.holdingCount === 0 || s.kycStatus === "APPROVED") return [];
  const state = s.kycStatus ? s.kycStatus.replace(/_/g, " ").toLowerCase() : "no KYC record";
  return [{
    ruleKey: "kyc_gap",
    fingerprint: s.kycStatus ?? "none",
    title: "KYC is not approved",
    detail: `The customer holds assets but KYC shows ${state}.`,
    rank: 85,
    why: [
      { label: "KYC status", value: state },
      { label: "Holdings", value: `${s.holdingCount} holdings worth ${formatInr(s.aum)}` },
    ],
    task: { title: "Close the KYC gap for this customer", dueInDays: 2 },
    draft: null,
  }];
};

const ruleConsentGap = (s: OutcomeSubject): Draft[] => {
  // Do-not-contact is a choice to respect, not a gap to chase.
  if (s.marketingConsent === "given" || s.marketingConsent === "do_not_contact" || s.aum <= 0) return [];
  const state = { withdrawn: "withdrawn", expired: "expired", not_recorded: "not recorded" }[s.marketingConsent];
  return [{
    ruleKey: "consent_gap",
    fingerprint: s.marketingConsent,
    title: "No usable consent for outreach",
    detail: `Marketing consent is ${state}, so messages to this customer are held back.`,
    rank: s.marketingConsent === "withdrawn" ? 30 : 50,
    why: [
      { label: "Marketing consent", value: state },
      { label: "Effect", value: "message drafts are not offered while consent is not in place" },
    ],
    task: { title: s.marketingConsent === "withdrawn" ? "Note the withdrawal and do not contact for marketing" : "Ask the customer whether they consent to outreach", dueInDays: 7 },
    draft: null,
  }];
};

const ruleKeyDates = (s: OutcomeSubject, now: Date, config: OutcomeConfig): Draft[] => {
  const out: Draft[] = [];
  for (const g of s.goals) {
    const days = Math.ceil((g.targetDate.getTime() - now.getTime()) / DAY_MS);
    if (days < 0 || days > config.rules.goalDateWithinDays || g.progress === "achieved") continue;
    out.push({
      ruleKey: "key_date", fingerprint: `goal:${g.id}`,
      title: `Goal date in ${days} days`, detail: `The target date for "${g.name}" is ${formatDate(g.targetDate)}.`,
      rank: days <= 30 ? 68 : 46,
      why: [
        { label: "Goal", value: g.name },
        { label: "Target date", value: formatDate(g.targetDate) },
        { label: "Days to go", value: String(days) },
        { label: "Window", value: `within ${config.rules.goalDateWithinDays} days` },
      ],
      task: { title: `Prepare for the "${g.name}" goal date`, dueInDays: Math.max(1, Math.min(7, days)) },
      draft: canBeMessaged(s.marketingConsent) ? "key_date" : null,
    });
  }
  for (const c of s.commitments) {
    const days = Math.ceil((c.dueAt.getTime() - now.getTime()) / DAY_MS);
    if (days > config.rules.commitmentWithinDays) continue;
    out.push({
      ruleKey: "key_date", fingerprint: `commitment:${c.text}`,
      title: days < 0 ? "A promise to the customer is overdue" : "A promise to the customer is due soon", detail: c.text,
      rank: days < 0 ? 78 : 58,
      why: [
        { label: "Promise", value: c.text },
        { label: "Due", value: formatDate(c.dueAt) },
        { label: days < 0 ? "Days late" : "Days to go", value: String(Math.abs(days)) },
      ],
      task: { title: `Follow up: ${c.text}`.slice(0, 140), dueInDays: 1 },
      draft: null,
    });
  }
  return out;
};

const ruleGoalBehind = (s: OutcomeSubject): Draft[] =>
  s.goals
    .filter((g) => g.progress === "behind")
    .map((g) => ({
      ruleKey: "goal_behind", fingerprint: g.id,
      title: "A goal is behind at the assumed rate", detail: `"${g.name}" is behind on the assumptions set for it. A review can adjust the plan or the assumptions.`,
      rank: 52,
      why: [
        { label: "Goal", value: g.name },
        { label: "Status", value: "behind at the assumed rate (illustrative)" },
        { label: "Target date", value: formatDate(g.targetDate) },
      ],
      task: { title: `Review the "${g.name}" goal with the customer`, dueInDays: 7 },
      draft: canBeMessaged(s.marketingConsent) ? ("goal_checkin" as const) : null,
    }));

export function evaluateRules(subject: OutcomeSubject, now: Date, config: OutcomeConfig = OUTCOME_CONFIG): Suggestion[] {
  const drafts = [
    ...ruleKycGap(subject),
    ...ruleReviewOverdue(subject, now, config),
    ...ruleIdleCash(subject, now, config),
    ...ruleConcentration(subject, now, config),
    ...ruleConsentGap(subject),
    ...ruleKeyDates(subject, now, config),
    ...ruleGoalBehind(subject),
  ];
  return drafts
    .map((d): Suggestion => ({ ...d, severity: severityOf(d.rank) }))
    .sort((a, b) => b.rank - a.rank || a.ruleKey.localeCompare(b.ruleKey) || a.fingerprint.localeCompare(b.fingerprint));
}

/** Drops the suggestions an RM dismissed. A dismissal matches one rule in one situation (its fingerprint); a changed situation shows again. */
export function applyDismissals(suggestions: Suggestion[], dismissed: readonly Dismissal[]): Suggestion[] {
  const hidden = new Set(dismissed.map((d) => `${d.ruleKey}|${d.fingerprint}`));
  return suggestions.filter((s) => !hidden.has(`${s.ruleKey}|${s.fingerprint}`));
}
