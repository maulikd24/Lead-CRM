import { describe, expect, it } from "vitest";

import { DISENGAGED_AFTER_DAYS, disengagedWhere } from "./disengagement";

describe("disengagedWhere", () => {
  it("is one rule: live, not deleted, nothing logged or sent since DISENGAGED_AFTER_DAYS ago", () => {
    const now = new Date("2026-10-14T00:00:00Z");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Prisma where is probed structurally in this test
    const w = disengagedWhere(now) as any;
    const cutoff = new Date(now.getTime() - DISENGAGED_AFTER_DAYS * 86_400_000);
    expect(w).toMatchObject({ status: "ACTIVE", isDeleted: false, createdAt: { lt: cutoff } });
    expect(w.activities.none.createdAt.gte).toEqual(cutoff);
    expect(w.messages.none.createdAt.gte).toEqual(cutoff);
  });
});
