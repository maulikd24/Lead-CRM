/**
 * Every number a control compares against. These are DEFAULTS chosen by us, not industry facts: they are shown as
 * "default" wherever they appear and are meant to be changed (Settings) once the firm has its own history.
 */
export type Thresholds = {
  /** Least spend (major units) a campaign, term, keyword, placement or hour cell needs before it can be judged. */
  minSpend: number;
  /** Least leads in a group before a rate computed from them is trusted. */
  minLeads: number;
  /** Least clicks before a click-through or click-to-lead rate is trusted. */
  minClicks: number;
  /** Least impressions before a click-through rate is trusted. */
  minImpressions: number;
  lowCtr: number;
  lowClickToLead: number;
  cplRiseRatio: number;
  qualityScoreLow: number;
  wastedShareFail: number;
  pacingOverTolerance: number;
  pacingUnderTolerance: number;
  /** Days of the month that must have passed before pacing is judged. */
  pacingMinDays: number;
  unattributedShareFail: number;
  platformCrmGap: number;
  audienceOverlapFail: number;
  fatigueCtrDrop: number;
  fatigueFrequency: number;
  contactSlaShareFail: number;
  /** Leads needed in a time band before a schedule or staffing recommendation is made. */
  bandMinLeads: number;
  duplicateRatio: number;
  importRejectRate: number;
  importStaleDays: number;
  /** Words that, in a search term, mark it as not someone looking to invest. */
  irrelevantTermWords: string[];
  /** Placement names that are not worth paying for in a lead campaign. */
  junkPlacementWords: string[];
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  minSpend: 1000,
  minLeads: 30,
  minClicks: 100,
  minImpressions: 2000,
  lowCtr: 0.005,
  lowClickToLead: 0.02,
  cplRiseRatio: 0.3,
  qualityScoreLow: 4,
  wastedShareFail: 0.15,
  pacingOverTolerance: 0.1,
  pacingUnderTolerance: 0.15,
  pacingMinDays: 5,
  unattributedShareFail: 0.25,
  platformCrmGap: 0.25,
  audienceOverlapFail: 0.3,
  fatigueCtrDrop: 0.3,
  fatigueFrequency: 4,
  contactSlaShareFail: 0.7,
  bandMinLeads: 30,
  duplicateRatio: 1.1,
  importRejectRate: 0.2,
  importStaleDays: 3,
  irrelevantTermWords: ["free", "jobs", "job", "career", "salary", "login", "customer care", "complaint", "scam", "fraud", "course", "tutorial", "pdf", "meaning"],
  junkPlacementWords: ["audience network", "app install", "games", "rewarded", "unknown"],
};
