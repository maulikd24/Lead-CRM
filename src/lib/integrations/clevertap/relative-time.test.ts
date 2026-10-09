import { describe, expect, it } from "vitest";
import { relativeTime } from "./relative-time";

const now = new Date("2026-10-09T12:00:00Z");
describe("relativeTime", () => {
  it.each([
    ["2026-10-09T11:59:40Z", "just now"],
    ["2026-10-09T11:55:00Z", "5 minutes ago"],
    ["2026-10-09T11:00:00Z", "1 hour ago"],
    ["2026-10-06T12:00:00Z", "3 days ago"],
    ["2026-08-01T12:00:00Z", "2 months ago"],
    ["2024-10-01T12:00:00Z", "2 years ago"],
    ["2027-01-01T00:00:00Z", "just now"],
  ])("%s => %s", (iso, out) => expect(relativeTime(iso, now)).toBe(out));
  it("returns null for garbage", () => expect(relativeTime("nope", now)).toBeNull());
});
