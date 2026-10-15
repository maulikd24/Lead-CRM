import { describe, expect, it } from "vitest";

import { DAY_MS } from "./constants";
import { DECISION_RETENTION, decisionRetentionCutoffs, isDecisionDueForDeletion } from "./retention";

const now = new Date("2027-01-01T00:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);

describe("decision retention (shadow decisions are not kept forever)", () => {
  it("keeps 180 days of decisions nobody reviewed and 24 months of reviewed ones", () => {
    expect(DECISION_RETENTION.unreviewedDays).toBe(180);
    expect(DECISION_RETENTION.reviewedDays).toBe(730);
    const c = decisionRetentionCutoffs(now);
    expect(c.unreviewedBefore.getTime()).toBe(ago(180).getTime());
    expect(c.reviewedBefore.getTime()).toBe(ago(730).getTime());
  });
  it("an unreviewed decision goes after 180 days, not before", () => {
    expect(isDecisionDueForDeletion({ createdAt: ago(181), humanFeedbackCount: 0 }, now)).toBe(true);
    expect(isDecisionDueForDeletion({ createdAt: ago(179), humanFeedbackCount: 0 }, now)).toBe(false);
  });
  it("a decision a person reviewed (feedback) is kept as evaluation data until 24 months", () => {
    expect(isDecisionDueForDeletion({ createdAt: ago(400), humanFeedbackCount: 1 }, now)).toBe(false);
    expect(isDecisionDueForDeletion({ createdAt: ago(731), humanFeedbackCount: 1 }, now)).toBe(true);
  });
});
