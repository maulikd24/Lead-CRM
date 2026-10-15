import { describe, expect, it } from "vitest";

import { previewRouting, resolveOwner, validateRule, type RoutingRule } from "./routing";

const rule = (o: Partial<RoutingRule> & { id: string }): RoutingRule => ({ name: o.id, priority: 100, enabled: true, cities: [], languages: [], products: [], audienceKey: null, ownerId: `owner-${o.id}`, ownerLabel: null, isFallback: false, ...o });

const RULES: RoutingRule[] = [
  rule({ id: "nri", name: "NRI desk", priority: 10, audienceKey: "nri", ownerLabel: "NRI desk" }),
  rule({ id: "mumbai-hi", priority: 20, cities: ["Mumbai", "Thane"], languages: ["Hindi"] }),
  rule({ id: "mumbai", priority: 30, cities: ["Mumbai"] }),
  rule({ id: "tax", priority: 40, products: ["Tax saving"] }),
  rule({ id: "fallback", name: "Everyone else", priority: 999, isFallback: true }),
];

describe("resolveOwner", () => {
  it("sends an NRI-audience lead to the NRI desk whatever the city", () => {
    const r = resolveOwner(RULES, { audienceKey: "nri", city: "Dubai" });
    expect(r).toMatchObject({ via: "rule", ownerId: "owner-nri", ownerLabel: "NRI desk" });
  });
  it("matches city and language together, case-insensitively", () => {
    expect(resolveOwner(RULES, { city: "mumbai", language: "HINDI", audienceKey: "salaried" })).toMatchObject({ via: "rule", ownerId: "owner-mumbai-hi" });
  });
  it("falls to the next rule when a condition is missing", () => {
    expect(resolveOwner(RULES, { city: "Mumbai", language: "Marathi", audienceKey: "salaried" })).toMatchObject({ ownerId: "owner-mumbai" });
  });
  it("matches on product", () => {
    expect(resolveOwner(RULES, { product: "tax saving", city: "Pune" })).toMatchObject({ ownerId: "owner-tax" });
  });
  it("uses the fallback when nothing matches", () => {
    expect(resolveOwner(RULES, { city: "Pune", audienceKey: "salaried" })).toMatchObject({ via: "fallback", ownerId: "owner-fallback" });
  });
  it("says there is no owner when nothing matches and there is no fallback", () => {
    expect(resolveOwner(RULES.filter((r) => !r.isFallback), { city: "Pune" })).toEqual({ via: "none", ownerId: null, ownerLabel: null, rule: null });
  });
  it("skips disabled rules and rules that name nobody", () => {
    const rules = [rule({ id: "a", priority: 1, cities: ["Pune"], enabled: false }), rule({ id: "b", priority: 2, cities: ["Pune"], ownerId: null }), rule({ id: "c", priority: 3, cities: ["Pune"] })];
    expect(resolveOwner(rules, { city: "Pune" })).toMatchObject({ ownerId: "owner-c" });
  });
  it("prefers the lower priority number, then the more specific rule", () => {
    const rules = [rule({ id: "wide", priority: 5, cities: ["Pune"] }), rule({ id: "narrow", priority: 5, cities: ["Pune"], languages: ["Marathi"] })];
    expect(resolveOwner(rules, { city: "Pune", language: "Marathi" })).toMatchObject({ ownerId: "owner-narrow" });
  });
  it("never treats a rule with no conditions as a match for everything", () => {
    expect(resolveOwner([rule({ id: "empty" })], { city: "Pune" }).via).toBe("none");
  });
});

describe("previewRouting (test this rule)", () => {
  it("shows every rule with why it did or did not match, and the final decision", () => {
    const p = previewRouting(RULES, { city: "Mumbai", language: "Marathi", audienceKey: "salaried" });
    expect(p.decision.ownerId).toBe("owner-mumbai");
    const hi = p.trace.find((t) => t.rule.id === "mumbai-hi");
    expect(hi?.matched).toBe(false);
    expect(hi?.reasons.join(" ")).toMatch(/language/i);
    expect(p.trace.find((t) => t.rule.id === "mumbai")?.matched).toBe(true);
    expect(p.trace.find((t) => t.rule.id === "fallback")?.note).toMatch(/fallback/i);
  });
});

describe("validateRule", () => {
  it("needs a condition unless it is the fallback", () => {
    expect(validateRule({ name: "x", cities: [], languages: [], products: [], audienceKey: null, isFallback: false })).toContain("Add at least one condition, or make this the fallback.");
    expect(validateRule({ name: "x", cities: [], languages: [], products: [], audienceKey: null, isFallback: true })).toEqual([]);
  });
  it("needs a name", () => {
    expect(validateRule({ name: " ", cities: ["Pune"], languages: [], products: [], audienceKey: null, isFallback: false })).toContain("Give the rule a name.");
  });
});
