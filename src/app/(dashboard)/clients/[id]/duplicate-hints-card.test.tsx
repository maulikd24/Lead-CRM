import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../duplicates/actions", () => ({ askManagerToReviewAction: vi.fn() }));

import { DuplicateHintsCard } from "./duplicate-hints-card";

describe("DuplicateHintsCard", () => {
  it("points an RM at the Duplicate customers page for a duplicate that is also theirs", () => {
    const html = renderToStaticMarkup(<DuplicateHintsCard hints={[{ kind: "yours", suggestionId: "s1", partnerId: "c2", name: "Riya", clientCode: "SYN-002" }]} />);
    expect(html).toContain('href="/clients/duplicates"');
    expect(html).toContain("SYN-002");
  });
  it("shows nothing about another owner's customer, only the way to ask a manager", () => {
    const html = renderToStaticMarkup(<DuplicateHintsCard hints={[{ kind: "elsewhere", suggestionId: "s2", requested: false }]} />);
    expect(html).toContain("Ask a manager to review");
    expect(html).not.toContain('href="/clients/');
  });
});
