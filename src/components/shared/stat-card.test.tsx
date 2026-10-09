import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { StatCard } from "./stat-card";

describe("StatCard", () => {
  it("flag-off markup keeps the original structure (no extra wrapper)", () => {
    const html = renderToStaticMarkup(createElement(StatCard, { label: "Overdue", value: 3 }));
    expect(html).not.toContain("items-end");
    expect(html).toMatch(/<p class="font-heading[^"]*">3<\/p>/);
  });
  it("adds the wrapper only for accessory/animated", () => {
    const html = renderToStaticMarkup(createElement(StatCard, { label: "x", value: 3, accessory: "x" }));
    expect(html).toContain("items-end");
  });
});
