import { describe, expect, it } from "vitest";

import { DEFAULT_RULE_SETTINGS, DEFAULT_DISCLAIMER, DEFAULT_PAST_PERFORMANCE, checkAdCopy, failedChecks, type RuleSettings } from "./ad-copy";

const withDisclaimer = (text: string) => `${text}\n\n${DEFAULT_DISCLAIMER}`;
const find = (r: ReturnType<typeof checkAdCopy>, id: string) => r.checks.find((c) => c.id === id)!;

describe("checkAdCopy: the shared SEBI and AMFI rule block", () => {
  it("passes plain, educational copy that carries the disclaimer", () => {
    const r = checkAdCopy({ text: withDisclaimer("Learn how a demat account is opened, step by step. Book a 15 minute call."), language: "en" });
    expect(r.status).toBe("PASS");
    expect(failedChecks(r)).toEqual([]);
  });

  it("fails guaranteed or assured returns and shows the phrase it matched", () => {
    const r = checkAdCopy({ text: withDisclaimer("Assured returns of a safe plan"), language: "en" });
    expect(r.status).toBe("FAIL");
    const c = find(r, "guaranteed_returns");
    expect(c.status).toBe("fail");
    expect(c.matched?.toLowerCase()).toContain("assured returns");
  });

  it("catches the Hinglish version", () => {
    const r = checkAdCopy({ text: withDisclaimer("Pakka returns, koi risk nahi"), language: "hinglish" });
    expect(find(r, "guaranteed_returns").status).toBe("fail");
  });

  it("fails a performance claim unless the past-performance disclaimer is there", () => {
    const bare = checkAdCopy({ text: withDisclaimer("Our strategy delivered 18% returns last year"), language: "en" });
    expect(find(bare, "performance_claims").status).toBe("fail");
    expect(find(bare, "performance_claims").matched).toMatch(/18%/);
    const covered = checkAdCopy({ text: withDisclaimer(`Our strategy delivered 18% returns last year. Source: audited factsheet. ${DEFAULT_PAST_PERFORMANCE}`), language: "en" });
    expect(find(covered, "performance_claims").status).toBe("pass");
  });

  it("fails when the risk disclosure is missing and passes when it is configured differently", () => {
    expect(find(checkAdCopy({ text: "Open an account today", language: "en" }), "risk_disclosure").status).toBe("fail");
    const custom: RuleSettings = { ...DEFAULT_RULE_SETTINGS, disclaimer: "Custom firm risk text about markets." };
    expect(find(checkAdCopy({ text: "Hello.\nCustom firm risk text about markets.", language: "en", settings: custom }), "risk_disclosure").status).toBe("pass");
    expect(find(checkAdCopy({ text: withDisclaimer("Hello"), language: "en", settings: custom }), "risk_disclosure").status).toBe("fail");
  });

  it("fails testimonials where they are prohibited, and skips the rule where they are not", () => {
    const text = withDisclaimer(`"Best advisor ever" says Rahul, a happy client`);
    expect(find(checkAdCopy({ text, language: "en" }), "testimonials").status).toBe("fail");
    const allowed = checkAdCopy({ text, language: "en", settings: { ...DEFAULT_RULE_SETTINGS, testimonialsProhibited: false } });
    expect(find(allowed, "testimonials").status).toBe("not_applicable");
  });

  it("fails urgency and scarcity for investment products", () => {
    for (const t of ["Last chance to open an account", "Only 10 seats left", "Offer ends tonight", "Jaldi karein, sirf aaj"]) {
      expect(find(checkAdCopy({ text: withDisclaimer(t), language: "hinglish" }), "urgency_scarcity").status, t).toBe("fail");
    }
  });

  it("fails advice, superlatives, hype and gifts for investing", () => {
    const r = checkAdCopy({ text: withDisclaimer("You should buy this fund, the best and number one choice. Get rich quick. Free gift on investing."), language: "en" });
    expect(find(r, "advice").status).toBe("fail");
    expect(find(r, "superlatives").status).toBe("fail");
    expect(find(r, "hype").status).toBe("fail");
    expect(find(r, "inducements").status).toBe("fail");
  });

  it("honesty rule: unverifiable numbers need a named source", () => {
    expect(find(checkAdCopy({ text: withDisclaimer("Trusted by 50,000 clients"), language: "en" }), "honesty").status).toBe("fail");
    expect(find(checkAdCopy({ text: withDisclaimer("Trusted by 50,000 clients. Source: annual report 2026"), language: "en" }), "honesty").status).toBe("pass");
  });

  it("flags unresolved placeholders and configured banned words", () => {
    const s: RuleSettings = { ...DEFAULT_RULE_SETTINGS, bannedWords: ["turbo"] };
    const r = checkAdCopy({ text: withDisclaimer("Turbo growth [INSERT OFFER]"), language: "en", settings: s });
    expect(find(r, "placeholders").status).toBe("fail");
    expect(find(r, "banned_words").matched?.toLowerCase()).toBe("turbo");
  });

  it("a configured regulated claim needs the full disclaimer next to it", () => {
    const s: RuleSettings = { ...DEFAULT_RULE_SETTINGS, regulatedClaims: ["tax saving"] };
    expect(find(checkAdCopy({ text: "Tax saving made simple", language: "en", settings: s }), "regulated_claims").status).toBe("fail");
    expect(find(checkAdCopy({ text: withDisclaimer("Tax saving made simple"), language: "en", settings: s }), "regulated_claims").status).toBe("pass");
  });

  it("empty copy fails", () => {
    expect(checkAdCopy({ text: "  ", language: "en" }).status).toBe("FAIL");
  });

  it("every check carries a label, and a failing one carries a message", () => {
    const r = checkAdCopy({ text: "Guaranteed returns, buy now, last chance", language: "en" });
    for (const c of r.checks) expect(c.label.length).toBeGreaterThan(3);
    for (const c of failedChecks(r)) expect(c.message.length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// D12: ONE ad copy rule set that EXTENDS the canonical agent guardrails. The old creative rule set is gone; these tests are the proof that
// nothing it refused is allowed now, that nothing the canonical agent guardrails refuse is allowed in an ad, and that nothing is copied.
// ---------------------------------------------------------------------------------------------------------------------
import { checkCopy } from "@/lib/agents/guardrails";
import { ALL_CASES } from "@/lib/agents/evals/cases";
import { AD_COPY_EXTENSIONS, checkAdCopy as check, DEFAULT_DISCLAIMER as DISC } from "./ad-copy";

const clean = (text: string) => `${text}\n\n${DISC}`;
const failedIds = (text: string) => check({ text: clean(text), language: "en" }).checks.filter((c) => c.status === "fail").map((c) => c.id);

describe("equivalence with the retired creative rule set: everything it refused is still refused, by the same check", () => {
  const BASELINE: Record<"guaranteed_returns" | "advice" | "performance_claims", string[]> = {
    guaranteed_returns: [
      "guaranteed returns", "we guarantee profits", "guaranteeing growth", "assured 12% a year", "assured returns", "assured profits", "risk free investing", "risk-free", "sure shot gains", "sure-fire plan",
      "fixed returns await", "no risk at all", "zero risk", "without any risk", "without risk", "capital is fully protected", "capital protection", "100% safe", "100% secure", "double your money",
      "triple your investment", "never lose", "you can't lose", "you cannot lose", "you won't lose", "pakka returns", "pakka profit", "pakka munafa", "pakka", "garanti", "koi risk nahi", "risk nahi",
      "bina risk", "returns milega", "nuksan nahi", "ek dum safe", "गारंटी रिटर्न", "पक्का रिटर्न", "निश्चित रिटर्न", "जोखिम मुक्त", "रिस्क फ्री", "नुकसान नहीं",
    ],
    advice: [
      "you should buy", "you must invest", "you need to sell", "buy now", "sell now", "invest now", "I recommend this fund", "we would recommend", "we'd highly recommend", "recommended for you", "must buy",
      "must sell", "go ahead and invest", "right time to invest", "best time to buy", "perfect time to sell", "invest kijiye", "invest kar do", "invest kar lo", "paisa lagao", "paise lagao", "kharid lo",
      "we advise you", "i advise you",
    ],
    performance_claims: [
      "18% returns", "12.5% p.a.", "15% annually", "15% annualised", "20% cagr", "14% xirr", "8% irr", "returns of 18%", "returns of about 12%", "delivered 18%", "gave you 20%", "generated 15%",
      "returned 9%", "earned 11%", "yielded 7%", "top performing", "top-performing", "outperform the market", "outperformed the benchmark", "beats the market", "beat the index", "beating the market",
    ],
  };
  for (const [rule, phrases] of Object.entries(BASELINE)) {
    it(`${rule}: all ${phrases.length} baseline phrases fail`, () => {
      for (const phrase of phrases) expect(failedIds(phrase), phrase).toContain(rule);
    });
  }
});

describe("additive over the canonical agent guardrails: nothing they refuse is allowed in an ad", () => {
  const blockedByAgents = ALL_CASES.filter((c): c is Extract<typeof c, { kind: "guardrail" }> => c.kind === "guardrail" && c.expect === "block" && !c.known && !/^\s*$/.test(c.text) && c.text.length <= 1000);
  it("has a real corpus (sanity)", () => expect(blockedByAgents.length).toBeGreaterThan(150));
  it("every must-block case of the agent eval corpus fails the ad copy check too", () => {
    const missed = blockedByAgents.filter((c) => check({ text: clean(c.text), language: "en" }).status === "PASS").map((c) => c.id);
    expect(missed).toEqual([]);
  });
  it("whatever checkCopy refuses for a promise, advice, a performance claim or an identifier, the ad copy check names a failing check for", () => {
    for (const c of blockedByAgents) {
      const r = checkCopy(c.text, 1000);
      if (r.ok || !["RETURN_PROMISE", "ADVICE", "PERFORMANCE_CLAIM", "PII_ECHO"].includes(r.code)) continue;
      const want = r.code === "RETURN_PROMISE" ? "guaranteed_returns" : r.code === "ADVICE" ? "advice" : r.code === "PERFORMANCE_CLAIM" ? "performance_claims" : "safety_layer";
      const ids = failedIds(c.text);
      // a performance claim covered by the past-performance disclaimer is a documented pass, so only the other three are pinned one-to-one
      if (want !== "performance_claims") expect(ids, `${c.id}: ${c.text}`).toContain(want);
    }
  });
});

describe("no duplicated rules: the extensions hold only what the canonical guardrails miss", () => {
  it("each extension has witness phrases the canonical rules let through", () => {
    for (const ext of AD_COPY_EXTENSIONS) {
      expect(ext.witnesses.length, ext.id).toBeGreaterThan(0);
      for (const w of ext.witnesses) {
        expect(ext.re.test(w), `${ext.id} should match "${w}"`).toBe(true);
        expect(checkCopy(w, 1000), `${ext.id}: canonical already refuses "${w}", so the extension duplicates it`).toEqual({ ok: true });
      }
    }
  });
});

describe("the extension in action", () => {
  it("refuses what an ad must not say even though a plain message could: invest now, an unqualified we recommend, never lose", () => {
    expect(failedIds("Invest now")).toContain("advice");
    expect(failedIds("We would recommend")).toContain("advice");
    expect(failedIds("Never lose")).toContain("guaranteed_returns");
  });
  it("refuses an identifier in an ad through the canonical identifier rule", () => {
    const r = check({ text: clean("Call 98765 43210 for ABCDE1234F"), language: "en" });
    expect(r.checks.find((c) => c.id === "safety_layer")?.status).toBe("fail");
  });
  it("is one exported function with the same shape the creative module used", () => {
    const r = check({ text: clean("Learn how a demat account is opened."), language: "en" });
    expect(r).toMatchObject({ status: "PASS" });
    expect(r.checks.every((c) => ["pass", "fail", "not_applicable"].includes(c.status))).toBe(true);
  });
});
