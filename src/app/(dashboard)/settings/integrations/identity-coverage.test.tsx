import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { IdentityCoverage } from "./identity-coverage";

describe("IdentityCoverage", () => {
  it("shows the three counts, with 'Skipped: no app id' called out", () => {
    const html = renderToStaticMarkup(<IdentityCoverage coverage={{ eligible: 1200, noAppId: 340, multipleAppIds: 2 }} />);
    expect(html).toContain("Skipped: no app id");
    expect(html).toContain(">340<");
    expect(html).toContain("Ready to sync");
    expect(html).toContain(">1,200<");
    expect(html).toContain("Skipped: more than one app id");
    expect(html).toContain(">2<");
  });
  it("explains why skipped customers are not written to, and is a labelled group", () => {
    const html = renderToStaticMarkup(<IdentityCoverage coverage={{ eligible: 0, noAppId: 0, multipleAppIds: 0 }} />);
    expect(html).toMatch(/aria-label="Customers by app id"/);
    expect(html).toMatch(/never written to CleverTap/i);
  });
});
