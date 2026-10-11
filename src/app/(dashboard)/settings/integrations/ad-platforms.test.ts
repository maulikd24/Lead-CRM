import { describe, expect, it } from "vitest";

import { AD_PLATFORM_PROVIDERS, adPlatformCards } from "./ad-platforms";

describe("the ad platform cards a marketing user may see", () => {
  const rows = [
    { provider: "meta_ads", mode: "live", credentials: { accessToken: "SECRET-TOKEN" } },
    { provider: "google_ads", mode: "mock", credentials: null },
    { provider: "clevertap", mode: "live", credentials: { passcode: "SECRET-PASSCODE" } },
    { provider: "freshdesk", mode: "live", credentials: { apiKey: "SECRET-KEY" } },
  ];
  const cards = adPlatformCards(rows, {});
  it("lists only the two ad platforms", () => {
    expect(AD_PLATFORM_PROVIDERS).toEqual(["meta_ads", "google_ads"]);
    expect(cards.map((c) => c.provider)).toEqual(["meta_ads", "google_ads"]);
  });
  it("carries a label and a state in words, and nothing from the stored configuration", () => {
    for (const c of cards) expect(Object.keys(c).sort()).toEqual(["label", "provider", "state"]);
    expect(JSON.stringify(cards)).not.toMatch(/SECRET/);
  });
  it("still lists a platform that has no stored configuration yet", () => {
    expect(adPlatformCards([], {}).map((c) => c.provider)).toEqual(["meta_ads", "google_ads"]);
  });
});
