import { describe, expect, it } from "vitest";

import { buildTrend } from "./trend";

const NOW = new Date("2026-10-30T12:00:00Z");
const day = 86_400_000;
const ago = (d: number) => new Date(NOW.getTime() - d * day);

describe("buildTrend", () => {
  it("has a bucket per day for a week, oldest first", () => {
    const t = buildTrend({ now: NOW, days: 7, outcomes: [{ at: ago(0.5), positive: true }, { at: ago(6.5), positive: false }, { at: ago(6.6), positive: true }], drafts: [ago(3.2)], replies: [] });
    expect(t.labels).toHaveLength(7);
    expect(t.outcomes[6]).toBe(1);
    expect(t.outcomes[0]).toBe(2);
    expect(t.positive[0]).toBe(1);
    expect(t.drafts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(t.replies.every((v) => v === 0)).toBe(true);
  });
  it("groups a 90 day range into at most thirty buckets without losing a row", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ at: ago(i * 2 + 0.3), positive: false }));
    const t = buildTrend({ now: NOW, days: 90, outcomes: rows, drafts: [], replies: [] });
    expect(t.labels.length).toBeLessThanOrEqual(30);
    expect(t.outcomes.reduce((a, b) => a + b, 0)).toBe(40);
  });
  it("ignores rows outside the range", () => {
    const t = buildTrend({ now: NOW, days: 7, outcomes: [{ at: ago(20), positive: true }], drafts: [], replies: [] });
    expect(t.outcomes.every((v) => v === 0)).toBe(true);
  });
});
