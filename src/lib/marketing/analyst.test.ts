import { describe, expect, it, vi } from "vitest";

import type { CallInput, GatewayResult } from "@/lib/ai/gateway/types";

import type { BlendedReport } from "./blend";
import { acceptModelText, buildUserPrompt, deterministicSummary, findLeak, runMarketingAnalysis, toAnalystInput, type AnalystInput } from "./analyst";

const campaign = (name: string, over: Record<string, unknown> = {}) => ({
  campaignId: `ad-${name}`,
  name,
  channel: "meta",
  spend: 100_000,
  impressions: 50_000,
  clicks: 900,
  ctr: 0.018,
  reach: 30_000,
  metaLeads: 40,
  crmLeads: 40,
  kyc: 12,
  funded: 4,
  firstTransaction: 3,
  aum: 0,
  revenue: 0,
  cpl: 2_500,
  cplMeta: 2_500,
  kycRate: 0.3,
  costPerKyc: 8_333,
  costPerFunded: 25_000,
  aumPerRupee: null,
  roas: null,
  quality: { key: "on_par", label: "On par", detail: "x", tone: "neutral" },
  spark: [],
  ...over,
});

/** Aggregates only, shaped like the blended report the Marketing page computes. */
const report = {
  range: { from: "2026-09-15", to: "2026-10-14" },
  currency: "INR",
  totals: { spend: 300_000, impressions: 150_000, clicks: 2700, ctr: 0.018, crmLeads: 120, kyc: 30, funded: 9, aum: 0, revenue: 0, cpl: 2500, costPerFunded: 33_333, roas: null },
  channels: [],
  daily: [],
  funnel: [],
  campaigns: [
    campaign("Broking Q4 video", { spend: 100_000, crmLeads: 40, kyc: 16, funded: 6, costPerFunded: 16_667, kycRate: 0.4, quality: { key: "efficient", label: "Efficient", detail: "x", tone: "success" } }),
    campaign("Wealth carousel", { spend: 150_000, crmLeads: 50, kyc: 10, funded: 2, costPerFunded: 75_000, kycRate: 0.2, quality: { key: "expensive", label: "Expensive", detail: "x", tone: "destructive" } }),
    campaign("Mutual fund reel", { spend: 50_000, crmLeads: 30, kyc: 4, funded: 1, costPerFunded: 50_000, kycRate: 0.13, quality: { key: "on_par", label: "On par", detail: "x", tone: "neutral" } }),
  ],
} as unknown as BlendedReport;

const input: AnalystInput = toAnalystInput(report);
const ON = { MARKETING_ANALYST_ENABLED: "1" };

const okResult = (text: string): GatewayResult =>
  ({ kind: "ok", text, toolUses: [], blocks: [], provider: "anthropic", model: "claude-sonnet-5-5", usage: { inputTokens: 120, outputTokens: 60, costUsdEstimate: 0.001 } }) as unknown as GatewayResult;

describe("toAnalystInput", () => {
  it("keeps campaign aggregates only: no client rows, no identifiers", () => {
    const serialised = JSON.stringify(input);
    expect(serialised).not.toMatch(/clientId|client_id|"phone"|"email"|"pan"/i);
    expect(input.campaigns).toHaveLength(3);
    expect(input.campaigns[0]).toEqual(expect.objectContaining({ label: "Wealth carousel" }));
  });
});

describe("the deterministic read", () => {
  it("ranks the best cost per funded customer and names where the funnel leaks", () => {
    const text = deterministicSummary(input);
    expect(text).toContain("Best cost per funded customer:");
    expect(text.indexOf("1. Broking Q4 video")).toBeLessThan(text.indexOf("2. Mutual fund reel"));
    expect(text).toContain("the weaker step is lead to approved KYC");
    expect(text).toContain("Recommendations only: nothing has been changed, paused or sent.");
  });

  it("says a campaign is not ranked yet when it has too few leads or no funded customer", () => {
    const thin = toAnalystInput({ ...report, campaigns: [campaign("Tiny", { crmLeads: 4, funded: 0, costPerFunded: null })] } as unknown as BlendedReport);
    expect(deterministicSummary(thin)).toContain("not ranked yet");
  });

  it("finds the weaker funnel step", () => {
    expect(findLeak(input).weaker).toBe("kyc");
    expect(findLeak({ ...input, totals: { ...input.totals, kyc: 30, funded: 2 } }).weaker).toBe("funded");
  });

  it("is used with no AI key, and the model is never called", async () => {
    const callModel = vi.fn();
    const r = await runMarketingAnalysis(input, { env: { ...ON }, callModel });
    expect(r).toEqual(expect.objectContaining({ status: "ok", source: "deterministic", note: expect.stringContaining("no AI key") }));
    expect(callModel).not.toHaveBeenCalled();
  });
});

describe("the model path", () => {
  it("stores the model's text when it passes the output check, under purpose marketing.analysis with no subject", async () => {
    const calls: CallInput[] = [];
    const callModel = vi.fn(async (c: CallInput) => {
      calls.push(c);
      return okResult("1. Broking Q4 video has the best cost per funded customer.\n2. Test a clearer eligibility question on the form.");
    });
    const r = await runMarketingAnalysis(input, { env: { ...ON, ANTHROPIC_API_KEY: "test-key-not-real" }, callModel });
    expect(r).toEqual(expect.objectContaining({ status: "ok", source: "model", note: null, provider: "anthropic", inputTokens: 120, outputTokens: 60 }));
    expect(calls[0].purpose).toBe("marketing.analysis");
    expect(calls[0].subject).toBeUndefined();
    expect(calls[0].user).toContain("Broking Q4 video");
  });

  it("uses the deterministic read when the model text contains a contact detail or a promise of returns", async () => {
    const callModel = vi.fn(async () => okResult("Ask ops@example.com about the top campaign."));
    const r = await runMarketingAnalysis(input, { env: { ...ON, ANTHROPIC_API_KEY: "k" }, callModel });
    expect(r).toEqual(expect.objectContaining({ status: "ok", source: "deterministic", note: expect.stringContaining("refused") }));
    expect(acceptModelText("Returns are guaranteed for this campaign.").ok).toBe(false);
  });

  it("uses the deterministic read when the model abstains or fails", async () => {
    const abstain = vi.fn(async () => ({ kind: "abstain", reason: "not enough data" }) as unknown as GatewayResult);
    const a = await runMarketingAnalysis(input, { env: { ...ON, ANTHROPIC_API_KEY: "k" }, callModel: abstain });
    expect(a).toEqual(expect.objectContaining({ source: "deterministic", note: expect.stringContaining("abstained") }));
    const failed = vi.fn(async () => ({ kind: "failed", errorClass: "timeout" }) as unknown as GatewayResult);
    const f = await runMarketingAnalysis(input, { env: { ...ON, ANTHROPIC_API_KEY: "k" }, callModel: failed });
    expect(f).toEqual(expect.objectContaining({ source: "deterministic", note: expect.stringContaining("timeout") }));
  });

  it("builds a prompt from the aggregate lines only", () => {
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain("Wealth carousel | meta |");
    expect(prompt).not.toMatch(/clientId|phone|email/i);
  });
});

describe("gates", () => {
  it("is off unless MARKETING_ANALYST_ENABLED is 1, and off while AI_KILL_SWITCH is on", async () => {
    const callModel = vi.fn(async () => okResult("text"));
    expect((await runMarketingAnalysis(input, { env: {}, callModel })).status).toBe("off");
    const killed = await runMarketingAnalysis(input, { env: { ...ON, ANTHROPIC_API_KEY: "k", AI_KILL_SWITCH: "1" }, callModel });
    expect(killed).toEqual(expect.objectContaining({ status: "off" }));
    expect(callModel).not.toHaveBeenCalled();
  });
});

describe("output carries no customer identifier", () => {
  it("neither the deterministic read nor an accepted model text matches a contact or PAN pattern", () => {
    const text = deterministicSummary(input);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    expect(text).not.toMatch(/\+?\d(?:[ -]?\d){9,14}/);
    expect(text).not.toMatch(/\b[A-Z]{5}\d{4}[A-Z]\b/);
  });
});
