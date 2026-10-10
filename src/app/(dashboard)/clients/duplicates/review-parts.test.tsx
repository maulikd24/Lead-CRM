import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ComparisonTable, ConfidenceBar, DecisionBar, PlanPreview, QueueRow, RestrictedPair, SurvivorChooser } from "./review-parts";

const sides = { a: { id: "a", first: "Riya", code: "CL-00001" }, b: { id: "b", first: "R", code: "CL-00002" } };

describe("ConfidenceBar", () => {
  it("is an accessible progressbar that also shows the number", () => {
    const html = renderToStaticMarkup(<ConfidenceBar percent={85} label="Likely the same person: 85 percent" />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="85"');
    expect(html).toContain("85%");
    expect(html).toContain("width:85%");
  });
});

describe("QueueRow", () => {
  const item = { id: "s1", score: 0.9, percent: 90, label: "Likely", reasons: ["Same mobile number", "Similar name"], a: sides.a, b: sides.b, restricted: false };
  it("shows first names, client codes and plain-language reasons only", () => {
    const html = renderToStaticMarkup(<QueueRow item={item} index={0} selected={false} leaving={false} onSelect={() => {}} />);
    expect(html).toContain("Riya");
    expect(html).toContain("CL-00001");
    expect(html).toContain("Same mobile number");
    expect(html).not.toContain("Sharma");
  });
  it("marks the selected row for assistive tech", () => {
    expect(renderToStaticMarkup(<QueueRow item={item} index={0} selected leaving={false} onSelect={() => {}} />)).toContain('aria-current="true"');
  });
});

describe("ComparisonTable", () => {
  const rows = [
    { key: "name", label: "Name", a: "Riya Sharma", b: "R Sharma", match: "different" as const, sensitive: false },
    { key: "mobile", label: "Mobile", a: "••••3210", b: "••••3210", match: "same" as const, sensitive: true },
    { key: "pan", label: "PAN", a: "Not provided", b: "AB••••••4F", match: "missing" as const, sensitive: true },
  ];
  const render = (revealed: Record<string, string | null> = {}) =>
    renderToStaticMarkup(<ComparisonTable rows={rows} sides={sides} revealed={revealed} onReveal={() => {}} onHide={() => {}} />);
  it("marks differences in words, not only colour", () => {
    const html = render();
    expect(html).toContain("Differs");
    expect(html).toContain("Match");
    expect(html).toContain("Missing on one side");
    expect(html).toContain('data-match="different"');
  });
  it("is a real table with headers and a caption", () => {
    const html = render();
    expect(html).toContain("<caption");
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
  });
  it("shows masked values with a labelled Show button, and nothing raw", () => {
    const html = render();
    expect(html).toContain("••••3210");
    expect(html).toContain('aria-label="Show mobile for Riya"');
    expect(html).not.toContain("98765");
  });
  it("shows a revealed value with a Hide button", () => {
    const html = render({ "a:mobile": "9876543210" });
    expect(html).toContain("9876543210");
    expect(html).toContain('aria-label="Hide mobile for Riya"');
  });
  it("offers no reveal for a field that is not provided", () => {
    expect(render()).not.toContain('aria-label="Show pan for Riya"');
  });
});

describe("PlanPreview", () => {
  it("lists what moves and what stays", () => {
    const html = renderToStaticMarkup(
      <PlanPreview survivor="Riya" duplicate="R" plan={{ blocked: null, moves: [{ key: "activities", label: "Activities", count: 4 }], stays: [{ key: "kycRecord", label: "KYC record", count: 1 }], appIds: { state: "none", notice: null } }} />,
    );
    expect(html).toContain("Moves to Riya");
    expect(html).toContain("Activities");
    expect(html).toContain("Stays on the archived R");
    expect(html).toContain("KYC record");
    expect(html).toContain("archived, not deleted");
  });
  it("shows a hard block as an alert", () => {
    const html = renderToStaticMarkup(<PlanPreview survivor="Riya" duplicate="R" plan={{ blocked: "These customers have different PAN numbers.", moves: [], stays: [], appIds: { state: "none", notice: null } }} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("This merge is blocked.");
    expect(html).toContain("different PAN numbers");
    expect(html).not.toContain("Moves to");
  });
});

describe("PlanPreview: app user ids", () => {
  it("shows the two-ids notice as a status, with the no-write rule, and nothing when there is no notice", () => {
    const plan = { blocked: null, moves: [], stays: [], appIds: { state: "conflict" as const, notice: "These customers carry two different app user ids. Nothing is written to CleverTap." } };
    const html = renderToStaticMarkup(<PlanPreview survivor="Riya" duplicate="R" plan={plan} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Two app user ids.");
    expect(html).toContain("Nothing is written to CleverTap.");
    const none = renderToStaticMarkup(<PlanPreview survivor="Riya" duplicate="R" plan={{ ...plan, appIds: { state: "none", notice: null } }} />);
    expect(none).not.toContain("Two app user ids");
  });
});

describe("SurvivorChooser", () => {
  it("is a labelled radio group with the suggestion explained", () => {
    const html = renderToStaticMarkup(<SurvivorChooser sides={sides} value="a" suggestedId="a" why="It has a PAN" onChange={() => {}} />);
    expect(html).toContain("<fieldset");
    expect(html).toContain("Which customer should be kept?");
    expect(html).toContain('type="radio"');
    expect(html).toContain("Suggested. It has a PAN");
  });
});

describe("ComparisonTable: keeping", () => {
  it("says in the column header which customer is being kept", () => {
    const html = renderToStaticMarkup(<ComparisonTable rows={[]} sides={sides} revealed={{}} onReveal={() => {}} onHide={() => {}} keepingId="b" />);
    expect(html.match(/Keeping/g)).toHaveLength(1);
  });
});

describe("DecisionBar", () => {
  const base = { keeping: "Riya (CL-00001)", blocked: null as string | null, pending: false, canAsk: false, asked: false, crossRm: false, canSkip: true, onMerge: () => {}, onDismiss: () => {}, onSkip: () => {}, onAsk: () => {} };
  const render = (over: Partial<typeof base> = {}) => renderToStaticMarkup(<DecisionBar {...base} {...over} />);
  /** The opening tag of the button whose text starts with `label`. */
  const buttonTag = (html: string, label: string) => html.split("<button").slice(1).map((b) => "<button" + b).find((b) => b.slice(b.indexOf(">") + 1).replace(/<[^>]+>/g, "").startsWith(label))?.split(">")[0] ?? "";
  it("offers Merge, Not the same person and Skip with their shortcut keys, and says who is kept", () => {
    const html = render();
    expect(html).toContain('role="group"');
    expect(html).toContain("Merge");
    expect(html).toContain("Not the same person");
    expect(html).toContain("Skip");
    for (const k of ["m", "d", "s"]) expect(html).toContain(`>${k}</kbd>`);
    expect(html).toContain("Keeping Riya (CL-00001).");
    expect(html).not.toContain("Ask a manager");
  });
  it("stays in view at the foot of the section", () => {
    expect(render()).toContain("sticky bottom-0");
  });
  it("disables Merge and explains why when the merge is blocked", () => {
    const html = render({ blocked: "These customers have different PAN numbers." });
    expect(buttonTag(html, "Merge")).toContain(" disabled=\"\"");
    expect(html).toContain("Blocked: These customers have different PAN numbers.");
  });
  it("disables Skip when there is nothing to skip to", () => {
    expect(buttonTag(render({ canSkip: false }), "Skip")).toContain(" disabled=\"\"");
    expect(buttonTag(render(), "Skip")).not.toContain(" disabled=\"\"");
  });
  it("offers Ask a manager to a relationship manager on a cross-owner pair, and Merge is off for them", () => {
    const html = render({ canAsk: true, crossRm: true });
    expect(html).toContain("Ask a manager");
    expect(html).toContain("a manager has to decide it");
    expect(buttonTag(html, "Merge")).toContain(" disabled=\"\"");
  });
  it("does not let a relationship manager dismiss a pair that includes someone else's customer", () => {
    const html = render({ canAsk: true, crossRm: true });
    expect(buttonTag(html, "Not the same person")).toContain(" disabled=\"\"");
    expect(buttonTag(render(), "Not the same person")).not.toContain(" disabled=\"\"");
  });
  it("shows what happened once asked", () => {
    expect(render({ canAsk: true, crossRm: true, asked: true })).toContain("Manager asked");
  });
  it("tells an admin or manager that a cross-owner pair is theirs to decide, without offering to ask", () => {
    const html = render({ crossRm: true });
    expect(html).toContain("different owners");
    expect(html).not.toContain("Ask a manager");
  });
});

describe("restricted pairs (an RM who owns only one of the two customers)", () => {
  const hidden = { id: "", first: "A customer not assigned to you", code: "" };
  const own = { id: "a", first: "Riya", code: "CL-00001" };
  it("QueueRow names only the RM's own customer and flags that a manager has to decide", () => {
    const item = { id: "s2", score: 0.9, percent: 90, label: "Likely", reasons: ["Same mobile number"], a: own, b: hidden, restricted: true };
    const html = renderToStaticMarkup(<QueueRow item={item} index={0} selected={false} leaving={false} onSelect={() => {}} />);
    expect(html).toContain("Riya");
    expect(html).toContain("A customer not assigned to you");
    expect(html).toContain("Needs a manager");
  });
  it("RestrictedPair explains the situation and shows nothing of the other customer", () => {
    const html = renderToStaticMarkup(<RestrictedPair own={own} reasons={["Same mobile number"]} label="Likely" percent={90} />);
    expect(html).toContain("Riya");
    expect(html).toContain("CL-00001");
    expect(html).toContain("not assigned to you");
    expect(html).toContain("Same mobile number");
    expect(html).not.toContain("<table");
  });
});
