import { describe, expect, it } from "vitest";

import { aggregateThemes, EXAMPLES_PER_THEME, MAX_EXAMPLE_CHARS, safeExample, type TaggedItem } from "./aggregate";
import type { VocTheme } from "./themes";

const tagged = (id: string, text: string, themes: VocTheme[]): TaggedItem => ({ id, text, kind: "tagged", themes });
const abstain = (id: string, reason: string): TaggedItem => ({ id, text: "", kind: "abstain", reason });

describe("aggregateThemes", () => {
  it("counts each theme once per item and sorts by count, then name", () => {
    const s = aggregateThemes([
      tagged("1", "late statement", ["reports_statements", "delay"]),
      tagged("2", "late again", ["delay"]),
      tagged("3", "fees too high", ["fees", "delay"]),
      tagged("4", "fees", ["fees"]),
    ]);
    expect(s.themes.map((t) => [t.theme, t.count])).toEqual([["delay", 3], ["fees", 2], ["reports_statements", 1]]);
    expect(s.audience).toBe("management");
  });

  it("counts abstains apart and never adds them to a theme", () => {
    const s = aggregateThemes([tagged("1", "x", ["delay"]), abstain("2", "malformed"), abstain("3", "empty")]);
    expect(s).toMatchObject({ totalItems: 3, taggedItems: 1, abstainedItems: 2 });
    expect(s.themes).toEqual([{ theme: "delay", count: 1, share: 1, examples: ["x"] }]);
  });

  it("gives the share of tagged items, rounded to three places, and zero when nothing is tagged", () => {
    const s = aggregateThemes([tagged("1", "a", ["fees"]), tagged("2", "b", ["delay"]), tagged("3", "c", ["delay"])]);
    expect(s.themes.find((t) => t.theme === "delay")?.share).toBe(0.667);
    expect(aggregateThemes([abstain("1", "empty")]).themes).toEqual([]);
  });

  it("keeps at most a few examples per theme, in input order", () => {
    const items = Array.from({ length: 6 }, (_, i) => tagged(String(i), `example ${i}`, ["delay"]));
    const [delay] = aggregateThemes(items).themes;
    expect(delay.examples).toHaveLength(EXAMPLES_PER_THEME);
    expect(delay.examples[0]).toBe("example 0");
  });

  it("re-redacts examples so an identifier never reaches the summary", () => {
    const s = aggregateThemes([tagged("1", "call 9876543210 about a@b.co and ABCDE1234F", ["service_quality"])]);
    const example = s.themes[0].examples[0];
    expect(example).toBe("call [phone] about [email] and [pan]");
  });
});

describe("safeExample", () => {
  it("collapses whitespace and cuts long text with an ellipsis", () => {
    expect(safeExample("  a \n\t b  ")).toBe("a b");
    const long = safeExample("x".repeat(500));
    expect(long).toHaveLength(MAX_EXAMPLE_CHARS);
    expect(long.endsWith("…")).toBe(true);
  });
});
