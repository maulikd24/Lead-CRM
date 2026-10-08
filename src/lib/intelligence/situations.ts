import type { CustomerFacts } from "./facts";
import type { AssetClass, LifecycleStage } from "./constants";

const DAY = 24 * 60 * 60 * 1000;

// Thresholds are deliberately plain constants: easy to read, tune and explain to the business.
export const EXTERNAL_PORTFOLIO_LARGE = 2_500_000; // ₹25 lakh held elsewhere
export const MF_TRANSFER_MIN = 500_000; // ₹5 lakh of mutual funds that could move across
export const IDLE_CASH_MIN = 500_000; // ₹5 lakh idle
export const REVIEW_STALE_DAYS = 180;
export const RECENT_INTEREST_DAYS = 14;

export type SituationKey =
  | "kyc_pending"
  | "funded_no_first_transaction"
  | "large_portfolio_outside"
  | "mf_transfer_available"
  | "high_idle_cash"
  | "portfolio_concentration"
  | "no_portfolio_review"
  | "recent_interest"
  | "dormant_trading"
  | "service_issue"
  | "commitment_pending";

export type Situation = {
  key: SituationKey;
  label: string;
  severity: "high" | "medium" | "info";
  detail: string;
  assetClass?: AssetClass;
};

const inr = (value: number) => (value >= 10_000_000 ? `₹${(value / 10_000_000).toFixed(2)} Cr` : value >= 100_000 ? `₹${(value / 100_000).toFixed(1)} L` : `₹${Math.round(value).toLocaleString("en-IN")}`);
const daysAgo = (now: Date, date: Date) => Math.floor((now.getTime() - date.getTime()) / DAY);

/** The situations worth acting on right now — the "what is currently important" list. */
export function detectSituations(f: CustomerFacts, lifecycle: LifecycleStage): Situation[] {
  const out: Situation[] = [];
  const now = f.now;
  const active = f.client.status === "ACTIVE" || f.client.status === "COMPLETED";
  if (!active || lifecycle === "Lost") return out;

  if (!f.kycApproved && lifecycle !== "Active" && lifecycle !== "Activated" && lifecycle !== "Dormant") {
    out.push({ key: "kyc_pending", label: "KYC pending", severity: daysAgo(now, f.stage.enteredAt) >= 3 ? "high" : "medium", detail: f.onboarding.detail });
  }

  if (lifecycle === "Funded") {
    const since = f.funding.firstPaymentAt ?? f.stage.enteredAt;
    const days = daysAgo(now, since);
    out.push({ key: "funded_no_first_transaction", label: "Funded, no first transaction", severity: days > 3 ? "high" : "medium", detail: `Account funded ${days} day${days === 1 ? "" : "s"} ago and nothing traded yet.` });
  }

  if ((f.intel.externalPortfolio ?? 0) >= EXTERNAL_PORTFOLIO_LARGE && f.intel.dematTransferStatus !== "COMPLETED") {
    out.push({ key: "large_portfolio_outside", label: "Large portfolio outside Allvest", severity: "medium", detail: `About ${inr(f.intel.externalPortfolio!)} is held elsewhere.` });
  }
  if ((f.intel.mfTransfer ?? 0) >= MF_TRANSFER_MIN && f.intel.mfTransferStatus !== "COMPLETED") {
    out.push({ key: "mf_transfer_available", label: "Mutual-fund portfolio available for transfer", severity: "medium", detail: `About ${inr(f.intel.mfTransfer!)} of mutual funds could be moved to Allvest.`, assetClass: "Mutual Funds" });
  }
  if ((f.intel.idleCash ?? 0) >= IDLE_CASH_MIN) {
    out.push({ key: "high_idle_cash", label: "High idle cash", severity: "medium", detail: `About ${inr(f.intel.idleCash!)} is sitting idle.` });
  }

  if (f.portfolio.aum >= 500_000 && f.portfolio.concentration.label === "Concentrated") {
    out.push({ key: "portfolio_concentration", label: "Portfolio concentration", severity: "medium", detail: `Portfolio is concentrated (index ${f.portfolio.concentration.hhi.toFixed(2)}).` });
  }

  const ongoing = lifecycle === "Active" || lifecycle === "Activated" || lifecycle === "Dormant" || lifecycle === "Funded";
  if (f.portfolio.aum > 0 && ongoing) {
    const reviewedDays = f.wealth.checkupCompletedAt ? daysAgo(now, f.wealth.checkupCompletedAt) : null;
    if (reviewedDays === null || reviewedDays > REVIEW_STALE_DAYS) {
      out.push({
        key: "no_portfolio_review",
        label: "No recent portfolio review",
        severity: f.portfolio.aum >= 10_000_000 ? "high" : "medium",
        detail: reviewedDays === null ? `Portfolio of ${inr(f.portfolio.aum)} has never had a Wealth Health Review.` : `Last reviewed ${reviewedDays} days ago.`,
      });
    }
  }

  for (const insight of f.insights) {
    if (insight.kind !== "INTEREST" || daysAgo(now, insight.occurredAt) > RECENT_INTEREST_DAYS) continue;
    const handled = f.outcomes.some((o) => o.assetClass === insight.assetClass && o.createdAt > insight.occurredAt);
    if (handled) continue;
    out.push({ key: "recent_interest", label: `Recently showed interest${insight.assetClass ? ` in ${insight.assetClass}` : ""}`, severity: "high", detail: insight.text, assetClass: (insight.assetClass ?? undefined) as AssetClass | undefined });
    break;
  }

  if (lifecycle === "Dormant" && f.trading.last) {
    out.push({ key: "dormant_trading", label: "Dormant trading customer", severity: "medium", detail: `Last traded ${daysAgo(now, f.trading.last)} days ago.` });
  }

  const complaints = f.insights.filter((i) => i.kind === "COMPLAINT" && i.status === "OPEN");
  if (complaints.length > 0) {
    out.push({ key: "service_issue", label: "Service issue requiring attention", severity: "high", detail: complaints[0].text });
  } else if (f.negativeReviewRecent) {
    out.push({ key: "service_issue", label: "Recent conversation went badly", severity: "medium", detail: "A recent call or chat was scored negative or low quality — check in before selling." });
  }

  const commitments = f.insights.filter((i) => i.kind === "COMMITMENT" && i.status === "OPEN");
  if (commitments.length > 0) {
    const overdue = commitments.filter((c) => c.dueAt && c.dueAt < now);
    out.push({
      key: "commitment_pending",
      label: overdue.length > 0 ? "RM commitment overdue" : "RM commitment pending",
      severity: overdue.length > 0 ? "high" : "medium",
      detail: (overdue[0] ?? commitments[0]).text,
    });
  }
  return out;
}
