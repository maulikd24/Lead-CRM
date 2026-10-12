import { describe, expect, it } from "vitest";

import { outcomeListItems } from "./master-items";
import type { OutcomesViewModel } from "./view-model";

const vm = (over: Partial<OutcomesViewModel> = {}): OutcomesViewModel => ({
  clientId: "c1",
  canEdit: true,
  disclaimer: "x",
  score: { value: 72, band: "high", bandLabel: "High attention", topReasons: [], factors: [] },
  review: { summary: "", overdue: true, tierLabel: "A", hasCadence: true },
  goals: [
    { id: "g1", name: "Education", progressStatus: "behind", statusLabel: "Behind", progressPct: 42 },
    { id: "g2", name: "Home", progressStatus: "ahead", statusLabel: "Ahead", progressPct: 120 },
  ] as unknown as OutcomesViewModel["goals"],
  suggestions: [{ severity: "high" }, { severity: "low" }] as unknown as OutcomesViewModel["suggestions"],
  holdingOptions: [],
  accountOptions: [],
  ...over,
});

describe("outcomeListItems", () => {
  it("lists the overview first, then every goal, then the suggestions", () => {
    expect(outcomeListItems(vm()).map((i) => i.id)).toEqual(["overview", "goal:g1", "goal:g2", "suggestions"]);
  });
  it("summarises each item in one line from the data it already has", () => {
    const items = outcomeListItems(vm());
    expect(items[0].meta).toBe("Attention 72 · review overdue");
    expect(items[1]).toMatchObject({ title: "Education", meta: "42% of target held", status: "Behind", tone: "warning" });
    expect(items[2]).toMatchObject({ status: "Ahead", tone: "success" });
    expect(items[3].meta).toBe("2 to look at");
  });
  it("says so when there is nothing to do or no cadence", () => {
    const items = outcomeListItems(vm({ suggestions: [], review: { summary: "", overdue: false, tierLabel: null, hasCadence: false } }));
    expect(items[0].meta).toBe("Attention 72");
    expect(items[items.length - 1].meta).toBe("Nothing to do");
  });
  it("still lists the overview and suggestions when there are no goals", () => {
    expect(outcomeListItems(vm({ goals: [] })).map((i) => i.id)).toEqual(["overview", "suggestions"]);
  });
});
