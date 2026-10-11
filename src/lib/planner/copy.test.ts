import { describe, expect, it } from "vitest";

import { FakeProvider } from "@/lib/ai/provider";

import { PLANNER_COPY_AGENT_KEY, appendDisclaimer, checkCopyDraft, draftCopyWithAi } from "./copy";
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

describe("draftCopyWithAi", () => {
  it("does nothing when the kill switch is off", async () => {
    const provider = new FakeProvider("x");
    expect(await draftCopyWithAi(ctx, { provider, isEnabled: async () => false })).toEqual({ ok: false, reason: "disabled" });
    expect(provider.calls).toHaveLength(0);
  });
  it("returns the model text with the disclaimer added by code, within the channel limit", async () => {
    const provider = new FakeProvider((req) => (req.system.includes("compliance reviewer") ? "SAFE" : "Find out if your retirement plan is on track. Takes about a minute."));
    const r = await draftCopyWithAi(ctx, { provider, ...on });
    expect(r.ok && r.body).toContain("Find out if your retirement plan is on track.");
    expect(r.ok && r.body).toContain(SHORT_DISCLAIMER);
    expect(r.ok && r.body.length).toBeLessThanOrEqual(CHANNELS.search_ad.maxChars);
  });
  it("rejects unsafe model output before it is ever shown", async () => {
    const provider = new FakeProvider("Guaranteed 12% returns, invest now");
    expect(await draftCopyWithAi(ctx, { provider, ...on })).toMatchObject({ ok: false, reason: "unsafe" });
  });
  it("rejects what the judge calls unsafe", async () => {
    const provider = new FakeProvider((req) => (req.system.includes("compliance reviewer") ? "UNSAFE: implies advice" : "A calm line about planning."));
    expect(await draftCopyWithAi(ctx, { provider, ...on })).toMatchObject({ ok: false, reason: "unsafe", detail: expect.stringContaining("advice") });
  });
  it("fails closed when the provider is down", async () => {
    expect(await draftCopyWithAi(ctx, { provider: new FakeProvider(new Error("down")), ...on })).toEqual({ ok: false, reason: "unavailable" });
  });
  it("sends only the scrubbed plan facts to the vendor, never a person's details", async () => {
    const provider = new FakeProvider((req) => (req.system.includes("compliance reviewer") ? "SAFE" : "A calm line."));
    await draftCopyWithAi({ ...ctx, hook: "Call 9876543210 or mail asha@example.com" }, { provider, ...on });
    const sent = provider.calls[0].user;
    expect(sent).not.toMatch(/9876543210|asha@example\.com/);
  });
  it("has its own agent key", () => {
    expect(PLANNER_COPY_AGENT_KEY).toBe("planner_copy");
  });
});
