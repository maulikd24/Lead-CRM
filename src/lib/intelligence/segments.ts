import type { CustomerFacts } from "./facts";
import type { LifecycleStage, NbaProgramme, SegmentKey } from "./constants";
import type { Situation } from "./situations";
import type { NextBestActionV2 } from "./nba";

const HOUR = 60 * 60 * 1000;

const CROSS_SELL: NbaProgramme[] = ["MF / SIP opportunity", "PMS / AIF opportunity", "Tax-planning discussion", "Demat portfolio transfer", "Mutual fund portfolio transfer"];

/** Which saved segments this customer is in right now. Entering a segment is what a journey can be triggered by. */
export function evaluateSegments(f: CustomerFacts, lifecycle: LifecycleStage, nba: NextBestActionV2, situations: Situation[]): Set<SegmentKey> {
  const out = new Set<SegmentKey>();
  const stageAgeH = (f.now.getTime() - f.stage.enteredAt.getTime()) / HOUR;
  const ageH = (f.now.getTime() - f.client.createdAt.getTime()) / HOUR;
  const live = f.client.status === "ACTIVE" || f.client.status === "COMPLETED";
  if (!live) return out;

  if (lifecycle === "Lead" && ageH >= 24) out.add("no_contact");
  if (lifecycle === "KYC" && stageAgeH >= 48) out.add("kyc_dropoff");
  if (lifecycle === "Value unlock" && stageAgeH >= 72) out.add("unfunded");
  if (lifecycle === "Activated") out.add("newly_activated");
  if (lifecycle === "Dormant") out.add("dormant");
  if (CROSS_SELL.includes(nba.programme)) out.add("cross_sell");
  if (situations.some((s) => s.key === "no_portfolio_review")) out.add("review_due");
  if (situations.some((s) => s.key === "service_issue" && s.severity === "high")) out.add("service_issue");
  if (situations.some((s) => s.key === "commitment_pending" && s.severity === "high")) out.add("commitment_overdue");
  return out;
}
