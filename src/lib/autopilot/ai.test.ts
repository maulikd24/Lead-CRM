import { describe, expect, it } from "vitest";

import { AGENTS, getAgent } from "@/lib/agents/registry";
import { ceilingForAction } from "@/lib/agents/autonomy";
import { FakeProvider } from "@/lib/ai/provider";
import { getPurpose } from "@/lib/ai/gateway/purposes";
import { makeDeps } from "@/lib/ai/gateway/test-kit";

import { planWithModel, planByKeywords, TOOL_NAMES } from "./ask";
import { draftRuleFromText } from "./rule-draft";
import { validateRule } from "./rules";

const campaigns = [{ id: "m1", name: "Meta - Demat open", accountId: "acct-1" }, { id: "g1", name: "Google - Search brand", accountId: "acct-2" }];

describe("Autopilot's model calls go through the gateway with registered purposes and an agent entry", () => {
  it("registers both purposes, aggregate data only, no consent needed and no names", () => {
    for (const id of ["autopilot.ask", "autopilot.rule_draft"]) {
      const p = getPurpose(id)!;
      expect(p, id).toBeDefined();
      expect(p).toMatchObject({ agentKey: "ad_autopilot", dataClass: "aggregate", consent: null, allowNames: false, allowContactIdentifiers: false });
    }
  });
  it("registers the ad_autopilot agent: a person approves every action, apply is L4 at most, default is below L4", () => {
    const a = getAgent("ad_autopilot")!;
    expect(a).toBeDefined();
    expect(AGENTS.filter((x) => x.key === "ad_autopilot")).toHaveLength(1);
    expect(a.approval.required).toBe("always");
    expect(a.prohibitedActions).toContain("change_ad_spend");
    expect(a.purposes.sort()).toEqual(["autopilot.ask", "autopilot.rule_draft"]);
    const spend = a.actions.find((x) => x.actionType === "change_ad_spend")!;
    expect(spend.maxLevel).toBeLessThanOrEqual(4);
    expect(spend.maxLevel).toBeLessThanOrEqual(ceilingForAction("change_ad_spend"));
    expect(spend.defaultLevel).toBeLessThan(4);
    expect(a.actions.every((x) => x.maxLevel <= 4)).toBe(true);
  });
});

describe("Ask Autopilot: the model only chooses tools", () => {
  const reply = (text: string) => makeDeps({ provider: new FakeProvider(text) });
  it("uses callModel with the autopilot.ask purpose, and sends no lead or customer rows", async () => {
    const { deps, fake, records } = reply('{"tools":[{"tool":"wasted_spend","args":{}}]}');
    const plan = await planWithModel("how much are we wasting?", campaigns.map((c) => c.name), deps);
    expect(plan).toEqual([{ tool: "wasted_spend", args: {} }]);
    expect(records[0]).toMatchObject({ purposeId: "autopilot.ask", status: "ok" });
    const sent = JSON.stringify((fake as FakeProvider).calls[0]);
    expect(sent).toContain("how much are we wasting");
    expect(sent).not.toMatch(/arrivedAt|contactMinutes|kycComplete|"funded":|"city":|"aum":|"revenue":/);
  });
  it("drops any tool that is not on the whitelist and caps the plan at three", async () => {
    const { deps } = reply('{"tools":[{"tool":"drop_table","args":{}},{"tool":"pacing","args":{}},{"tool":"timing","args":{}},{"tool":"tracking","args":{}},{"tool":"top_regions","args":{"kind":"state"}}]}');
    const plan = await planWithModel("anything", [], deps);
    expect(plan.map((p) => p.tool)).toEqual(["pacing", "timing", "tracking"]);
    expect(plan.every((p) => TOOL_NAMES.includes(p.tool))).toBe(true);
  });
  it("falls back to the keyword router when the gateway blocks, fails or the reply is not JSON", async () => {
    const expected = planByKeywords("is our tracking double counting?");
    const blocked = makeDeps({ env: { AI_KILL_SWITCH: "1", AI_BUDGET_DEFAULT_USD: "100" } });
    expect(await planWithModel("is our tracking double counting?", [], blocked.deps)).toEqual(expected);
    expect((blocked.fake as FakeProvider).calls).toHaveLength(0);
    const failing = makeDeps({ provider: new FakeProvider(new Error("boom")) });
    expect(await planWithModel("is our tracking double counting?", [], failing.deps)).toEqual(expected);
    const junk = reply("I think you should look at tracking.");
    expect(await planWithModel("is our tracking double counting?", [], junk.deps)).toEqual(expected);
  });
});

describe("natural-language rule drafting: a draft for a person, never a saved rule", () => {
  const draft = (text: string) => makeDeps({ provider: new FakeProvider(text) });
  it("turns a sentence into a valid rule scoped by campaign and account, through the gateway", async () => {
    const { deps, records } = draft('{"name":"Pause pricey Meta","metric":"cost_per_funded","op":">","threshold":4000,"days":14,"action":"pause_campaign","campaigns":["Meta - Demat open"],"accounts":["acct-1"]}');
    const r = await draftRuleFromText("pause the demat campaign if a funded customer costs over 4000 for two weeks", { campaigns }, deps);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rule).toMatchObject({ metric: "cost_per_funded", op: ">", threshold: 4000, days: 14, action: "pause_campaign", campaignIds: ["m1"], accountIds: ["acct-1"], enabled: false });
    expect(validateRule(r.rule)).toBeNull();
    expect(records[0]).toMatchObject({ purposeId: "autopilot.rule_draft" });
    expect(r.note).toMatch(/draft/i);
  });
  it("a draft is never enabled and never saved: it comes back disabled for the person to review", async () => {
    const { deps } = draft('{"name":"Test rule","metric":"spend","op":">","threshold":1,"days":7,"action":"review_manually","campaigns":[],"accounts":[]}');
    const r = await draftRuleFromText("tell me when spend is high", { campaigns }, deps);
    expect(r.ok && r.rule.enabled).toBe(false);
  });
  it("refuses an action that does not exist, a metric that does not exist and a campaign it cannot match", async () => {
    for (const bad of [
      '{"name":"Test rule","metric":"spend","op":">","threshold":1,"days":7,"action":"raise_budget","campaigns":[],"accounts":[]}',
      '{"name":"Test rule","metric":"profit","op":">","threshold":1,"days":7,"action":"pause_campaign","campaigns":[],"accounts":[]}',
      '{"name":"Test rule","metric":"spend","op":">","threshold":1,"days":7,"action":"pause_campaign","campaigns":["No Such Campaign"],"accounts":[]}',
      '{"name":"Test rule","metric":"spend","op":">","threshold":1,"days":7,"action":"pause_campaign","campaigns":[],"accounts":["acct-9"]}',
      "not json at all",
    ]) {
      const r = await draftRuleFromText("whatever", { campaigns }, draft(bad).deps);
      expect(r.ok, bad).toBe(false);
    }
  });
  it("says it is unavailable when the gateway blocks or abstains, and calls no model when the global AI kill switch is on", async () => {
    const off = makeDeps({ env: { AI_KILL_SWITCH: "1", AI_BUDGET_DEFAULT_USD: "100" } });
    const r = await draftRuleFromText("pause bad campaigns", { campaigns }, off.deps);
    expect(r).toMatchObject({ ok: false, reason: "unavailable" });
    expect((off.fake as FakeProvider).calls).toHaveLength(0);
    const abstain = await draftRuleFromText("pause bad campaigns", { campaigns }, draft("ABSTAIN: do_not_know").deps);
    expect(abstain).toMatchObject({ ok: false });
  });
  it("rejects empty or oversized input before any call", async () => {
    const { deps, fake } = draft("{}");
    expect(await draftRuleFromText("  ", { campaigns }, deps)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await draftRuleFromText("x".repeat(600), { campaigns }, deps)).toMatchObject({ ok: false, reason: "invalid" });
    expect((fake as FakeProvider).calls).toHaveLength(0);
  });
});
