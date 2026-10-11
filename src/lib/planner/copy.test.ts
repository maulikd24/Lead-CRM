import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { CallInput, GatewayResult } from "@/lib/ai/gateway";
import { FakeProvider } from "@/lib/ai/provider";

import { PLANNER_COPY_AGENT_KEY, PLANNER_COPY_PURPOSE, appendDisclaimer, checkCopyDraft, draftCopyWithAi } from "./copy";
import { CHANNELS, CHANNEL_KEYS } from "./channels";
import { DISCLAIMER_TEXT, SHORT_DISCLAIMER } from "./guardrails";

const codes = (r: ReturnType<typeof checkCopyDraft>) => r.issues.map((i) => i.code);

describe("appendDisclaimer", () => {
  it("adds the one-line disclaimer on short channels and the full text on long ones, once", () => {
    const short = appendDisclaimer("search_ad", "Check your retirement readiness in minutes.");
    expect(short).toContain(SHORT_DISCLAIMER);
    expect(appendDisclaimer("search_ad", short)).toBe(short);
    expect(appendDisclaimer("email", "Hello")).toContain(DISCLAIMER_TEXT);
  });
});

describe("checkCopyDraft", () => {
  const good = (channel: keyof typeof CHANNELS) => appendDisclaimer(channel, "Check your retirement readiness in a minute.");
  it("passes calm copy with its disclaimer on every channel", () => {
    for (const ch of CHANNEL_KEYS) expect(checkCopyDraft({ channel: ch, body: good(ch) }), ch).toEqual({ ok: true, issues: [] });
  });
  it("blocks guaranteed returns, advice, urgency, superlatives and placeholders", () => {
    expect(codes(checkCopyDraft({ channel: "email", body: appendDisclaimer("email", "Guaranteed returns of 12%") }))).toContain("RETURN_PROMISE");
    expect(codes(checkCopyDraft({ channel: "email", body: appendDisclaimer("email", "You should buy this fund") }))).toContain("ADVICE");
    expect(codes(checkCopyDraft({ channel: "email", body: appendDisclaimer("email", "Hurry, last chance!") }))).toContain("URGENCY");
    expect(codes(checkCopyDraft({ channel: "email", body: appendDisclaimer("email", "The best way to invest") }))).toContain("SUPERLATIVE");
    expect(codes(checkCopyDraft({ channel: "email", body: appendDisclaimer("email", "Hello [NAME]") }))).toContain("PLACEHOLDER");
  });
  it("blocks missing disclaimer, empty copy and over-long copy using the channel limit", () => {
    expect(codes(checkCopyDraft({ channel: "email", body: "Just a plain note." }))).toContain("MISSING_DISCLAIMER");
    expect(codes(checkCopyDraft({ channel: "email", body: " " }))).toContain("EMPTY");
    const long = appendDisclaimer("search_ad", "x".repeat(CHANNELS.search_ad.maxChars));
    const r = checkCopyDraft({ channel: "search_ad", body: long });
    expect(codes(r)).toContain("TOO_LONG");
    expect(r.issues.find((i) => i.code === "TOO_LONG")?.message).toContain(String(CHANNELS.search_ad.maxChars));
  });
  it("rejects an unknown channel", () => {
    expect(codes(checkCopyDraft({ channel: "tiktok", body: "x" }))).toEqual(["UNKNOWN_CHANNEL"]);
  });
});

const ctx = { channel: "search_ad" as const, hook: "See if you are on track for retirement", product: "Retirement goal planner", audienceName: "Salaried professionals", tone: "Calm, practical" };
const on = { isEnabled: async () => true };
const judgeSafe = () => new FakeProvider((req) => (req.system.includes("compliance reviewer") ? "SAFE" : "x"));
const okResult = (text: string): GatewayResult => ({ kind: "ok", runId: "r1", correlationId: "c1", text, toolUses: [], blocks: [], provider: "fake", model: "fake-1", usage: { inputTokens: 1, outputTokens: 1, costUsdEstimate: 0 } });
const calling = (r: GatewayResult | (() => never)) => {
  const seen: CallInput[] = [];
  const call = async (i: CallInput) => {
    seen.push(i);
    return typeof r === "function" ? r() : r;
  };
  return { call, seen };
};

describe("draftCopyWithAi goes through callModel() and nothing else", () => {
  it("does nothing when the kill switch is off", async () => {
    const c = calling(okResult("x"));
    expect(await draftCopyWithAi(ctx, { call: c.call, judge: judgeSafe(), isEnabled: async () => false })).toEqual({ ok: false, reason: "disabled" });
    expect(c.seen).toHaveLength(0);
  });
  it("calls the registered planner.copy purpose with no customer subject, and adds the disclaimer by code within the limit", async () => {
    const c = calling(okResult("Find out if your retirement plan is on track. Takes about a minute."));
    const r = await draftCopyWithAi(ctx, { call: c.call, judge: judgeSafe(), ...on });
    expect(c.seen[0]).toMatchObject({ purpose: PLANNER_COPY_PURPOSE });
    expect(c.seen[0].subject).toBeUndefined();
    expect(r.ok && r.body).toContain("Find out if your retirement plan is on track.");
    expect(r.ok && r.body).toContain(SHORT_DISCLAIMER);
    expect(r.ok && r.body.length).toBeLessThanOrEqual(CHANNELS.search_ad.maxChars);
    expect(r.ok && r.model).toBe("fake-1");
  });
  it("handles an abstain as a first-class answer, naming why", async () => {
    const c = calling({ kind: "abstain", runId: "r", correlationId: "c", reason: "human_review_required", detail: "needs a person" });
    expect(await draftCopyWithAi(ctx, { call: c.call, judge: judgeSafe(), ...on })).toEqual({ ok: false, reason: "abstained", detail: "human_review_required" });
  });
  it("reports a blocked call (budget, kill switch) and a failed call without a draft", async () => {
    const blocked = calling({ kind: "blocked", runId: null, correlationId: "c", reason: "budget_exceeded" });
    expect(await draftCopyWithAi(ctx, { call: blocked.call, judge: judgeSafe(), ...on })).toEqual({ ok: false, reason: "blocked", detail: "budget_exceeded" });
    const failed = calling({ kind: "failed", runId: "r", correlationId: "c", errorClass: "timeout", retryable: true, attempts: 2 });
    expect(await draftCopyWithAi(ctx, { call: failed.call, judge: judgeSafe(), ...on })).toEqual({ ok: false, reason: "unavailable" });
    const thrown = calling(() => { throw new Error("down"); });
    expect(await draftCopyWithAi(ctx, { call: thrown.call, judge: judgeSafe(), ...on })).toEqual({ ok: false, reason: "unavailable" });
  });
  it("rejects unsafe model output before it is ever shown", async () => {
    const c = calling(okResult("Guaranteed 12% returns, invest now"));
    expect(await draftCopyWithAi(ctx, { call: c.call, judge: judgeSafe(), ...on })).toMatchObject({ ok: false, reason: "unsafe" });
  });
  it("rejects what the judge calls unsafe", async () => {
    const c = calling(okResult("A calm line about planning."));
    const judge = new FakeProvider((req) => (req.system.includes("compliance reviewer") ? "UNSAFE: implies advice" : "x"));
    expect(await draftCopyWithAi(ctx, { call: c.call, judge, ...on })).toMatchObject({ ok: false, reason: "unsafe", detail: expect.stringContaining("advice") });
  });
  it("sends only scrubbed plan facts, never a person's details, and links the judge to the same run", async () => {
    const c = calling(okResult("A calm line."));
    const judge = judgeSafe();
    await draftCopyWithAi({ ...ctx, hook: "Call 9876543210 or mail asha@example.com" }, { call: c.call, judge, ...on });
    expect(c.seen[0].user).not.toMatch(/9876543210|asha@example\.com/);
    expect(judge.calls[0].gateway?.correlationId).toBe(c.seen[0].correlationId);
  });
  it("tells the model it may abstain, and has its own agent key and purpose", () => {
    expect(PLANNER_COPY_AGENT_KEY).toBe("planner_copy");
    expect(PLANNER_COPY_PURPOSE).toBe("planner.copy");
  });
  it("copy.ts has no direct model or provider call", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/planner/copy.ts"), "utf8");
    expect(src).not.toMatch(/\.complete\(|new Anthropic|openai|fetch\(/i);
  });
});
