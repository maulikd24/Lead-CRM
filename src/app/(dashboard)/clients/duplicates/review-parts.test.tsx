import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ComparisonTable, ConfidenceBar, PlanPreview, QueueRow, SurvivorChooser } from "./review-parts";

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
  const item = { id: "s1", score: 0.9, percent: 90, label: "Likely", reasons: ["Same mobile number", "Similar name"], a: sides.a, b: sides.b };
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
      <PlanPreview survivor="Riya" duplicate="R" plan={{ blocked: null, moves: [{ key: "activities", label: "Activities", count: 4 }], stays: [{ key: "kycRecord", label: "KYC record", count: 1 }] }} />,
    );
    expect(html).toContain("Moves to Riya");
    expect(html).toContain("Activities");
    expect(html).toContain("Stays on the archived R");
    expect(html).toContain("KYC record");
    expect(html).toContain("archived, not deleted");
  });
  it("shows a hard block as an alert", () => {
    const html = renderToStaticMarkup(<PlanPreview survivor="Riya" duplicate="R" plan={{ blocked: "These customers have different PAN numbers.", moves: [], stays: [] }} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("This merge is blocked.");
    expect(html).toContain("different PAN numbers");
    expect(html).not.toContain("Moves to");
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
