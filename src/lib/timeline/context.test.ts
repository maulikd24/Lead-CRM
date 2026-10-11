import { describe, expect, it } from "vitest";

import { recentActivityLine } from "./context";
import type { TimelineItem } from "./model";

const item = (over: Partial<TimelineItem>): TimelineItem => ({ id: "x", kind: "message", channel: "whatsapp", at: "2027-02-03T10:00:00.000Z", title: "WhatsApp received", source: "message", sourceRef: null, asOf: "2027-02-03T10:00:00.000Z", ...over });

describe("recentActivityLine", () => {
  it("is 'none' with nothing, otherwise date kind – text, newest first, separated by a bar", () => {
    expect(recentActivityLine([])).toBe("none");
    expect(recentActivityLine([item({}), item({ kind: "task", title: "Task: Call back", detail: "Due 5 Feb 2027", at: "2027-02-02T10:00:00.000Z" })])).toBe("3 Feb 2027 message – WhatsApp received | 2 Feb 2027 task – Task: Call back: Due 5 Feb 2027");
  });
  it("keeps only the newest N", () => expect(recentActivityLine([item({}), item({ title: "b" }), item({ title: "c" })], 2).split(" | ")).toHaveLength(2));
  it("redacts personal data from free text, like every other line of the summary", () => {
    const line = recentActivityLine([item({ detail: "Call me on 9876543210 or a@b.test" })]);
    expect(line).not.toContain("9876543210");
    expect(line).not.toContain("a@b.test");
  });
});
