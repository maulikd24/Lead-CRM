import { describe, expect, it } from "vitest";
import { applyCopilotView, mergeCopilotRows, type CopilotRow } from "./list-view";

const row = (i: number, o: Partial<CopilotRow> = {}): CopilotRow => ({ clientId: `c${String(i).padStart(3, "0")}`, name: `Client ${i}`, code: `C-${i}`, stage: "KYC", rm: null, health: "HEALTHY", score: i % 10, reason: "", priority: "Medium", owner: "RM", when: "Today", action: "Call", why: "Reason", ...o });

describe("applyCopilotView", () => {
  const rows = Array.from({ length: 60 }, (_, i) => row(i));

  it("pages through every customer exactly once, none dropped or repeated", () => {
    const seen: string[] = [];
    const first = applyCopilotView(rows, {});
    for (let p = 1; p <= first.pages; p++) seen.push(...applyCopilotView(rows, { page: String(p) }).rows.map((r) => r.clientId));
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
  });

  it("filters by priority, owner, stage and critical", () => {
    const mixed = [row(1, { priority: "High", health: "CRITICAL" }), row(2, { priority: "Low", owner: "CRM", stage: "Funding" }), row(3, { priority: null })];
    expect(applyCopilotView(mixed, { priority: "High" }).rows.map((r) => r.clientId)).toEqual(["c001"]);
    expect(applyCopilotView(mixed, { owner: "CRM" }).total).toBe(1);
    expect(applyCopilotView(mixed, { stage: "Funding" }).total).toBe(1);
    expect(applyCopilotView(mixed, { critical: "1" }).rows[0].clientId).toBe("c001");
    expect(applyCopilotView(mixed, {}).total).toBe(3); // no priority filter = All
  });

  it("sorts ascending and descending, and clamps a page past the end", () => {
    const r = [row(1, { name: "B" }), row(2, { name: "A" })];
    expect(applyCopilotView(r, { sort: "client", dir: "asc" }).rows.map((x) => x.name)).toEqual(["A", "B"]);
    expect(applyCopilotView(r, { sort: "client", dir: "desc" }).rows.map((x) => x.name)).toEqual(["B", "A"]);
    expect(applyCopilotView(rows, { page: "99" }).page).toBe(3);
  });
});

describe("mergeCopilotRows", () => {
  it("keeps one row per customer and fills priority, owner and timing from intelligence", () => {
    const merged = mergeCopilotRows([row(1, { priority: null, owner: null, when: null, health: "CRITICAL" })], [row(1, { priority: "High", owner: "CRM", when: "This Week", health: null }), row(2)]);
    expect(merged).toHaveLength(2);
    const one = merged.find((m) => m.clientId === "c001")!;
    expect(one).toMatchObject({ health: "CRITICAL", priority: "High", owner: "CRM", when: "This Week" });
  });

  it("keeps the worklist score and reason on one scale: the intelligence score never replaces it", () => {
    const merged = mergeCopilotRows([row(1, { score: 40, reason: "Stage SLA overdue" })], [row(1, { score: null })]);
    expect(merged[0]).toMatchObject({ score: 40, reason: "Stage SLA overdue" });
  });

  it("sorts a customer with no worklist score last", () => {
    const r = [row(1, { score: null }), row(2, { score: 5 })];
    expect(applyCopilotView(r, {}).rows.map((x) => x.clientId)).toEqual(["c002", "c001"]);
  });
});
