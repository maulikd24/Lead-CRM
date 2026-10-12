import { describe, expect, it } from "vitest";

import { CLIENT_LIST_SEGMENTS, activeClientSegment, clientSegmentHref } from "./list-segments";

const seg = (key: string) => CLIENT_LIST_SEGMENTS.find((s) => s.key === key)!;

describe("client list segments", () => {
  it("knows which tab the current filters are", () => {
    expect(activeClientSegment({})).toBe("all");
    expect(activeClientSegment({ status: "COMPLETED", q: "priya" })).toBe("customers");
    expect(activeClientSegment({ status: "ACTIVE", sla: "OVERDUE" })).toBe("at-risk");
    expect(activeClientSegment({ status: "ACTIVE" })).toBe("onboarding");
  });
  it("highlights no tab for a status/SLA mix none of them covers", () => {
    expect(activeClientSegment({ status: "ON_HOLD" })).toBeNull();
    expect(activeClientSegment({ sla: "DUE_SOON" })).toBeNull();
  });
  it("keeps the other filters, swaps status/SLA and resets paging", () => {
    expect(clientSegmentHref({ q: "priya", rm: "u1", status: "COMPLETED", sla: "DUE_SOON", page: "3" }, seg("at-risk"))).toBe(
      "/clients?q=priya&rm=u1&status=ACTIVE&sla=OVERDUE",
    );
    expect(clientSegmentHref({ status: "ACTIVE", sla: "OVERDUE" }, seg("all"))).toBe("/clients");
  });
});
