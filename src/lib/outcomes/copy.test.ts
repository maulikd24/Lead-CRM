import { describe, expect, it } from "vitest";

import { checkCopy } from "@/lib/agents/guardrails";

import { computeGoalProgress } from "./progress";
import { DEFAULT_DISCLAIMER, DRAFT_TEMPLATES, STATIC_COPY, assumptionsLine, progressSentence, renderDraft, resolveDisclaimer } from "./copy";

const ok = (text: string) => expect(checkCopy(text, 2000), text).toEqual({ ok: true });

describe("outcomes copy passes the same language guardrails as agent and ad copy", () => {
  it("the default disclaimer and every static label pass", () => {
    ok(DEFAULT_DISCLAIMER);
    for (const text of Object.values(STATIC_COPY)) ok(text);
  });

  it("the disclaimer says illustrative, assumed and not a forecast", () => {
    expect(DEFAULT_DISCLAIMER).toMatch(/illustrative/i);
    expect(DEFAULT_DISCLAIMER).toMatch(/assum/i);
    expect(DEFAULT_DISCLAIMER).toMatch(/not a (forecast|prediction)/i);
    expect(DEFAULT_DISCLAIMER).toMatch(/market risk/i);
  });

  it("every progress sentence, for every status and rate, passes", () => {
    const asOf = new Date("2026-01-01T00:00:00Z");
    for (const currentValue of [0, 200_000, 2_000_000]) {
      for (const plannedMonthly of [null, 5_000, 90_000]) {
        for (const annualRatePct of [null, 0, 8, 12.5]) {
          const p = computeGoalProgress({ targetAmount: 1_000_000, targetDate: new Date("2031-01-01T00:00:00Z"), currentValue, plannedMonthly, annualRatePct, asOf });
          ok(progressSentence(p));
          ok(assumptionsLine(p));
        }
      }
    }
  });

  it("every draft template, rendered with a first name, passes the outbound guardrail", () => {
    for (const key of Object.keys(DRAFT_TEMPLATES) as (keyof typeof DRAFT_TEMPLATES)[]) {
      const text = renderDraft(key, "Asha");
      expect(checkCopy(text, 1000), key).toEqual({ ok: true });
      expect(text).toContain("Asha");
    }
  });

  it("draft templates never mention returns, amounts or a recommendation", () => {
    for (const key of Object.keys(DRAFT_TEMPLATES) as (keyof typeof DRAFT_TEMPLATES)[]) {
      const text = renderDraft(key, "Asha");
      expect(text).not.toMatch(/return|₹|rs\.?\s?\d|\d+\s?%|recommend|invest/i);
    }
  });
});

describe("resolveDisclaimer", () => {
  it("uses a configured text that passes the guardrails", () => {
    const text = "Illustrative only. Figures use assumed rates and are not a forecast. Investments carry market risk.";
    expect(resolveDisclaimer({ OUTCOMES_DISCLAIMER: text })).toBe(text);
  });
  it("falls back to the default when the configured text is empty or blank", () => {
    expect(resolveDisclaimer({ OUTCOMES_DISCLAIMER: "   " })).toBe(DEFAULT_DISCLAIMER);
    expect(resolveDisclaimer({})).toBe(DEFAULT_DISCLAIMER);
  });
  it("falls back when the configured text would fail the guardrails (a promise of returns)", () => {
    expect(resolveDisclaimer({ OUTCOMES_DISCLAIMER: "Guaranteed 12% returns." })).toBe(DEFAULT_DISCLAIMER);
  });
  it("falls back when the configured text drops the illustrative marker", () => {
    expect(resolveDisclaimer({ OUTCOMES_DISCLAIMER: "Numbers shown for your convenience." })).toBe(DEFAULT_DISCLAIMER);
  });
});
