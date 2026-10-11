import { describe, expect, it } from "vitest";

import { notificationKind, timeAgo } from "./time-ago";

const now = new Date("2026-10-11T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("timeAgo", () => {
  it("reads like a person would say it", () => {
    expect(timeAgo(ago(10_000), now)).toBe("just now");
    expect(timeAgo(ago(5 * 60_000), now)).toBe("5m ago");
    expect(timeAgo(ago(3 * 3_600_000), now)).toBe("3h ago");
    expect(timeAgo(ago(30 * 3_600_000), now)).toBe("yesterday");
    expect(timeAgo(ago(4 * 86_400_000), now)).toBe("4d ago");
  });
  it("falls back to a short date after a week", () => {
    expect(timeAgo(ago(20 * 86_400_000), now)).toMatch(/Sept/i);
  });
  it("accepts an ISO string and survives garbage", () => {
    expect(timeAgo("2026-10-11T11:55:00Z", now)).toBe("5m ago");
    expect(timeAgo("nope", now)).toBe("");
  });
});

describe("notificationKind", () => {
  it("groups types into icons", () => {
    expect(notificationKind("task_overdue")).toBe("task");
    expect(notificationKind("stage_sla_breach")).toBe("task");
    expect(notificationKind("kyc_update")).toBe("kyc");
    expect(notificationKind("funding_pending")).toBe("funding");
    expect(notificationKind("new_assignment")).toBe("lead");
    expect(notificationKind("inbound_message")).toBe("message");
    expect(notificationKind("compliance_flag")).toBe("alert");
    expect(notificationKind("something_else")).toBe("other");
  });
});
