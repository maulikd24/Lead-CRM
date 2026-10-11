import { describe, expect, it } from "vitest";

import { eventCoverage, matchRate, shareOf, summariseStatuses } from "./summary";

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

describe("eventCoverage", () => {
  it("of the events detected: sent, waiting, failed for good, and the reasons the rest were held back (most common first)", () => {
    const c = eventCoverage([
      { status: "SENT", reason: null, n: 6 }, { status: "PENDING", reason: null, n: 2 }, { status: "FAILED", reason: "http_500", n: 1 }, { status: "DEAD", reason: "rejected", n: 1 },
      { status: "SKIPPED", reason: "CONSENT_MISSING", n: 4 }, { status: "SKIPPED", reason: "NO_IDENTIFIERS", n: 7 }, { status: "SKIPPED", reason: "CONSENT_MISSING", n: 1 },
    ]);
    expect(c).toEqual({ detected: 22, sent: 6, waiting: 3, failed: 1, held: [{ reason: "NO_IDENTIFIERS", n: 7 }, { reason: "CONSENT_MISSING", n: 5 }] });
  });
  it("is all zero with nothing detected, and a skipped row with no reason is reported as unknown rather than dropped", () => {
    expect(eventCoverage([])).toEqual({ detected: 0, sent: 0, waiting: 0, failed: 0, held: [] });
    expect(eventCoverage([{ status: "SKIPPED", reason: null, n: 2 }]).held).toEqual([{ reason: "UNKNOWN", n: 2 }]);
  });
});

describe("shareOf", () => {
  it("is null when there is nothing to divide by, flags a small base and never exceeds 1", () => {
    expect(shareOf(0, 0)).toBeNull();
    expect(shareOf(2, 4)).toEqual({ share: 0.5, small: true });
    expect(shareOf(5, 20)).toEqual({ share: 0.25, small: false });
    expect(shareOf(9, 3)?.share).toBe(1);
  });
});
