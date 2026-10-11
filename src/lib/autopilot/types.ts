/**
 * Shapes shared by every Autopilot module. Money is a plain number in MAJOR units (rupees) of one account currency:
 * these modules rank and compare, they never move money. Every optional dataset that a platform may not report is
 * optional here, and a missing dataset is reported as "not available", never as zero.
 */

export type Platform = "meta" | "google";

export type CampaignInfo = {
  id: string;
  name: string;
  platform: Platform;
  /** The ad account the campaign belongs to (a firm may run several). */
  accountId?: string;
  status: "ACTIVE" | "PAUSED" | "UNKNOWN";
  /** The budget the team planned for the calendar month; null when nobody entered one. */
  plannedMonthlyBudget: number | null;
  dailyBudget?: number | null;
  /** Countries the campaign targets (ISO codes) when the platform reports them. */
  geoCountries?: string[];
  landingUrl?: string | null;
  negativeKeywordCount?: number | null;
  excludesExistingCustomers?: boolean | null;
  /** Google: share of impressions lost because the budget ran out (0..1). */
  lostImpressionShareBudget?: number | null;
};

/** One campaign on one day. */
export type DailyRow = {
  campaignId: string;
  /** YYYY-MM-DD in the account's own timezone. */
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  /** Leads as the platform counts them. */
  leads: number;
};

/**
 * What came of a campaign's clicks, exactly as the CampaignOutcomeProvider reports it (lib/attribution). Autopilot never works these out
 * itself: funded, KYC, revenue, cost per funded customer and return on spend are the provider's numbers, one definition for every module.
 */
export type CampaignOutcome = {
  /** Spend the provider counted for the campaign; null when none was synced. */
  spend: number | null;
  leads: number;
  contactedInSla: number | null;
  /** Of the leads whose window has closed. */
  contactedInSlaRate: number | null;
  kyc: number | null;
  funded: number;
  revenue: number;
  costPerLead: number | null;
  costPerFunded: number | null;
  roas: number | null;
  confidence: "high" | "medium" | "low" | "insufficient";
};

/** One lead in the CRM, with what happened after the click. No name, phone, email or PAN: none are needed here. */
export type LeadRecord = {
  campaignId: string | null;
  /** ISO instant the lead arrived. */
  arrivedAt: string;
  /** Minutes until the first human contact; null when not contacted yet. */
  contactMinutes: number | null;
  kycComplete: boolean;
  funded: boolean;
  /** Revenue to the firm so far (fees), major units. */
  revenue: number;
  /** Assets under management brought by the customer, major units. */
  aum: number;
  city: string | null;
  state: string | null;
};

export type KeywordRow = { campaignId: string; keyword: string; qualityScore: number | null; spend: number; leads: number };
export type SearchTermRow = { campaignId: string; term: string; spend: number; clicks: number; leads: number };
export type PlacementRow = { campaignId: string; placement: string; spend: number; impressions: number; clicks: number; leads: number };
/** One cell of the platform's hour-of-day report (dow 0 = Monday ... 6 = Sunday, hour 0..23, account-local). */
export type HourRow = { campaignId: string; dow: number; hour: number; spend: number; clicks: number; conversions: number };
export type RegionSpendRow = { kind: "city" | "state"; name: string; spend: number; clicks: number };
export type AudienceOverlapRow = { campaignA: string; campaignB: string; overlapPct: number };
export type AuctionRow = { campaignId: string; competitor: string; impressionShare: number; overlapRate: number; positionAboveRate: number; outrankingShare: number };
export type AdFatigueRow = { campaignId: string; adId: string; adName: string; ctrLast7: number; ctrPrior14: number; impressionsLast7: number; frequency?: number | null };

export type TrackingEvent = {
  name: string;
  platform: Platform;
  /** The event the closed loop needs to see (lead, KYC complete, funded). */
  expected: boolean;
  fires7d: number;
  /** Distinct dedup ids among those fires; fires above this are the same event counted twice. */
  uniqueIds7d: number;
  /** Fires that carried no dedup id at all. */
  withoutId7d: number;
};
export type OfflineImport = {
  platform: Platform;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  sent7d: number;
  rejected7d: number;
  lastError: string | null;
};
export type TrackingSignals = { events: TrackingEvent[]; offlineImports: OfflineImport[] };

export type AutopilotSettings = {
  /** The most the firm will pay for one funded customer, major units; null when not set. */
  targetCostPerFunded: number | null;
  /** First-contact promise in minutes. */
  contactSlaMinutes: number;
  /** Offset of the firm's timezone from UTC in minutes (IST = 330). */
  tzOffsetMinutes: number;
};

/** Everything the evaluators read. Optional datasets are present only when a platform reported them. */
export type AutopilotSnapshot = {
  /** ISO instant the snapshot was assembled. */
  asOf: string;
  /** ISO instant of the newest platform data in it; null when there is none. */
  dataThrough: string | null;
  /** First and last day (YYYY-MM-DD) the daily rows cover. */
  window: { since: string; until: string };
  campaigns: CampaignInfo[];
  days: DailyRow[];
  /** One entry per campaign id, straight from the provider. A campaign the provider has no row for is absent (nothing is invented). */
  outcomes: Record<string, CampaignOutcome>;
  /** The same, per look-back window in days (a rule says "over the last N days"), keyed by String(N): one provider call per distinct window. */
  windowOutcomes: Record<string, Record<string, CampaignOutcome>>;
  /** Lead cohorts from the provider: facts about each lead with no way back to a person (timing and region analysis only). */
  leads: LeadRecord[];
  keywords?: KeywordRow[];
  searchTerms?: SearchTermRow[];
  placements?: PlacementRow[];
  hours?: HourRow[];
  regionSpend?: RegionSpendRow[];
  audienceOverlap?: AudienceOverlapRow[];
  auction?: AuctionRow[];
  adFatigue?: AdFatigueRow[];
  tracking?: TrackingSignals;
  settings: AutopilotSettings;
};

export const DEFAULT_SETTINGS: AutopilotSettings = { targetCostPerFunded: null, contactSlaMinutes: 15, tzOffsetMinutes: 330 };

/** Control result states. unknown = not enough data to judge; not_applicable = does not apply to this account. */
export type ControlState = "pass" | "fail" | "unknown" | "not_applicable";
export type Severity = "critical" | "high" | "medium" | "informational";

export const CATEGORIES = [
  "Keywords", "Ad quality", "Conversions and tracking", "Budget and pacing", "Structure", "Targeting", "Bidding",
  "Landing page", "Attribution", "Schedule", "Placement", "Creatives", "Negatives", "Audience",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type ControlResult = {
  id: string;
  category: Category;
  severity: Severity;
  state: ControlState;
  /** One plain-English sentence a non-specialist can act on. */
  finding: string;
  /** The numbers behind the finding, as short readable strings. */
  evidence: string[];
  /** Campaign ids the finding is about, when it is about specific ones. */
  campaignIds?: string[];
};
