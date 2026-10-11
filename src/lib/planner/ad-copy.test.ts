import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { checkAdCopy, AD_COPY_BASE } from "./ad-copy";

describe("checkAdCopy: the planner's one door to the agent guardrails", () => {
  it("passes plain educational copy", () => {
    expect(checkAdCopy("Check how your savings are spread across funds with our free portfolio check.", { maxChars: 250 })).toEqual({ ok: true, issues: [] });
  });
  it("blocks guaranteed returns, advice and performance claims through the canonical guardrails", () => {
    expect(checkAdCopy("Guaranteed 12% returns every year", { maxChars: 250 }).issues.map((i) => i.code)).toContain("RETURN_PROMISE");
    expect(checkAdCopy("You should buy this fund today", { maxChars: 250 }).issues.map((i) => i.code)).toContain("ADVICE");
    expect(checkAdCopy("Our fund gave 18% returns last year", { maxChars: 250 }).issues.map((i) => i.code)).toContain("PERFORMANCE_CLAIM");
  });
  it("adds the ad rules (urgency, superlatives, hype) on top", () => {
    const codes = checkAdCopy("Hurry, the best fund, last chance", { maxChars: 250 }).issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["URGENCY", "SUPERLATIVE"]));
  });
  it("refuses empty and over-long copy, and an echoed identifier", () => {
    expect(checkAdCopy("   ", { maxChars: 250 }).issues[0].code).toBe("EMPTY");
    expect(checkAdCopy("x".repeat(300), { maxChars: 250 }).issues.map((i) => i.code)).toContain("TOO_LONG");
    expect(checkAdCopy("Call me on 9876543210 now", { maxChars: 250 }).issues.map((i) => i.code)).toContain("PII_ECHO");
  });
  it("names the swap point for the shared checker", () => {
    expect(AD_COPY_BASE).toBe("agents/guardrails.checkCopy");
  });
});

describe("the seam is the only place that touches the base guardrails", () => {
  it("no other planner source imports the agent guardrails directly", () => {
    const dir = process.cwd() + "/src/lib/planner";
    const offenders = readdirSync(dir)
      .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f) && f !== "ad-copy.ts")
      .filter((f) => /@\/lib\/agents\/guardrails/.test(readFileSync(join(dir, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
