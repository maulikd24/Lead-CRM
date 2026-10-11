import { describe, expect, it } from "vitest";
import { answer, planByKeywords, planWithModel, TOOL_NAMES } from "./ask";
import { createFakeActionProvider, guarded } from "./actions";
import { evaluateControls } from "./controls";
import { demoSnapshot } from "./fixture.testkit";
import { buildLaunchDraft, estimate, historicalFunnel, type LaunchInput } from "./launch";
import { monthlyPacing } from "./pacing";
import { buildRecommendations, decide, tuneFromDenials, withoutSuppressed, type Decision } from "./recommendations";
import { topRegions } from "./regions";
import { runRules, validateRule, type Rule } from "./rules";
import { categoryScorecard, scoreControls } from "./scoring";
import { timingReport } from "./timing";
import { trackingIntegrity } from "./tracking";
import { auctionInsights } from "./auction";
import { wastedSpend } from "./waste";
import { FakeProvider } from "@/lib/ai/provider";
import { CATEGORIES, type ControlResult } from "./types";

const full = () => demoSnapshot({ withOptional: true });
const base = () => demoSnapshot();
const ctl = (state: ControlResult["state"], severity: ControlResult["severity"] = "high", category: ControlResult["category"] = "Keywords"): ControlResult => ({ id: "x", category, severity, state, finding: "", evidence: [] });

describe("scoring", () => {
  it("scores by severity weight and reports coverage separately", () => {
    const s = scoreControls([ctl("pass", "critical"), ctl("fail", "high"), ctl("unknown", "high"), ctl("not_applicable")]);
    expect(s.score).toBe(63); // (5+3-3)... 5 passed of 8 weighted
    expect(s.coverage).toBeCloseTo(2 / 3);
    expect(s.confidence).toBe("provisional");
  });
  it("gives no score when nothing weighted was judged", () => {
    expect(scoreControls([ctl("unknown"), ctl("pass", "informational")]).score).toBeNull();
  });
  it("labels coverage bands", () => {
    expect(scoreControls([ctl("pass"), ctl("pass"), ctl("pass"), ctl("pass"), ctl("unknown")]).confidence).toBe("normal");
    expect(scoreControls([ctl("pass"), ctl("pass"), ctl("pass"), ctl("unknown"), ctl("unknown")]).confidence).toBe("provisional");
  });
  it("builds one card per category with at most two findings and its own coverage", () => {
    const cards = categoryScorecard(evaluateControls(full()));
    expect(cards.map((c) => c.category)).toEqual([...CATEGORIES]);
    expect(cards.every((c) => c.findings.length <= 2 && c.coverage >= 0 && c.coverage <= 1)).toBe(true);
    expect(cards.every((c) => c.findings.every((f) => f.finding.length > 0))).toBe(true);
  });
  it("never invents coverage: with no optional data many controls are unknown", () => {
    const a = scoreControls(evaluateControls(base())).coverage;
    const b = scoreControls(evaluateControls(full())).coverage;
    expect(b).toBeGreaterThan(a);
  });
});

describe("wasted spend", () => {
  it("causes add up to no more than total spend and each has a plain how", () => {
    const w = wastedSpend(full());
    expect(w.wasted).toBeLessThanOrEqual(w.totalSpend + 1e-6);
    expect(w.causes).toHaveLength(7);
    expect(w.causes.every((c) => c.how.length > 10)).toBe(true);
  });
  it("marks a cause not available instead of zero when its data is missing", () => {
    const w = wastedSpend(base());
    const irrelevant = w.causes.find((c) => c.key === "irrelevant_terms")!;
    expect(irrelevant.available).toBe(false);
    expect(irrelevant.share).toBeNull();
  });
  it("finds irrelevant terms, junk placements and zero-lead hours when reported", () => {
    const w = wastedSpend(full());
    expect(w.causes.find((c) => c.key === "irrelevant_terms")!.amount).toBe(2400);
    expect(w.causes.find((c) => c.key === "junk_placements")!.amount).toBe(3000);
    expect(w.causes.find((c) => c.key === "zero_lead_hours")!.amount).toBeGreaterThan(0);
  });
  it("does not count a campaign's spend twice when the whole campaign is already counted", () => {
    const s = full();
    const m2 = s.leads.filter((l) => l.campaignId === "m2");
    expect(m2.every((l) => !l.funded)).toBe(true);
    const w = wastedSpend(s);
    const zf = w.causes.find((c) => c.key === "zero_funded")!;
    expect(zf.top[0]).toContain("Meta - Wealth leads");
  });
});

describe("timing", () => {
  it("recommends reducing overnight ads with evidence when the sample is large enough", () => {
    const r = timingReport(full());
    expect(r.bands.reduce((a, b) => a + b.leads, 0)).toBe(r.leadsUsed);
    const rec = r.recommendations.find((x) => x.kind === "reduce_ads_in_band" && x.band === "overnight");
    expect(rec).toBeTruthy();
    expect(rec!.evidence.join(" ")).toMatch(/90% confidence/);
  });
  it("recommends staffing the slow band", () => {
    expect(timingReport(full()).recommendations.some((x) => x.kind === "staff_band" && x.band === "overnight")).toBe(true);
  });
  it("stays silent and says why when there are too few leads", () => {
    const s = full(); s.leads = s.leads.slice(0, 40);
    const r = timingReport(s);
    expect(r.recommendations).toHaveLength(0);
  });
  it("heat map is available only when hour data exists", () => {
    expect(timingReport(base()).heat.available).toBe(false);
    expect(timingReport(full()).heat.cells.length).toBe(168);
  });
});

describe("pacing", () => {
  it("projects month end and flags over and under spend", () => {
    const s = base();
    const rows = monthlyPacing(s, "2026-10-11");
    expect(rows).toHaveLength(3);
    for (const r of rows) { expect(r.projected).not.toBeNull(); expect(["on_track", "overspend", "underspend"]).toContain(r.flag); }
    s.campaigns[0].plannedMonthlyBudget = 10000;
    expect(monthlyPacing(s, "2026-10-11")[0].flag).toBe("overspend");
  });
  it("says too early and no plan instead of guessing", () => {
    const s = base();
    expect(monthlyPacing(s, "2026-10-02")[0].flag).toBe("too_early");
    s.campaigns[0].plannedMonthlyBudget = null;
    expect(monthlyPacing(s, "2026-10-11")[0].flag).toBe("no_plan");
  });
});

describe("regions", () => {
  it("ranks by cost per funded and AUM per rupee, only with spend and enough sample", () => {
    const r = topRegions(full(), "city");
    expect(r.spendAvailable).toBe(true);
    expect(r.byCostPerFunded.length).toBeGreaterThan(0);
    const costs = r.byCostPerFunded.map((x) => x.costPerFunded as number);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    const aum = r.byAumPerRupee.map((x) => x.aumPerRupee as number);
    expect(aum).toEqual([...aum].sort((a, b) => b - a));
  });
  it("without spend by region it still lists them but does not fake a cost", () => {
    const r = topRegions(base(), "city");
    expect(r.spendAvailable).toBe(false);
    expect(r.byCostPerFunded).toHaveLength(0);
    expect(r.all[0].note).toMatch(/not reported/);
  });
});

describe("auction insights", () => {
  it("is not available without Google data and available with it", () => {
    expect(auctionInsights(base()).available).toBe(false);
    const a = auctionInsights(full());
    expect(a.available).toBe(true);
    if (a.available) expect(a.campaigns[0].competitors[0].competitor).toBe("rival-broker.example");
  });
  it("says Google only when no Google campaign exists", () => {
    const s = full(); s.campaigns = s.campaigns.filter((c) => c.platform === "meta");
    const a = auctionInsights(s);
    expect(a.available).toBe(false);
    if (!a.available) expect(a.reason).toMatch(/Google/);
  });
});

describe("tracking integrity", () => {
  it("finds double counting, a missing event and a broken import", () => {
    const kinds = trackingIntegrity(full()).findings.map((f) => f.kind);
    expect(kinds).toContain("duplicate_firing");
    expect(kinds).toContain("missing_event");
    expect(kinds).toContain("import_broken");
    expect(kinds).toContain("import_stale");
  });
  it("is unavailable, not clean, when no signals are connected", () => {
    expect(trackingIntegrity(base())).toEqual({ available: false, findings: [] });
  });
});

describe("recommendations and decisions", () => {
  const recs = () => buildRecommendations(full(), evaluateControls(full()));
  it("builds stable ids and only appliable kinds are marked appliable", () => {
    const r = recs();
    expect(new Set(r.map((x) => x.id)).size).toBe(r.length);
    expect(r.find((x) => x.action.kind === "fix_tracking")!.appliable).toBe(false);
    expect(r.every((x) => x.status === "PENDING")).toBe(true);
  });
  it("deny needs a reason; approve does not", () => {
    const r = recs()[0];
    expect(decide(r, "deny", "u1").ok).toBe(false);
    expect(decide(r, "deny", "u1", { reasonCode: "other" }).ok).toBe(false);
    expect(decide(r, "deny", "u1", { reasonCode: "other", note: "we run this on purpose" }).ok).toBe(true);
    expect(decide(r, "approve", "u1").ok).toBe(true);
    expect(decide({ ...r, status: "APPROVED" }, "approve", "u1").ok).toBe(false);
  });
  it("repeated quiet denials suppress a proposal; strictness denials become a hint only", () => {
    const r = recs()[0];
    const mk = (code: Decision["reasonCode"], day: number): Decision => ({ recId: r.id, ruleKey: r.ruleKey, targetKey: [...r.action.targetIds].sort().join(",") || "account", decision: "DENIED", reasonCode: code, note: null, actorId: "u", at: new Date(Date.UTC(2026, 9, day)).toISOString() });
    const now = new Date("2026-10-11T00:00:00Z");
    const t = tuneFromDenials([mk("not_relevant", 1), mk("already_handled", 5)], now);
    expect(t.suppressed).toHaveLength(1);
    expect(withoutSuppressed(recs(), t, now).some((x) => x.id === r.id)).toBe(false);
    const h = tuneFromDenials([mk("threshold_too_strict", 1), mk("threshold_too_strict", 2), mk("threshold_too_strict", 3)], now);
    expect(h.suppressed).toHaveLength(0);
    expect(h.thresholdHints).toHaveLength(1);
  });
});

describe("rules", () => {
  const rule: Rule = { id: "r1", name: "Pause expensive", enabled: true, metric: "cost_per_funded", op: ">", threshold: 3000, days: 28, campaignIds: null, accountIds: null, action: "pause_campaign" };
  it("validates", () => {
    expect(validateRule(rule)).toBeNull();
    expect(validateRule({ ...rule, days: 0 })).toMatch(/Days/);
    expect(validateRule({ ...rule, name: "" })).toMatch(/name/);
  });
  it("only proposes, and holds when the sample is too small", () => {
    const run = runRules(base(), [rule]);
    expect(run.proposals.every((p) => p.status === "PENDING")).toBe(true);
    expect(run.proposals.some((p) => p.action.targetIds[0] === "m2")).toBe(true);
    const small = runRules(base(), [{ ...rule, days: 1 }]);
    expect(small.proposals).toHaveLength(0);
    expect(small.outcomes.every((o) => !o.fired && o.held)).toBe(true);
  });
  it("ignores disabled rules", () => {
    expect(runRules(base(), [{ ...rule, enabled: false }]).outcomes).toHaveLength(0);
  });
});

describe("write safety", () => {
  const rec = () => ({ ...buildRecommendations(full(), evaluateControls(full())).find((r) => r.action.kind === "pause_campaign")!, status: "APPROVED" as const });
  it("does nothing when applying is off", async () => {
    const inner = createFakeActionProvider();
    const res = await guarded(inner, { applyEnabled: false }).apply(rec(), "u1");
    expect(res.ok).toBe(false); expect(inner.log).toHaveLength(0);
  });
  it("needs an approved proposal and a person", async () => {
    const inner = createFakeActionProvider(); const g = guarded(inner, { applyEnabled: true });
    expect((await g.apply({ ...rec(), status: "PENDING" }, "u1")).ok).toBe(false);
    expect((await g.apply(rec(), null)).ok).toBe(false);
    expect(inner.log).toHaveLength(0);
  });
  it("applies once even if asked twice", async () => {
    const inner = createFakeActionProvider(); const g = guarded(inner, { applyEnabled: true }); const r = rec();
    await g.apply(r, "u1"); await g.apply(r, "u1");
    expect(inner.log.filter((l) => l.startsWith("apply"))).toHaveLength(1);
  });
  it("refuses a budget change that is not a modest cut", async () => {
    const g = guarded(createFakeActionProvider(), { applyEnabled: true });
    const r = { ...rec(), action: { kind: "reduce_budget" as const, targetIds: ["m1"], summary: "", params: { cutFraction: 0.8 } } };
    expect((await g.apply(r, "u1")).ok).toBe(false);
    expect((await g.apply({ ...r, id: "b", action: { ...r.action, params: { cutFraction: 0.2 } } }, "u1")).ok).toBe(true);
  });
  it("creates campaigns paused and turns them on only with a second person, clear compliance and the annexure", async () => {
    const inner = createFakeActionProvider(); const g = guarded(inner, { applyEnabled: true });
    const spec = { name: "T", platform: "meta" as const, objective: "leads", dailyBudget: 500, geo: {}, schedule: {}, bidding: {}, landingUrl: "https://example.test", copy: { headline: "h", body: "b" }, audience: {} };
    const made = await g.launchPaused(spec, "u1"); expect(made.ok).toBe(true);
    const id = made.ok ? made.externalId : "";
    expect(inner.campaigns.get(id)).toBe("PAUSED");
    const draft = { externalId: id, status: "LAUNCHED_PAUSED", createdById: "u1", complianceOk: true, annexureApproved: true };
    expect((await g.activate(draft, "u1")).ok).toBe(false);
    expect((await g.activate({ ...draft, annexureApproved: false }, "u2")).ok).toBe(false);
    expect((await g.activate({ ...draft, complianceOk: false }, "u2")).ok).toBe(false);
    expect((await g.activate({ ...draft, status: "DRAFT" }, "u2")).ok).toBe(false);
    expect(inner.campaigns.get(id)).toBe("PAUSED");
    expect((await g.activate(draft, "u2")).ok).toBe(true);
    expect(inner.campaigns.get(id)).toBe("ACTIVE");
  });
  it("refuses an insecure landing page at launch", async () => {
    const g = guarded(createFakeActionProvider(), { applyEnabled: true });
    expect((await g.launchPaused({ name: "T", platform: "meta", objective: "leads", dailyBudget: 500, geo: {}, schedule: {}, bidding: {}, landingUrl: "http://x.test", copy: { headline: "", body: "" }, audience: {} }, "u1")).ok).toBe(false);
  });
});

describe("launch drafts", () => {
  const input: LaunchInput = { name: "Pune demat", objective: "funded_customers", platform: "meta", totalBudget: 60000, days: 30, audience: { description: "Salaried 25-40" }, geo: { kind: "cities", values: ["Pune"] }, landingUrl: "https://example.test/open", copy: { headline: "Open a demat account", body: "Investments in securities markets are subject to market risks. Read all related documents carefully before investing." } };
  it("estimates from our own funnel as ranges with assumptions", () => {
    const d = buildLaunchDraft(input, base());
    expect(d.estimates.available).toBe(true);
    if (d.estimates.available) {
      expect(d.estimates.clicks.low).toBeLessThan(d.estimates.clicks.high);
      expect(d.estimates.funded.low).toBeLessThanOrEqual(d.estimates.funded.high);
      expect(d.estimates.assumptions.length).toBeGreaterThanOrEqual(3);
      expect(d.estimates.label).toMatch(/Estimate/);
    }
    expect(d.schedule.startsPaused).toBe(true);
    expect(d.dailyBudget).toBe(2000);
  });
  it("refuses to estimate without enough history", () => {
    const s = base(); s.days = []; s.leads = [];
    const e = estimate(input, historicalFunnel(s, "meta"));
    expect(e.available).toBe(false);
  });
  it("blocks on promised returns and flags manual items", () => {
    const d = buildLaunchDraft({ ...input, copy: { headline: "Guaranteed 20% returns, act now", body: "" } }, base());
    expect(d.complianceClear).toBe(false);
    expect(d.checklist.some((c) => c.state === "fail")).toBe(true);
    expect(d.checklist.some((c) => c.label.includes("annexure") && c.state === "manual")).toBe(true);
  });
  it("validates inputs", () => {
    expect(buildLaunchDraft({ ...input, totalBudget: 0, geo: { kind: "cities", values: [] } }, base()).errors.length).toBe(2);
  });
});

describe("ask autopilot", () => {
  it("routes by keyword and cites numbers with data age", () => {
    const calls = planByKeywords("how much are we wasting?");
    expect(calls[0].tool).toBe("wasted_spend");
    const a = answer("how much are we wasting?", calls, full());
    expect(a.cites.length).toBeGreaterThan(0);
    expect(a.dataAge).toMatch(/old/);
    expect(a.lines.join(" ")).toMatch(/₹/);
  });
  it("only ever offers drafts for actions", () => {
    const a = answer("what should we fix?", planByKeywords("what should we fix"), full());
    expect(a.draftProposals.every((p) => p.status === "PENDING")).toBe(true);
    expect(a.note).toMatch(/cannot change anything/);
  });
  it("ignores tools the model invents and falls back on bad output", async () => {
    const bad = await planWithModel("drop table", new FakeProvider('{"tools":[{"tool":"run_sql","args":{"q":"drop table"}}]}'), []);
    expect(bad.every((c) => TOOL_NAMES.includes(c.tool))).toBe(true);
    const junk = await planWithModel("waste?", new FakeProvider("not json"), []);
    expect(junk[0].tool).toBe("wasted_spend");
    const err = await planWithModel("waste?", new FakeProvider(new Error("down")), []);
    expect(err[0].tool).toBe("wasted_spend");
  });
  it("passes only whitelisted tools through", async () => {
    const ok = await planWithModel("regions", new FakeProvider('{"tools":[{"tool":"top_regions","args":{"kind":"state"}},{"tool":"x"}]}'), []);
    expect(ok).toEqual([{ tool: "top_regions", args: { kind: "state" } }]);
  });
  it("says so when a campaign is not found", () => {
    const a = answer("?", [{ tool: "campaign_detail", args: { campaign: "zzz" } }], full());
    expect(a.lines[0]).toMatch(/No campaign/);
  });
});
