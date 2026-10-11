import { describe, expect, it } from "vitest";

import { ageDays, ageLabel, assessFreshness, isStale } from "./stale";

const NOW = new Date("2027-06-30T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("assessFreshness: the one as-of / stale helper other modules can call", () => {
  it("is unknown when there is no as-of date: never presented as fresh", () => {
    expect(assessFreshness({ asOf: null }, NOW).status).toBe("unknown");
    expect(isStale({ asOf: null }, NOW)).toBe(true); // unknown counts as stale for a consumer that must not rely on it
  });
  it("is fresh inside the max age, aging in the last quarter of it, stale after it", () => {
    expect(assessFreshness({ asOf: daysAgo(10), maxAgeDays: 60 }, NOW).status).toBe("fresh");
    expect(assessFreshness({ asOf: daysAgo(50), maxAgeDays: 60 }, NOW).status).toBe("aging");
    expect(assessFreshness({ asOf: daysAgo(61), maxAgeDays: 60 }, NOW).status).toBe("stale");
  });
  it("an explicit freshUntil beats maxAgeDays", () => {
    expect(assessFreshness({ asOf: daysAgo(100), maxAgeDays: 365, freshUntil: daysAgo(1) }, NOW).status).toBe("stale");
    expect(assessFreshness({ asOf: daysAgo(100), maxAgeDays: 30, freshUntil: new Date(NOW.getTime() + 86_400_000) }, NOW).status).not.toBe("stale");
  });
  it("with neither a limit nor an expiry it is fresh but still reports its age", () => {
    const r = assessFreshness({ asOf: daysAgo(400) }, NOW);
    expect(r.status).toBe("fresh");
    expect(r.ageDays).toBe(400);
  });
  it("a date in the future is treated as unknown rather than fresh (clock skew or bad data)", () => {
    expect(assessFreshness({ asOf: new Date(NOW.getTime() + 3 * 86_400_000), maxAgeDays: 60 }, NOW).status).toBe("unknown");
  });
});

describe("age labels", () => {
  it("counts whole days and words them plainly", () => {
    expect(ageDays(daysAgo(0), NOW)).toBe(0);
    expect(ageLabel(daysAgo(0), NOW)).toBe("today");
    expect(ageLabel(daysAgo(1), NOW)).toBe("yesterday");
    expect(ageLabel(daysAgo(12), NOW)).toBe("12 days ago");
    expect(ageLabel(daysAgo(65), NOW)).toBe("2 months ago");
    expect(ageLabel(daysAgo(400), NOW)).toBe("1 year ago");
    expect(ageLabel(null, NOW)).toBe("no date");
  });
});
