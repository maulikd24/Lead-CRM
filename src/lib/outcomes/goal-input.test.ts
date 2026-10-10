import { describe, expect, it } from "vitest";

import { mayEditGoals, parseGoalInput, parseRef } from "./goal-input";

const now = new Date("2026-10-10T00:00:00Z");
const valid = { name: "Daughter's education", targetAmount: "2500000", targetDate: "2036-06-01", priority: "HIGH" };

describe("parseGoalInput", () => {
  it("accepts a minimal goal and fills the rest with nulls and empty links", () => {
    const r = parseGoalInput(valid, now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ name: "Daughter's education", targetAmount: 2_500_000, priority: "HIGH", annualRatePct: null, plannedMonthly: null, linkedAccountIds: [], linkedHoldingKeys: [], status: "ACTIVE" });
  });
  it("trims the name and rejects blank, over-long and non-text names", () => {
    expect(parseGoalInput({ ...valid, name: "  Home  " }, now)).toMatchObject({ ok: true, value: { name: "Home" } });
    expect(parseGoalInput({ ...valid, name: "   " }, now).ok).toBe(false);
    expect(parseGoalInput({ ...valid, name: "x".repeat(81) }, now).ok).toBe(false);
  });
  it("rejects a non-positive or absurd target amount", () => {
    for (const targetAmount of ["0", "-5", "abc", "1e15"]) expect(parseGoalInput({ ...valid, targetAmount }, now).ok, targetAmount).toBe(false);
  });
  it("a new goal needs a target date in the future; an existing one may keep a past date", () => {
    expect(parseGoalInput({ ...valid, targetDate: "2026-01-01" }, now).ok).toBe(false);
    expect(parseGoalInput({ ...valid, targetDate: "2026-01-01" }, now, { allowPast: true }).ok).toBe(true);
    expect(parseGoalInput({ ...valid, targetDate: "not a date" }, now).ok).toBe(false);
  });
  it("keeps the assumed rate inside the allowed range and treats blank as the default", () => {
    expect(parseGoalInput({ ...valid, annualRatePct: "" }, now)).toMatchObject({ ok: true, value: { annualRatePct: null } });
    expect(parseGoalInput({ ...valid, annualRatePct: "10" }, now)).toMatchObject({ ok: true, value: { annualRatePct: 10 } });
    expect(parseGoalInput({ ...valid, annualRatePct: "25" }, now).ok).toBe(false);
    expect(parseGoalInput({ ...valid, annualRatePct: "-1" }, now).ok).toBe(false);
  });
  it("the stated monthly amount is optional and not negative", () => {
    expect(parseGoalInput({ ...valid, plannedMonthly: "15000" }, now)).toMatchObject({ ok: true, value: { plannedMonthly: 15_000 } });
    expect(parseGoalInput({ ...valid, plannedMonthly: "-1" }, now).ok).toBe(false);
  });
  it("rejects an unknown priority or status", () => {
    expect(parseGoalInput({ ...valid, priority: "URGENT" }, now).ok).toBe(false);
    expect(parseGoalInput({ ...valid, status: "DELETED" }, now).ok).toBe(false);
  });
  it("accepts link references in the documented shape and drops duplicates", () => {
    const r = parseGoalInput({ ...valid, linkedAccountIds: ["a1", "a1", "a2"], linkedHoldingKeys: ["a3:p1", "a3:p1"] }, now);
    expect(r).toMatchObject({ ok: true, value: { linkedAccountIds: ["a1", "a2"], linkedHoldingKeys: ["a3:p1"] } });
    expect(parseGoalInput({ ...valid, linkedHoldingKeys: ["no-colon"] }, now).ok).toBe(false);
  });
  it("returns field messages in words, never a raw schema dump", () => {
    const r = parseGoalInput({ ...valid, name: "" }, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.name).toMatch(/name/i);
  });
});

describe("parseRef", () => {
  it("splits an account:product key", () => {
    expect(parseRef("acc1:prod1")).toEqual({ accountId: "acc1", productId: "prod1" });
    expect(parseRef("bad")).toBeNull();
  });
});

describe("mayEditGoals", () => {
  it("the customer's own RM and an admin may; a manager, another RM and a dealer may not", () => {
    expect(mayEditGoals("RM", "u1", "u1")).toBe(true);
    expect(mayEditGoals("ADMIN", "x", "u1")).toBe(true);
    expect(mayEditGoals("RM", "u2", "u1")).toBe(false);
    expect(mayEditGoals("MANAGER", "m", "u1")).toBe(false);
    expect(mayEditGoals("DEALER", "u1", "u1")).toBe(false);
    expect(mayEditGoals("RM", "u1", null)).toBe(false);
  });
});
