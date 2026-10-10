/** The ad channels the Marketing workspace reports on. Each is read-only and keyed by its provider id in AdCampaignDaily. */
export type AdChannel = "meta" | "google";

export const AD_CHANNELS: readonly AdChannel[] = ["meta", "google"];

export const CHANNEL_LABEL: Record<AdChannel, string> = { meta: "Meta", google: "Google" };

export function isAdChannel(value: unknown): value is AdChannel {
  return value === "meta" || value === "google";
}
