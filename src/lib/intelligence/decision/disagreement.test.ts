import { describe, expect, it } from "vitest";
import { compareToLegacy } from "./disagreement";
import { shell } from "./disagreement-test-support";
import type { LegacyOpinion } from "./types";

const legacy = (over: Partial<LegacyOpinion> = {}): LegacyOpinion => ({ source: "intelligence_nba", programme: "PMS / AIF opportunity", action: "Call", topic: "PMS", owner: "RM", priority: "Medium", doNotDiscuss: [], ...over });

describe("disagreement log: old versus new", () => {
  it("same programme and same action is agreement", () => {
    const r = compareToLegacy(shell({ programme: "PMS / AIF opportunity", action: "Call", assetClass: "PMS" }), legacy());
    expect(r.agrees).toBe(true);
    expect(r.kind).toBe("same");
  });
  it("same programme but a different action (consent forced a switch) is a minor disagreement", () => {
    const r = compareToLegacy(shell({ programme: "PMS / AIF opportunity", action: "Call", assetClass: "PMS" }), legacy({ action: "WhatsApp" }));
    expect(r).toMatchObject({ agrees: false, kind: "action_differs", severity: "minor" });
  });
  it("a different programme is a minor disagreement", () => {
    const r = compareToLegacy(shell({ programme: "Complete KYC", action: "Call", assetClass: null }), legacy());
    expect(r).toMatchObject({ agrees: false, kind: "programme_differs", severity: "minor" });
  });
  it("the new engine holding back where the old one acted is information, and safer", () => {
    expect(compareToLegacy(shell({ result: "NO_ACTION", action: "No Action", programme: "No Action / Do Not Pitch" }), legacy())).toMatchObject({ agrees: false, kind: "v2_holds_back", severity: "info" });
    expect(compareToLegacy(shell({ result: "ABSTAIN", abstainReason: "do_not_contact", action: "No Action", programme: "No Action / Do Not Pitch" }), legacy())).toMatchObject({ kind: "v2_abstains", severity: "info" });
  });
  it("both saying no action is agreement", () => {
    expect(compareToLegacy(shell({ result: "NO_ACTION", action: "No Action", programme: "No Action / Do Not Pitch" }), legacy({ action: "No Action", programme: "No Action / Do Not Pitch", topic: null })).agrees).toBe(true);
  });
  it("MATERIAL: the new engine recommends a class the old engine told the RM not to raise", () => {
    const r = compareToLegacy(shell({ programme: "PMS / AIF opportunity", action: "Call", assetClass: "PMS" }), legacy({ programme: "No Action / Do Not Pitch", action: "No Action", doNotDiscuss: ["PMS: Recently declined PMS (2026-10-03) — avoid repeating the pitch"] }));
    expect(r).toMatchObject({ agrees: false, kind: "suppression_regression", severity: "material" });
  });
  it("MATERIAL: the new engine sells while the old engine was in service-first mode", () => {
    const r = compareToLegacy(shell({ programme: "MF / SIP opportunity", action: "WhatsApp", assetClass: "Mutual Funds" }), legacy({ programme: "Service / relationship follow-up", doNotDiscuss: ["Sales topics — an open service issue — resolve it before any sales conversation"] }));
    expect(r.severity).toBe("material");
  });
  it("no legacy opinion at all is recorded as unknown, not as a disagreement", () => {
    expect(compareToLegacy(shell({}), null)).toMatchObject({ agrees: true, kind: "no_legacy" });
  });
});
