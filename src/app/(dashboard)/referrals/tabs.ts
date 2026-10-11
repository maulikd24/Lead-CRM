import { parseTabParam } from "@/components/workspace";
import type { Role } from "@/generated/prisma/client";
import { can, type Action, type Area } from "@/lib/access/policy";

export const REFERRAL_TAB_KEYS = ["overview", "referrers", "rewards", "rules", "statements"] as const;
export type ReferralTab = (typeof REFERRAL_TAB_KEYS)[number];
export const REFERRAL_TAB_LABEL: Record<ReferralTab, string> = { overview: "Overview", referrers: "Referrers", rewards: "Rewards ledger", rules: "Rules", statements: "Statements" };

export const parseReferralTab = (v: string | string[] | undefined): ReferralTab => parseTabParam(v, REFERRAL_TAB_KEYS, "overview") as ReferralTab;

/** The sections a role may open. Marketing sees the programme at campaign level (funnel, reward totals, rules); named referrers, ledger rows and statements stay with finance and admin. */
const TAB_AREA: Record<ReferralTab, readonly [Area, Action]> = {
  overview: ["referral-program", "view"],
  referrers: ["referral-referrers", "view"],
  rewards: ["referral-statements", "view"],
  rules: ["referral-program", "view"],
  statements: ["referral-statements", "view"],
};

export function referralTabsFor(role: Role): ReferralTab[] {
  return REFERRAL_TAB_KEYS.filter((k) => can(role, TAB_AREA[k][0], TAB_AREA[k][1]));
}
