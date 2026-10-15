import { describe, expect, it } from "vitest";

import { hasSalesVocabulary, isClassEntry, mentionsBlockedClass, textNamesClass } from "./class-terms";

describe("asset class terms", () => {
  it("catches phrasing variants of a class, not only its name", () => {
    expect(mentionsBlockedClass("Talk through mutual fund options", ["Mutual Funds"])).toBe(true);
    expect(mentionsBlockedClass("Mutual funds for the child", ["Mutual Funds"])).toBe(true);
    expect(mentionsBlockedClass("Bonds for stability", ["Bonds"])).toBe(true);
    expect(mentionsBlockedClass("Tax saving before March", ["Tax Planning"])).toBe(true);
    expect(mentionsBlockedClass("a PMS-linked idea", ["PMS"])).toBe(true);
  });
  it("does not block a text that names no blocked class", () => {
    expect(mentionsBlockedClass("Ask about goals and cash", ["Mutual Funds", "PMS"])).toBe(false);
    expect(textNamesClass("Ask about goals", "Bonds")).toBe(false);
  });
  it("only blocks the classes asked about", () => {
    expect(mentionsBlockedClass("mutual fund options", ["PMS"])).toBe(false);
  });
  it("tells a class do-not-discuss entry from a complaint or a rule", () => {
    expect(isClassEntry("PMS: said not interested on 2026-10-01; do not repeat the pitch")).toBe(true);
    expect(isClassEntry("Open complaint: resolve it before any sales conversation")).toBe(false);
    expect(isClassEntry("Do not pitch now: recent complaint")).toBe(false);
  });
  it("sales vocabulary covers pitch words and product names", () => {
    expect(hasSalesVocabulary("Explore a new offer")).toBe(true);
    expect(hasSalesVocabulary("Talk about the AIF")).toBe(true);
    expect(hasSalesVocabulary("Ask what has changed")).toBe(false);
  });
});
