import { describe, expect, it } from "vitest";

import type { DecisionMemory, DecisionMemoryItem } from "@/lib/memory/view";
import { attachProductRefs, citationsFromResults, memoryToGate, mergeComplaintSignals } from "./integration";
import { cand, NOW, daysAhead } from "./test-helpers";

const item = (over: Partial<DecisionMemoryItem> & Pick<DecisionMemoryItem, "class" | "key" | "value">): DecisionMemoryItem => ({ id: `m-${over.key}`, confidence: "MEDIUM", observedAt: NOW, freshUntil: null, ...over });
const mem = (over: Partial<DecisionMemory> = {}): DecisionMemory => ({ asOf: NOW, authoritative: [], advisory: [], contested: [], doNotDo: [], ...over });

describe("customer memory becomes gate context (workstream B read API, no evidence text)", () => {
  it("a confirmed 'declined' stance is a confirmed not-interested stance with its expiry; an unconfirmed one is not confirmed", () => {
    const confirmed = item({ class: "PRODUCT_STANCE", key: "product_stance:PMS", value: { assetClass: "PMS", stance: "declined" }, freshUntil: daysAhead(10) });
    const unconfirmed = item({ class: "PRODUCT_STANCE", key: "product_stance:AIF", value: { assetClass: "AIF", stance: "declined" } });
    const g = memoryToGate(mem({ authoritative: [confirmed], advisory: [unconfirmed] }));
    expect(g.productStances).toEqual([
      expect.objectContaining({ assetClass: "PMS", stance: "not_interested", confirmed: true, until: confirmed.freshUntil }),
      expect.objectContaining({ assetClass: "AIF", stance: "not_interested", confirmed: false }),
    ]);
  });
  it("low acceptance is an objection (it can downrank, never block)", () => {
    const g = memoryToGate(mem({ authoritative: [item({ class: "PRODUCT_STANCE", key: "product_stance:Bonds", value: { assetClass: "Bonds", stance: "low acceptance" } })] }));
    expect(g.productStances[0]).toMatchObject({ assetClass: "Bonds", stance: "objection" });
  });
  it("an interest item is not a stance, and a stance with no recognisable class is skipped", () => {
    const g = memoryToGate(mem({ authoritative: [item({ class: "INTEREST", key: "interest:PMS", value: { assetClass: "PMS" } }), item({ class: "PRODUCT_STANCE", key: "product_stance:abc", value: { text: "x", stance: "declined" } })] }));
    expect(g.productStances).toEqual([]);
  });
  it("do-not-do items map to a class or a suggestion rule; anything else is counted as unmapped, never guessed", () => {
    const g = memoryToGate(mem({ doNotDo: [
      item({ class: "DO_NOT_DO", key: "do_not_do:recommend:PMS", value: { assetClass: "PMS", scope: "PMS" } }),
      item({ class: "DO_NOT_DO", key: "do_not_do:suggestion:intelligence_nba.pms", value: { text: "x" } }),
      item({ class: "DO_NOT_DO", key: "do_not_do:call_after_6pm", value: { text: "do not call after 6pm" } }),
    ] }));
    expect(g.doNotDo.map((d) => [d.assetClass, d.ruleKey])).toEqual([["PMS", null], [null, "intelligence_nba.pms"]]);
    expect(g.doNotDoUnmapped).toBe(1);
    expect(JSON.stringify(g.doNotDo)).not.toMatch(/6pm/);
  });
  it("a disputed stance or interest on a class is evidence that conflicts: the engine abstains on it", () => {
    const g = memoryToGate(mem({ contested: [item({ class: "PRODUCT_STANCE", key: "product_stance:PMS", value: { assetClass: "PMS", stance: "declined" } }), item({ class: "FACT", key: "fact:x", value: { text: "y" } })] }));
    expect(g.conflicts).toEqual([expect.objectContaining({ assetClass: "PMS" })]);
  });
});

describe("registry citations: only what cite() lets anything cite counts", () => {
  const ok = (id: string) => ({ ok: true as const, productId: id });
  const no = (id: string, reason: string) => ({ ok: false as const, productId: id, reason });
  it("is not enforced when the registry flag is off", () => {
    expect(citationsFromResults([], false)).toEqual({ enforced: false, citable: {}, refused: {} });
  });
  it("maps registry categories to asset classes and keeps only products cite() accepted", () => {
    const c = citationsFromResults([{ category: "PMS", id: "p1", result: ok("p1") }, { category: "PMS", id: "p2", result: no("p2", "suspended") }, { category: "MUTUAL_FUND", id: "m1", result: ok("m1") }], true);
    expect(c.enforced).toBe(true);
    expect(c.citable).toEqual({ PMS: ["p1"], "Mutual Funds": ["m1"] });
    expect(c.refused).toEqual({});
  });
  it("a class whose only products are refused (example in production, suspended, unapproved) carries the reason code and cites nothing", () => {
    const c = citationsFromResults([{ category: "AIF", id: "a1", result: no("a1", "example_product") }, { category: "AIF", id: "a2", result: no("a2", "unapproved") }], true);
    expect(c.citable.AIF).toBeUndefined();
    expect(c.refused.AIF).toBe("example_product");
  });
  it("categories that count toward no asset class (insurance, NPS) are ignored", () => {
    expect(citationsFromResults([{ category: "INSURANCE", id: "i1", result: ok("i1") }], true).citable).toEqual({});
  });
});

describe("a sale cites registry ids and nothing else", () => {
  const reg = (citable: Record<string, string[]>) => ({ enforced: true, citable, refused: {} });
  it("a product recommendation carries the approved ids for its class and an evidence line for each; a service step carries none", () => {
    const [sale, service] = attachProductRefs([cand(), cand({ id: "x", sales: false, assetClass: null })], reg({ PMS: ["p1", "p2"] }));
    expect(sale.productRefs).toEqual(["p1", "p2"]);
    expect(sale.evidence.filter((e) => e.ref.startsWith("registry:")).map((e) => e.ref)).toEqual(["registry:p1", "registry:p2"]);
    expect(service.productRefs).toEqual([]);
  });
  it("changes nothing while the registry is not enforced", () => {
    const c = cand();
    expect(attachProductRefs([c], { enforced: false, citable: { PMS: ["p1"] }, refused: {} })[0]).toBe(c);
  });
});

describe("complaint signals: the formal Complaint adds to the conversation insights, it never replaces them", () => {
  const a = { open: false, lastAt: null, because: null };
  it("open if either says open; the latest date wins; the open one explains", () => {
    const formal = { open: true, lastAt: NOW, because: "Open complaint on 2026-10-11" };
    const insight = { open: false, lastAt: daysAhead(-5), because: "Complaint on 2026-10-06" };
    expect(mergeComplaintSignals(formal, insight)).toEqual(formal);
    expect(mergeComplaintSignals(insight, formal)).toEqual(formal);
    expect(mergeComplaintSignals(a, insight)).toEqual(insight);
  });
  it("neither -> nothing, and a missing side is fine", () => {
    expect(mergeComplaintSignals(a, a)).toEqual(a);
    expect(mergeComplaintSignals(null, a)).toEqual(a);
    expect(mergeComplaintSignals(null, null)).toEqual(a);
  });
});
