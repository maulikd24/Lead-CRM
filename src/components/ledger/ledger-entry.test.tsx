import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { assembleLedger } from "@/lib/ledger/assemble";
import { DAY, aiDraftApprovedThenSent, at, complaintThenReview, decisionSuppressed } from "@/lib/ledger/fixtures.testkit";

import { LedgerEntryCard } from "./ledger-entry";

const ctx = { now: at(10 * DAY), canSeeDecisions: true, approvalVisible: () => true };
const render = (entry: Parameters<typeof LedgerEntryCard>[0]["entry"], open = true) => renderToStaticMarkup(<LedgerEntryCard entry={entry} idPrefix="t" defaultOpen={open} />);

describe("LedgerEntryCard", () => {
  it("answers every ledger question for an AI draft approved then sent, and says which part is inferred", () => {
    const entry = assembleLedger(aiDraftApprovedThenSent(), ctx).find((e) => e.kind === "message");
    if (!entry) throw new Error("no entry");
    const html = render(entry);
    for (const label of ["Action", "Trigger", "Decision", "Evidence", "Initiated by", "Executed by", "AI involvement", "Approved by", "Result", "Follow-on", "Chain: trigger to follow-on", "Source records"]) expect(html).toContain(label);
    expect(html).toContain("v2.0.0-shadow");
    expect(html).toContain("wa_nudger");
    expect(html).toContain("L3");
    expect(html).toContain("Riya Menon");
    expect(html).toContain("Matched by customer and time, not by an id: inferred");
    expect(html).toContain("Certain");
  });

  it("marks an inferred entry as inferred, with the reason in words and the score as a rank", () => {
    const entry = assembleLedger(complaintThenReview(), ctx).find((e) => e.kind === "task");
    if (!entry) throw new Error("no entry");
    const html = render(entry);
    expect(html).toContain("Inferred link.");
    expect(html).toMatch(/not a probability/);
    expect(html).toMatch(/Same customer/);
    expect(html).toContain('data-confidence="inferred"');
  });

  it("says nothing was sent for a suppressed decision, and that no AI message went out", () => {
    const entry = assembleLedger(decisionSuppressed(), ctx).find((e) => e.kind === "decision");
    if (!entry) throw new Error("no entry");
    const html = render(entry);
    expect(html).toContain("Held back by open complaint");
    expect(html).toContain("nothing was sent");
    expect(html).toContain("No approval needed");
  });

  it("is a native disclosure: a summary with the title as a heading, closed by default", () => {
    const entry = assembleLedger(decisionSuppressed(), ctx)[0];
    const html = render(entry, false);
    expect(html).toMatch(/<details[^>]*class="group"/);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toMatch(/<summary[^>]*>[\s\S]*<h3 id="t-t"/);
    expect(html).toContain('aria-labelledby="t-t"');
  });

  it("never animates for longer than the motion budget (no custom animation, no spinner)", () => {
    const entry = assembleLedger(decisionSuppressed(), ctx)[0];
    expect(render(entry)).not.toMatch(/animate-|duration-[4-9]\d\d/);
  });
});
