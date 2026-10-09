import { describe, expect, it } from "vitest";
import { checkAuthStatus, checkPaginationEcho, checkResponse, crossChecks, sensitiveKeyPaths, summarise, unknownKeyPaths } from "./contract-check";
import { summarySchema } from "./schemas";

const good = {
  referrers: { total: 3, active: 2, pending: 1 },
  referees: { total: 5, active: 2 },
  earnings: { lastMonth: 100, total: 250 },
  monthly: [{ period: "2026-08", earnings: 50, referees: 2 }, { period: "2026-09", earnings: 100, referees: 3 }],
  topReferrers: [{ id: 1, fullName: "SECRET-NAME", referralCode: "C1", refereeCount: 2, earningsTotal: 150 }],
};
const level = <T extends { level: string }>(f: T[], l: string) => f.filter((x) => x.level === l);

describe("checkResponse", () => {
  it("passes a good summary with no findings", () => {
    expect(checkResponse("summary", good)).toEqual([]);
  });
  it("fails with the field path when a required field is missing or renamed, and prints no values", () => {
    const f = checkResponse("summary", { ...good, referrers: { active: 2 }, earnings: { lastMonthTotal: 777777 } });
    const fails = level(f, "fail");
    expect(fails.map((x) => x.detail).join(" ")).toMatch(/referrers\.total/);
    expect(fails.map((x) => x.detail).join(" ")).toMatch(/earnings\.lastMonth/);
    expect(JSON.stringify(f)).not.toContain("777777");
  });
  it("reports extra unknown keys as info (names only)", () => {
    const f = checkResponse("summary", { ...good, brandNewSection: { a: 1 }, referrers: { ...good.referrers, extraCount: 9 } });
    const infos = level(f, "info").map((x) => x.detail).join(" ");
    expect(infos).toContain("brandNewSection");
    expect(infos).toContain("referrers.extraCount");
    expect(level(f, "fail")).toEqual([]);
  });
  it("warns, with counts only, about unrecognised status values", () => {
    const page = { items: [{ id: 1, fullName: "SECRET-NAME", status: "ACTIVE", earningsTotal: 1, refereeCount: 0 }, { id: 2, fullName: "B", status: "WEIRD_ONE", earningsTotal: 1, refereeCount: 0 }], total: 2 };
    const f = checkResponse("referrers", page);
    const warns = level(f, "warn");
    expect(warns).toHaveLength(1);
    expect(warns[0].detail).toMatch(/1 of 2/);
    expect(JSON.stringify(f)).not.toContain("WEIRD_ONE");
    expect(JSON.stringify(f)).not.toContain("SECRET-NAME");
  });
  it("fails a list whose total is missing, as a warning about an unknown total", () => {
    const f = checkResponse("referees", { items: [] });
    expect(level(f, "warn").map((x) => x.detail).join(" ")).toMatch(/total/);
  });
  it("fails on PAN-like or bank-like keys anywhere in the response", () => {
    const f = checkResponse("referrers", { items: [{ id: 1, fullName: "A", status: "ACTIVE", earningsTotal: 1, refereeCount: 0, pan: "ABCDE1234F", bankAccount: "000011112222", nested: { ifsc: "X" } }], total: 1 });
    const detail = level(f, "fail").map((x) => x.detail).join(" ");
    expect(detail).toMatch(/pan/);
    expect(detail).toMatch(/bankAccount/);
    expect(detail).toMatch(/ifsc/);
    expect(JSON.stringify(f)).not.toContain("ABCDE1234F");
    expect(JSON.stringify(f)).not.toContain("000011112222");
  });
  it("checks every endpoint kind", () => {
    expect(checkResponse("referrer", { id: 1, fullName: "A", status: "ACTIVE", earningsTotal: 1, refereeCount: 0 })).toEqual([]);
    expect(level(checkResponse("withdrawals", { items: [{ id: 1, status: "PAID" }], total: 1 }), "fail").length).toBeGreaterThan(0);
  });
});

describe("helpers", () => {
  it("finds sensitive key paths without values", () => {
    expect(sensitiveKeyPaths({ a: { bank_snapshot: { x: 1 } }, items: [{ pan: "Z" }] })).toEqual(["a.bank_snapshot", "items[].pan"]);
    expect(sensitiveKeyPaths({ company: 1, span: 2, panel: 3 })).toEqual([]);
  });
  it("finds unknown key paths against a schema", () => {
    expect(unknownKeyPaths(summarySchema, { ...good, zzz: 1 })).toEqual(["zzz"]);
    expect(unknownKeyPaths(summarySchema, good)).toEqual([]);
  });
});

describe("crossChecks", () => {
  const referrers = { items: [{ earningsTotal: 150 }, { earningsTotal: 100 }], total: 3 };
  it("passes consistent numbers", () => {
    const f = crossChecks({ summary: summarySchema.parse(good), referrersTotal: 3, earningsSum: 250, withdrawalsSummary: { PAID: { count: 2, amount: 10 } }, withdrawalStatusTotals: { PAID: 2 } });
    expect(f).toEqual([]);
    void referrers;
  });
  it("fails when summary totals disagree with the lists", () => {
    const f = crossChecks({ summary: summarySchema.parse(good), referrersTotal: 99 });
    expect(f.some((x) => x.level === "fail" && /referrers\.total/.test(x.detail))).toBe(true);
  });
  it("fails when the earnings total does not equal the sum of referrers", () => {
    const f = crossChecks({ summary: summarySchema.parse(good), earningsSum: 9999 });
    expect(f.some((x) => x.level === "fail" && /earnings/.test(x.detail))).toBe(true);
  });
  it("fails when the payout summary disagrees with the per-status totals", () => {
    const f = crossChecks({ summary: summarySchema.parse(good), withdrawalsSummary: { PAID: { count: 5, amount: 1 } }, withdrawalStatusTotals: { PAID: 4 } });
    expect(f.some((x) => x.level === "fail" && /PAID/.test(x.detail))).toBe(true);
  });
  it("warns when the latest month does not equal earnings.lastMonth", () => {
    const f = crossChecks({ summary: summarySchema.parse({ ...good, earnings: { lastMonth: 1 } }) });
    expect(f.some((x) => x.level === "warn" && /monthly/.test(x.detail))).toBe(true);
  });
});

describe("pagination and auth checks", () => {
  it("warns when limit or offset are not echoed", () => {
    expect(checkPaginationEcho({ limit: 2, offset: 0 }, { limit: 2, offset: 0 })).toEqual([]);
    expect(checkPaginationEcho({ limit: 2, offset: 0 }, { limit: 50, offset: 0 }).some((x) => x.level === "warn")).toBe(true);
  });
  it("accepts 401 or 403 for a request without a token and fails anything else", () => {
    expect(checkAuthStatus(401)).toEqual([]);
    expect(checkAuthStatus(403)).toEqual([]);
    expect(checkAuthStatus(200)[0].level).toBe("fail");
  });
  it("summarises pass/fail", () => {
    expect(summarise([])).toEqual({ passed: true, fail: 0, warn: 0, info: 0 });
    expect(summarise([{ endpoint: "x", level: "fail", code: "c", detail: "d" }, { endpoint: "x", level: "warn", code: "c", detail: "d" }])).toEqual({ passed: false, fail: 1, warn: 1, info: 0 });
  });
});
