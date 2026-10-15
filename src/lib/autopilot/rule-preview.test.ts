import { describe, expect, it } from "vitest";

import { demoSnapshot } from "./fixture.testkit";
import { SIMULATE_SEAM, asSimulation, previewRule, type Rule } from "./rules";

const rule: Rule = { id: "draft", name: "Pause pricey", enabled: false, metric: "cost_per_funded", op: ">", threshold: 1, days: 14, campaignIds: null, accountIds: null, action: "pause_campaign" };

describe("previewing a rule before it is saved", () => {
  it("shows which campaigns it would propose for today, which it holds and why, and changes nothing", () => {
    const snap = demoSnapshot();
    const p = previewRule(snap, rule);
    expect(p.window).toEqual({ from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), to: snap.window.until });
    expect(p.wouldPropose.length + p.held.length + p.quiet.length).toBe(snap.campaigns.length);
    expect(p.wouldPropose.length).toBeGreaterThan(0);
    for (const w of p.wouldPropose) expect(w.value === null || Number.isFinite(w.value)).toBe(true);
  });
  it("previews a DISABLED draft as if it were on (it is a preview), and never mutates the rule", () => {
    const snap = demoSnapshot();
    const copy = { ...rule };
    previewRule(snap, rule);
    expect(rule).toEqual(copy);
    expect(rule.enabled).toBe(false);
  });
  it("respects campaign and account scope", () => {
    const snap = demoSnapshot();
    const only = previewRule(snap, { ...rule, campaignIds: ["m1"] });
    expect(only.wouldPropose.concat(only.held, only.quiet).map((x) => x.campaignId)).toEqual(["m1"]);
    const acct = previewRule({ ...snap, campaigns: snap.campaigns.map((c) => ({ ...c, accountId: c.id === "g1" ? "A2" : "A1" })) }, { ...rule, accountIds: ["A2"] });
    expect(acct.wouldPropose.concat(acct.held, acct.quiet).map((x) => x.campaignId)).toEqual(["g1"]);
  });
  it("holds a campaign with too few leads and says how many it has", () => {
    const snap = demoSnapshot();
    const thin = { ...snap, windowOutcomes: { "14": { m1: { ...snap.outcomes.m1, leads: 3 } } } };
    const p = previewRule(thin, { ...rule, campaignIds: ["m1"] });
    expect(p.held[0]).toMatchObject({ campaignId: "m1" });
    expect(p.held[0].reason).toMatch(/3 leads/);
  });
  it("an invalid draft previews nothing and says why", () => {
    expect(previewRule(demoSnapshot(), { ...rule, days: 0 })).toMatchObject({ error: expect.stringMatching(/Days/), wouldPropose: [] });
  });
});

describe("the simulate() seam", () => {
  it("documents that the generic simulate() primitive is not on this base, and maps the preview onto its eligible-and-suppressed shape", () => {
    expect(SIMULATE_SEAM).toMatchObject({ primitive: "simulate", onThisBase: false });
    const sim = asSimulation(previewRule(demoSnapshot(), rule));
    expect(sim).toMatchObject({ kind: "rule.preview", mode: "dry_run", effects: { adAccountChanged: false, customerContacted: false, aiCalls: 0 } });
    expect(sim.eligible.length).toBeGreaterThan(0);
    expect(sim.suppressed.every((s) => typeof s.reason === "string" && s.reason.length > 0)).toBe(true);
  });
});
