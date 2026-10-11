import { describe, expect, it } from "vitest";

import { campaignLabel, coverageShare, matchRate, summariseStatuses } from "./summary";

describe("summariseStatuses", () => {
  it("rolls status counts into sent, failed (retrying or dead), waiting and not sent", () => {
    expect(summariseStatuses([{ status: "SENT", n: 5 }, { status: "FAILED", n: 2 }, { status: "DEAD", n: 1 }, { status: "PENDING", n: 3 }, { status: "SENDING", n: 1 }, { status: "SKIPPED", n: 4 }])).toEqual({ sent: 5, failed: 3, waiting: 4, skipped: 4, total: 16 });
    expect(summariseStatuses([])).toEqual({ sent: 0, failed: 0, waiting: 0, skipped: 0, total: 0 });
  });
});

describe("matchRate", () => {
  it("is shown only where the platform reported it: null (not 0%) when nothing was reported", () => {
    expect(matchRate({ matched: 0, unmatched: 0 })).toBeNull();
    expect(matchRate({ matched: 3, unmatched: 1 })).toEqual({ rate: 0.75, reported: 4 });
  });
});

describe("coverageShare", () => {
  it("is null with no funded customers, flags a small sample, and never exceeds 1", () => {
    expect(coverageShare({ funded: 0, sendable: 0 })).toBeNull();
    expect(coverageShare({ funded: 4, sendable: 2 })).toEqual({ share: 0.5, small: true });
    expect(coverageShare({ funded: 20, sendable: 5 })).toEqual({ share: 0.25, small: false });
    expect(coverageShare({ funded: 3, sendable: 9 })?.share).toBe(1);
  });
});

describe("campaignLabel", () => {
  it("keeps a campaign name short and uses a neutral label when there is none", () => {
    expect(campaignLabel(null)).toBe("No campaign recorded");
    expect(campaignLabel("  ")).toBe("No campaign recorded");
    expect(campaignLabel("x".repeat(100))).toHaveLength(60);
  });
});
