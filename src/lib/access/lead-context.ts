import { can } from "./policy";

/**
 * What an RM (or their manager) may see about where a lead came from: the campaign name and the source label, for
 * context. Never spend, cost per lead, return on spend, budgets, ad accounts or platform ids: those are marketing's.
 *
 * It is a whitelist on purpose. Lead intake stores whatever attribution the ad platform sent, so the screen must pick
 * what it shows rather than hide what it knows to be sensitive.
 */
export const LEAD_LABEL_KEYS: readonly string[] = ["campaign", "campaign_name", "utm_campaign", "utm_source", "utm_medium", "platform", "adset_name"];

export function leadCampaignRows(role: string | null | undefined, attribution: unknown): [string, string][] {
  if (!can(role, "lead-campaign-label", "view")) return [];
  if (!attribution || typeof attribution !== "object" || Array.isArray(attribution)) return [];
  const rows: [string, string][] = [];
  for (const [key, value] of Object.entries(attribution as Record<string, unknown>)) {
    if (LEAD_LABEL_KEYS.includes(key) && typeof value === "string" && value.trim()) rows.push([key, value]);
  }
  return rows;
}
