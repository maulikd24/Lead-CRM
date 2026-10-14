import { describe, expect, it } from "vitest";

import { DISENGAGED_AFTER_DAYS } from "@/lib/copilot/disengagement";
import { buildClientWhere } from "./build-client-where";

describe("buildClientWhere disengaged", () => {
  it("is unchanged without the filter", () => {
    expect(buildClientWhere({}, null)).not.toHaveProperty("AND");
  });
  it("keeps the other filters and adds a no-contact-since-cutoff rule for live clients", () => {
    const where = buildClientWhere({ disengaged: "1", rm: "u1" }, null) as { AND: [Record<string, unknown>, Record<string, any>] };
    expect(where.AND[0]).toMatchObject({ assignedToId: "u1" });
    const rule = where.AND[1];
    expect(rule.status).toBe("ACTIVE");
    const cutoff: Date = rule.createdAt.lt;
    expect(Math.round((Date.now() - cutoff.getTime()) / 86_400_000)).toBe(DISENGAGED_AFTER_DAYS);
    expect(rule.activities.none.createdAt.gte).toEqual(cutoff);
    expect(rule.messages.none.createdAt.gte).toEqual(cutoff);
  });
});
