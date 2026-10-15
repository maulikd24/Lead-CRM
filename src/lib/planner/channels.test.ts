import { describe, expect, it } from "vitest";

import { CHANNEL_KEYS, CHANNELS, channelLimit, isChannelKey, requiresRegisteredCreator } from "./channels";

describe("channel kinds", () => {
  it("covers the seven kinds the owner named", () => {
    expect([...CHANNEL_KEYS].sort()).toEqual(["click_to_whatsapp", "email", "partner", "referral_community", "search_ad", "seo_content", "short_video"]);
  });
  it("gives every channel a label, a UTM source and medium that satisfy the naming convention, and a positive copy limit", () => {
    for (const key of CHANNEL_KEYS) {
      const c = CHANNELS[key];
      expect(c.label.length).toBeGreaterThan(3);
      expect(c.utmSource).toMatch(/^[a-z0-9_-]{2,30}$/);
      expect(c.utmMedium).toMatch(/^[a-z0-9_-]{2,30}$/);
      expect(channelLimit(key)).toBeGreaterThan(40);
    }
  });
  it("recognises keys and nothing else", () => {
    expect(isChannelKey("email")).toBe(true);
    expect(isChannelKey("tiktok")).toBe(false);
    expect(isChannelKey(undefined)).toBe(false);
    expect(isChannelKey("__proto__")).toBe(false);
  });
  it("requires a registered creator only for short video", () => {
    expect(requiresRegisteredCreator("short_video")).toBe(true);
    expect(requiresRegisteredCreator("email")).toBe(false);
  });
});
