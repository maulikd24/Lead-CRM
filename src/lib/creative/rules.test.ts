import { describe, expect, it } from "vitest";

import { DEFAULT_RULE_SETTINGS, DEFAULT_DISCLAIMER, DEFAULT_PAST_PERFORMANCE, checkCopyRules, failedChecks, type RuleSettings } from "./rules";

const withDisclaimer = (text: string) => `${text}\n\n${DEFAULT_DISCLAIMER}`;
const find = (r: ReturnType<typeof checkCopyRules>, id: string) => r.checks.find((c) => c.id === id)!;

describe("checkCopyRules: the shared SEBI and AMFI rule block", () => {
  it("passes plain, educational copy that carries the disclaimer", () => {
    const r = checkCopyRules({ text: withDisclaimer("Learn how a demat account is opened, step by step. Book a 15 minute call."), language: "en" });
    expect(r.status).toBe("PASS");
    expect(failedChecks(r)).toEqual([]);
  });

  it("fails guaranteed or assured returns and shows the phrase it matched", () => {
    const r = checkCopyRules({ text: withDisclaimer("Assured returns of a safe plan"), language: "en" });
    expect(r.status).toBe("FAIL");
    const c = find(r, "guaranteed_returns");
    expect(c.status).toBe("fail");
    expect(c.matched?.toLowerCase()).toContain("assured returns");
  });

  it("catches the Hinglish version", () => {
    const r = checkCopyRules({ text: withDisclaimer("Pakka returns, koi risk nahi"), language: "hinglish" });
    expect(find(r, "guaranteed_returns").status).toBe("fail");
  });

  it("fails a performance claim unless the past-performance disclaimer is there", () => {
    const bare = checkCopyRules({ text: withDisclaimer("Our strategy delivered 18% returns last year"), language: "en" });
    expect(find(bare, "performance_claims").status).toBe("fail");
    expect(find(bare, "performance_claims").matched).toMatch(/18%/);
    const covered = checkCopyRules({ text: withDisclaimer(`Our strategy delivered 18% returns last year. Source: audited factsheet. ${DEFAULT_PAST_PERFORMANCE}`), language: "en" });
    expect(find(covered, "performance_claims").status).toBe("pass");
  });

  it("fails when the risk disclosure is missing and passes when it is configured differently", () => {
    expect(find(checkCopyRules({ text: "Open an account today", language: "en" }), "risk_disclosure").status).toBe("fail");
    const custom: RuleSettings = { ...DEFAULT_RULE_SETTINGS, disclaimer: "Custom firm risk text about markets." };
    expect(find(checkCopyRules({ text: "Hello.\nCustom firm risk text about markets.", language: "en", settings: custom }), "risk_disclosure").status).toBe("pass");
    expect(find(checkCopyRules({ text: withDisclaimer("Hello"), language: "en", settings: custom }), "risk_disclosure").status).toBe("fail");
  });

  it("fails testimonials where they are prohibited, and skips the rule where they are not", () => {
    const text = withDisclaimer(`"Best advisor ever" says Rahul, a happy client`);
    expect(find(checkCopyRules({ text, language: "en" }), "testimonials").status).toBe("fail");
    const allowed = checkCopyRules({ text, language: "en", settings: { ...DEFAULT_RULE_SETTINGS, testimonialsProhibited: false } });
    expect(find(allowed, "testimonials").status).toBe("not_applicable");
  });

  it("fails urgency and scarcity for investment products", () => {
    for (const t of ["Last chance to open an account", "Only 10 seats left", "Offer ends tonight", "Jaldi karein, sirf aaj"]) {
      expect(find(checkCopyRules({ text: withDisclaimer(t), language: "hinglish" }), "urgency_scarcity").status, t).toBe("fail");
    }
  });

  it("fails advice, superlatives, hype and gifts for investing", () => {
    const r = checkCopyRules({ text: withDisclaimer("You should buy this fund, the best and number one choice. Get rich quick. Free gift on investing."), language: "en" });
    expect(find(r, "advice").status).toBe("fail");
    expect(find(r, "superlatives").status).toBe("fail");
    expect(find(r, "hype").status).toBe("fail");
    expect(find(r, "inducements").status).toBe("fail");
  });

  it("honesty rule: unverifiable numbers need a named source", () => {
    expect(find(checkCopyRules({ text: withDisclaimer("Trusted by 50,000 clients"), language: "en" }), "honesty").status).toBe("fail");
    expect(find(checkCopyRules({ text: withDisclaimer("Trusted by 50,000 clients. Source: annual report 2026"), language: "en" }), "honesty").status).toBe("pass");
  });

  it("flags unresolved placeholders and configured banned words", () => {
    const s: RuleSettings = { ...DEFAULT_RULE_SETTINGS, bannedWords: ["turbo"] };
    const r = checkCopyRules({ text: withDisclaimer("Turbo growth [INSERT OFFER]"), language: "en", settings: s });
    expect(find(r, "placeholders").status).toBe("fail");
    expect(find(r, "banned_words").matched?.toLowerCase()).toBe("turbo");
  });

  it("a configured regulated claim needs the full disclaimer next to it", () => {
    const s: RuleSettings = { ...DEFAULT_RULE_SETTINGS, regulatedClaims: ["tax saving"] };
    expect(find(checkCopyRules({ text: "Tax saving made simple", language: "en", settings: s }), "regulated_claims").status).toBe("fail");
    expect(find(checkCopyRules({ text: withDisclaimer("Tax saving made simple"), language: "en", settings: s }), "regulated_claims").status).toBe("pass");
  });

  it("empty copy fails", () => {
    expect(checkCopyRules({ text: "  ", language: "en" }).status).toBe("FAIL");
  });

  it("every check carries a label, and a failing one carries a message", () => {
    const r = checkCopyRules({ text: "Guaranteed returns, buy now, last chance", language: "en" });
    for (const c of r.checks) expect(c.label.length).toBeGreaterThan(3);
    for (const c of failedChecks(r)) expect(c.message.length).toBeGreaterThan(10);
  });
});
