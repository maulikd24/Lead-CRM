import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { LiveFunnel } from "./live-funnel";

describe("LiveFunnel markup", () => {
  const html = renderToStaticMarkup(
    createElement(LiveFunnel, { initial: { leads: 100, kyc: 40, funded: 20, activated: 10 }, lifecycle: {}, scopeLabel: "Your team" }),
  );
  it("gives every stage an accessible description with share and conversion", () => {
    expect(html.match(/aria-describedby="/g)?.length).toBe(4);
    expect(html).toContain("40% of all leads");
    expect(html).toContain("50% reached from the previous stage");
  });
  it("uses the reach-next-stage wording and no opacity ramp", () => {
    expect(html).toContain("reach next stage");
    expect(html).not.toContain("continue");
  });
  it("is visible in the server HTML", () => {
    expect(html).not.toMatch(/opacity:\s*0[;"]/);
  });
});
