import { parseTabParam } from "@/components/workspace";

export const REFERRAL_TAB_KEYS = ["overview", "referrers", "rewards", "rules", "statements"] as const;
export type ReferralTab = (typeof REFERRAL_TAB_KEYS)[number];
export const REFERRAL_TAB_LABEL: Record<ReferralTab, string> = { overview: "Overview", referrers: "Referrers", rewards: "Rewards ledger", rules: "Rules", statements: "Statements" };

export const parseReferralTab = (v: string | string[] | undefined): ReferralTab => parseTabParam(v, REFERRAL_TAB_KEYS, "overview") as ReferralTab;
