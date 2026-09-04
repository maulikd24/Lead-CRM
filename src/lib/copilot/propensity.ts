import { HNI_INVESTMENT_THRESHOLD } from "@/lib/assignment/routing-engine";

export type PropensityScore = { score: number; reasons: string[] };

// The 15 optional Client fields that make up "profile completeness" — deliberately mirrors the
// fields an RM would fill in over time as a lead is qualified, not just onboarding-mandatory ones.
export const PROPENSITY_PROFILE_FIELDS = [
  "email",
  "pan",
  "ckycRef",
  "region",
  "preferredLanguage",
  "city",
  "state",
  "clientType",
  "leadSource",
  "productInterest",
  "existingBroker",
  "tradingExperience",
  "expectedInvestment",
  "referralSource",
  "notes",
] as const;

const LEAD_SOURCE_SCORES: Record<string, number> = {
  Referral: 25,
  "Website/Blog Post": 18,
  "Google Ads": 12,
  "Meta Ads": 10,
  "Offline Marketing": 8,
};

const LEAD_SOURCE_REASONS: Record<string, string> = {
  Referral: "Referral lead — highest-converting source",
  "Website/Blog Post": "Inbound organic lead",
  "Google Ads": "Paid search lead",
  "Meta Ads": "Paid social lead",
  "Offline Marketing": "Offline marketing lead",
};

/**
 * Deterministic, additive propensity score (0-100) estimating how likely a lead is to
 * convert/fund — not a learned/ML model, every score comes with the exact reasons that
 * produced it. Fully independent of priority/health: does not feed into stage gating,
 * Next Best Action, or worklist sort order.
 */
export function computePropensityScore(input: {
  leadSource: string | null;
  engagementActivityCount: number;
  profileFieldsFilled: number;
  profileFieldsTotal: number;
  expectedInvestment: number | null;
  clientType: string | null;
}): PropensityScore {
  let score = 0;
  const reasons: string[] = [];

  const leadSourceScore = input.leadSource ? (LEAD_SOURCE_SCORES[input.leadSource] ?? 5) : 5;
  score += leadSourceScore;
  reasons.push(
    (input.leadSource ? LEAD_SOURCE_REASONS[input.leadSource] : undefined) ?? "Lead source not recorded",
  );

  if (input.engagementActivityCount >= 6) {
    score += 25;
    reasons.push("Highly engaged — frequent contact");
  } else if (input.engagementActivityCount >= 3) {
    score += 18;
    reasons.push("Moderate engagement");
  } else if (input.engagementActivityCount >= 1) {
    score += 10;
    reasons.push("Limited engagement so far");
  }

  const completeness = input.profileFieldsTotal > 0 ? input.profileFieldsFilled / input.profileFieldsTotal : 0;
  score += Math.round(completeness * 25);
  if (completeness < 0.4) {
    reasons.push("Profile mostly incomplete");
  } else if (completeness >= 0.8) {
    reasons.push("Profile well documented");
  }

  if (input.clientType === "U-HNI") {
    score += 25;
    reasons.push("Ultra-HNI client type");
  } else if (input.clientType === "HNI") {
    score += 22;
    reasons.push("HNI client type");
  } else if (input.expectedInvestment != null && input.expectedInvestment >= HNI_INVESTMENT_THRESHOLD) {
    score += 20;
    reasons.push("Expected investment meets HNI threshold");
  } else if (input.expectedInvestment != null && input.expectedInvestment >= HNI_INVESTMENT_THRESHOLD / 2) {
    score += 12;
    reasons.push("Sizeable expected investment");
  } else if (input.expectedInvestment != null && input.expectedInvestment > 0) {
    score += 6;
  }

  return { score: Math.min(100, score), reasons };
}
