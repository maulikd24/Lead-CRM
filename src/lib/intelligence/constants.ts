// Vocabulary for the customer-intelligence layer. Kept free of Prisma/React so engines, UI and the AI tool
// schemas all import the same lists.

export const CUSTOMER_CATEGORIES = ["Broking", "Wealth", "Mutual Funds", "HNI", "Existing Customer", "Support", "Other"] as const;
export type CustomerCategory = (typeof CUSTOMER_CATEGORIES)[number];

export const ASSET_CLASSES = ["Mutual Funds", "PMS", "AIF", "Bonds", "Broking", "Global Investments", "Tax Planning"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export type Level = "HIGH" | "MEDIUM" | "LOW";
export const LEVEL_LABEL: Record<Level, string> = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" };

// Journey: Lead / Signup → Contact → KYC → Value Unlock → Fund / Transfer → First Transaction → Ongoing Relationship.
export const LIFECYCLE_STAGES = ["Lead", "Contacted", "KYC", "Value unlock", "Funded", "Activated", "Active", "Dormant", "Lost"] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const NBA_PROGRAMMES = [
  "Complete KYC",
  "Fund account",
  "First transaction",
  "Demat portfolio transfer",
  "Mutual fund portfolio transfer",
  "Wealth Health Review",
  "Portfolio rebalance",
  "MF / SIP opportunity",
  "PMS / AIF opportunity",
  "Broking activation / reactivation",
  "Tax-planning discussion",
  "Service / relationship follow-up",
  "No Action / Do Not Pitch",
] as const;
export type NbaProgramme = (typeof NBA_PROGRAMMES)[number];

export type NbaAction = "Call" | "WhatsApp" | "Review" | "Follow-up" | "No Action";
export type NbaPriority = "High" | "Medium" | "Low";
export type NbaOwner = "RM" | "CRM" | "AI Bot" | "Support";
export type NbaTiming = "Today" | "This Week" | "Later" | "Trigger-based";

export const SEGMENTS = {
  no_contact: "Not contacted",
  kyc_dropoff: "KYC drop-off",
  unfunded: "Unfunded after KYC",
  newly_activated: "Newly activated",
  dormant: "Dormant",
  cross_sell: "Cross-sell opportunity",
  review_due: "Portfolio review due",
  service_issue: "Service issue open",
  commitment_overdue: "Commitment overdue",
} as const;
export type SegmentKey = keyof typeof SEGMENTS;

export const OUTCOMES = [
  { value: "INTERESTED", label: "Interested" },
  { value: "NOT_INTERESTED", label: "Not interested" },
  { value: "FOLLOW_UP", label: "Follow up" },
  { value: "CONVERTED", label: "Converted" },
  { value: "NOT_RELEVANT", label: "Not relevant" },
  { value: "RM_HANDOVER", label: "Needs RM (handover)" },
  { value: "SERVICE_ISSUE", label: "Service issue" },
] as const;

export const OUTCOME_CHANNELS = ["CALL", "WHATSAPP", "MEETING", "EMAIL", "AI_BOT", "OTHER"] as const;

/** Product categories (Prisma ProductCategory) → the asset class a holding counts toward. */
export const PRODUCT_CATEGORY_ASSET_CLASS: Record<string, AssetClass | null> = {
  MUTUAL_FUND: "Mutual Funds",
  PMS: "PMS",
  AIF: "AIF",
  BOND: "Bonds",
  FIXED_DEPOSIT: "Bonds",
  EQUITY: "Broking",
  INSURANCE: null,
  NPS: null,
  OTHER: null,
};

/** Opportunity product → asset class. */
export const OPPORTUNITY_ASSET_CLASS: Record<string, AssetClass | null> = {
  MUTUAL_FUND: "Mutual Funds",
  BROKING: "Broking",
  PMS: "PMS",
  AIF: "AIF",
  BONDS: "Bonds",
  FIXED_INCOME: "Bonds",
  UNLISTED_PRE_IPO: null,
  OTHER: null,
};

export function isAssetClass(value: string | null | undefined): value is AssetClass {
  return !!value && (ASSET_CLASSES as readonly string[]).includes(value);
}
