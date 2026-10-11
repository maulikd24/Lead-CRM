/**
 * The channel kinds a campaign can run on. `maxChars` is the length of the whole copy including its disclaimer (what a
 * person would paste into the ad tool), so a short channel is checked against the short disclaimer line.
 */
export const CHANNEL_KEYS = ["click_to_whatsapp", "search_ad", "seo_content", "referral_community", "short_video", "email", "partner"] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

export type ChannelDef = {
  label: string;
  /** What a person should know about the channel, one line. */
  hint: string;
  utmSource: string;
  utmMedium: string;
  maxChars: number;
  /** Short channels carry the one-line disclaimer; long ones carry the full text. */
  disclaimer: "short" | "full";
};

export const CHANNELS: Record<ChannelKey, ChannelDef> = {
  click_to_whatsapp: { label: "Click-to-WhatsApp ad", hint: "An ad whose button opens a WhatsApp chat with a prefilled message.", utmSource: "meta", utmMedium: "click_to_whatsapp", maxChars: 250, disclaimer: "short" },
  search_ad: { label: "Search ad", hint: "Two description lines of 90 characters each.", utmSource: "google", utmMedium: "cpc", maxChars: 180, disclaimer: "short" },
  seo_content: { label: "SEO and answer-engine content", hint: "A page or answer written to be found by search and AI assistants.", utmSource: "organic", utmMedium: "seo", maxChars: 5000, disclaimer: "full" },
  referral_community: { label: "Referrals and community", hint: "A message a customer or community member can forward.", utmSource: "referral", utmMedium: "community", maxChars: 600, disclaimer: "full" },
  short_video: { label: "Short video (registered creators)", hint: "A caption for a short video made by a creator with a SEBI registration.", utmSource: "youtube", utmMedium: "creator_video", maxChars: 500, disclaimer: "short" },
  email: { label: "Email", hint: "An email body.", utmSource: "email", utmMedium: "email", maxChars: 2000, disclaimer: "full" },
  partner: { label: "Partners", hint: "Copy a partner shares with their own audience.", utmSource: "partner", utmMedium: "partner", maxChars: 1500, disclaimer: "full" },
};

export function isChannelKey(value: unknown): value is ChannelKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CHANNELS, value);
}

export const channelLimit = (key: ChannelKey): number => CHANNELS[key].maxChars;

/** Only short video needs a creator, and a creator needs a SEBI registration number. */
export const requiresRegisteredCreator = (key: ChannelKey): boolean => key === "short_video";
