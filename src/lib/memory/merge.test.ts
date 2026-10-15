import { describe, expect, it } from "vitest";

import { conflictingGroups } from "./merge";

const NOW = new Date("2027-06-30T10:00:00Z");
const item = (over: Record<string, unknown>) => ({ id: "x", class: "PREFERENCE", key: "preference:channel", value: { channel: "call" }, confirmation: "CONFIRMED", freshUntil: null, ...over }) as Parameters<typeof conflictingGroups>[0][number];

describe("after two customers merge, items that now disagree are disputed, never silently kept side by side as truth", () => {
  it("finds a key with two live items of different values", () => {
    expect(conflictingGroups([item({ id: "a" }), item({ id: "b", value: { channel: "sms" } })], NOW)).toEqual([["a", "b"]]);
  });
  it("same value is no conflict; different keys are no conflict", () => {
    expect(conflictingGroups([item({ id: "a" }), item({ id: "b", value: { channel: " CALL" } })], NOW)).toEqual([]);
    expect(conflictingGroups([item({ id: "a" }), item({ id: "b", key: "preference:language", value: { l: "hi" } })], NOW)).toEqual([]);
  });
  it("rejected, expired, superseded and past-due items are not live", () => {
    for (const confirmation of ["REJECTED", "EXPIRED", "SUPERSEDED"]) expect(conflictingGroups([item({ id: "a" }), item({ id: "b", value: { channel: "sms" }, confirmation })], NOW)).toEqual([]);
    expect(conflictingGroups([item({ id: "a" }), item({ id: "b", value: { channel: "sms" }, freshUntil: new Date(NOW.getTime() - 1000) })], NOW)).toEqual([]);
  });
  it("an already DISPUTED group is still reported (so a third item joins it)", () => {
    expect(conflictingGroups([item({ id: "a", confirmation: "DISPUTED" }), item({ id: "b", value: { channel: "sms" }, confirmation: "DISPUTED" })], NOW)).toEqual([["a", "b"]]);
  });
});
