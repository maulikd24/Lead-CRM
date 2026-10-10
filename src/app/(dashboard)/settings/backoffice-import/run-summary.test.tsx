import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { RunSummary, type SummaryData } from "./run-summary";

const base: SummaryData = {
  kind: "HOLDINGS",
  status: "PARTIAL",
  dryRun: true,
  fileName: "holdings_1.csv",
  counts: { rows: { received: 4, skipped: 1 }, customers: { received: 2, matched: 1, unmatched: 1, ambiguous: 0, invalid: 0 }, holdings: { created: 1, updated: 0, unchanged: 0, stale: 0, failed: 0 } },
  errors: [
    { line: 3, code: "CUSTOMER_UNMATCHED", fields: [] },
    { line: 4, code: "INVALID_ROW", fields: ["quantity"] },
  ],
};
const html = (over: Partial<SummaryData> = {}) => renderToStaticMarkup(<RunSummary data={{ ...base, ...over }} />);

describe("RunSummary", () => {
  it("says a dry run changed nothing and shows would-create wording", () => {
    const h = html();
    expect(h).toContain("Dry run: nothing was changed");
    expect(h).toContain("would create");
  });
  it("lists per-row problems by line with plain-English reasons and field names", () => {
    const h = html();
    expect(h).toContain("No client with that client code or PAN");
    expect(h).toContain("quantity");
    expect(h).toContain(">3<");
  });
  it("a real run uses plain verbs and no dry-run notice", () => {
    const h = html({ dryRun: false });
    expect(h).not.toContain("Dry run");
    expect(h).toContain("created");
  });
  it("explains a failed file and a skipped duplicate", () => {
    expect(html({ status: "FAILED", errors: [], counts: {}, failureCode: "MISSING_COLUMN", missingFields: ["quantity"] })).toContain("Missing for: quantity");
    expect(html({ status: "SKIPPED_DUPLICATE", errors: [], counts: {}, reason: "already_imported" })).toContain("already been imported");
  });
  it("renders client-master counts", () => {
    const h = html({ kind: "CLIENTS", counts: { clients: { received: 3, matched: 2, updated: 1, unchanged: 1, unmatched: 1, ambiguous: 0, invalid: 0, fieldsChanged: { city: 1 } } }, errors: [] });
    expect(h).toContain("Client master");
    expect(h).toContain("city (1)");
  });
});
