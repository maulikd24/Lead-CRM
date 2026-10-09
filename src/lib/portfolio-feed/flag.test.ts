import { describe, expect, it } from "vitest";

import { customer360Enabled, portfolioFeedSecret } from "./flag";

describe("flags", () => {
  it("feed is off by default and needs both the flag and a secret", () => {
    expect(portfolioFeedSecret({} as NodeJS.ProcessEnv)).toBeNull();
    expect(portfolioFeedSecret({ PORTFOLIO_FEED_ENABLED: "1" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(portfolioFeedSecret({ PORTFOLIO_FEED_SECRET: "s" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(portfolioFeedSecret({ PORTFOLIO_FEED_ENABLED: "true", PORTFOLIO_FEED_SECRET: "s" } as unknown as NodeJS.ProcessEnv)).toBe("s");
    expect(portfolioFeedSecret({ PORTFOLIO_FEED_ENABLED: "0", PORTFOLIO_FEED_SECRET: "s" } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
  it("customer 360 is off unless NEXT_PUBLIC_C360=1", () => {
    expect(customer360Enabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(customer360Enabled({ NEXT_PUBLIC_C360: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});
