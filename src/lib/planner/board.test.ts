import { describe, expect, it } from "vitest";

import { buildBoard, calendarDays, buildMissing } from "./board";
import type { AudienceView, PlanView } from "./types";

const aud = (key: string, name = key): AudienceView => ({ id: `a-${key}`, key, name, archived: false });
const plan = (o: Partial<PlanView> & { id: string }): PlanView => ({
  code: `CP-${o.id}`, title: o.id, audienceId: "a-salaried", audienceKey: "salaried", audienceName: "Salaried", promiseId: "p1", promiseHook: "Hook", channel: "email",
  destinationId: "d1", destinationName: "Planner", destinationStatus: "LIVE", creatorId: null, budgetInr: null, startDate: null, endDate: null, ownerId: "u1", ownerName: "Asha", status: "DRAFT", failing: [], ...o,
});

describe("buildBoard", () => {
  const audiences = [aud("salaried"), aud("nri"), { ...aud("old"), archived: true }];
  const plans = [plan({ id: "1", channel: "email" }), plan({ id: "2", channel: "email" }), plan({ id: "3", channel: "search_ad", audienceId: "a-nri", audienceKey: "nri" })];
  it("has one row per active audience and one column per channel kind, in order", () => {
    const b = buildBoard(audiences, plans);
    expect(b.rows.map((r) => r.audience.key)).toEqual(["salaried", "nri"]);
    expect(b.columns).toHaveLength(7);
    expect(b.rows[0].cells.email.map((p) => p.id)).toEqual(["1", "2"]);
    expect(b.rows[1].cells.search_ad.map((p) => p.id)).toEqual(["3"]);
    expect(b.rows[0].cells.partner).toEqual([]);
  });
  it("counts plans per row and per column", () => {
    const b = buildBoard(audiences, plans);
    expect(b.rows.map((r) => r.total)).toEqual([2, 1]);
    expect(b.columnTotals.email).toBe(2);
    expect(b.columnTotals.search_ad).toBe(1);
  });
  it("keeps plans of an archived audience in an 'Archived audiences' row so none disappears", () => {
    const b = buildBoard(audiences, [...plans, plan({ id: "9", audienceId: "a-old", audienceKey: "old" })]);
    expect(b.rows.at(-1)?.audience.name).toMatch(/archived/i);
    expect(b.rows.at(-1)?.total).toBe(1);
  });
});

describe("calendarDays", () => {
  it("places a plan on every day of its dates inside the month, marking start and end", () => {
    const d = calendarDays([plan({ id: "1", startDate: "2026-10-29", endDate: "2026-11-02" })], "2026-10");
    expect(d.get("2026-10-29")?.[0].position).toBe("start");
    expect(d.get("2026-10-31")?.[0].position).toBe("middle");
    expect(d.has("2026-11-01")).toBe(false);
  });
  it("marks a one-day plan as single and ignores plans without dates", () => {
    const d = calendarDays([plan({ id: "1", startDate: "2026-10-05", endDate: "2026-10-05" }), plan({ id: "2" })], "2026-10");
    expect(d.get("2026-10-05")?.map((x) => x.position)).toEqual(["single"]);
    expect([...d.values()].flat()).toHaveLength(1);
  });
  it("treats a missing end date as the start day", () => {
    const d = calendarDays([plan({ id: "1", startDate: "2026-10-05" })], "2026-10");
    expect(d.get("2026-10-05")?.[0].position).toBe("single");
  });
});

describe("buildMissing", () => {
  const audiences = [aud("salaried", "Salaried"), aud("nri", "NRIs")];
  it("groups failing checklist items across plans, most common first", () => {
    const m = buildMissing({ audiences, plans: [plan({ id: "1", failing: ["copy_approved", "links_tested"] }), plan({ id: "2", failing: ["copy_approved"] }), plan({ id: "3", status: "SCHEDULED", failing: ["copy_approved"] })], routing: { hasFallback: true, audienceKeysWithRule: ["salaried", "nri"] } });
    const copy = m.find((i) => i.id === "copy_approved");
    expect(copy).toMatchObject({ count: 2 });
    expect(copy?.text).toMatch(/2 plans/);
    expect(m.findIndex((i) => i.id === "copy_approved")).toBeLessThan(m.findIndex((i) => i.id === "links_tested"));
  });
  it("flags audiences with no routing and no fallback, and audiences without any plan", () => {
    const m = buildMissing({ audiences, plans: [plan({ id: "1" })], routing: { hasFallback: false, audienceKeysWithRule: ["salaried"] } });
    expect(m.map((i) => i.id)).toEqual(expect.arrayContaining(["no_fallback", "no_routing:nri", "no_plan:nri"]));
    expect(m.find((i) => i.id === "no_routing:salaried")).toBeUndefined();
  });
  it("does not flag routing for an audience when a fallback exists", () => {
    const m = buildMissing({ audiences, plans: [], routing: { hasFallback: true, audienceKeysWithRule: [] } });
    expect(m.some((i) => i.id.startsWith("no_routing"))).toBe(false);
  });
  it("lists plans using a destination that is not live yet and plans without dates", () => {
    const m = buildMissing({ audiences, plans: [plan({ id: "1", destinationStatus: "PLANNED", destinationName: "Goal planner" }), plan({ id: "2", destinationStatus: "PLANNED", destinationName: "Goal planner" })], routing: { hasFallback: true, audienceKeysWithRule: [] } });
    expect(m.find((i) => i.id === "dest_not_live:d1")?.text).toMatch(/Goal planner.*2 plans/);
    expect(m.find((i) => i.id === "no_dates")?.count).toBe(2);
  });
  it("is empty when nothing is missing", () => {
    const m = buildMissing({ audiences: [aud("salaried")], plans: [plan({ id: "1", startDate: "2026-10-05", endDate: "2026-10-09" })], routing: { hasFallback: true, audienceKeysWithRule: ["salaried"] } });
    expect(m).toEqual([]);
  });
});
