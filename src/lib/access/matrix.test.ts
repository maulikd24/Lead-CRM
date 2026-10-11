import { describe, expect, it } from "vitest";

import { buildMatrix, previewFor, cellText } from "./matrix";
import { ACTIONS, ALL_ROLES, AREA_KEYS, can } from "./policy";

/** The generated role x area matrix: every cell of the grid must equal what the registry answers, for every role, area and action. */
describe("role x area matrix (generated from the registry)", () => {
  const matrix = buildMatrix();
  it("has one row per area and one column per role", () => {
    expect(matrix.rows.map((r) => r.area)).toEqual(AREA_KEYS);
    expect(matrix.roles).toEqual([...ALL_ROLES]);
  });
  it("agrees with can() in every cell", () => {
    for (const row of matrix.rows) for (const role of ALL_ROLES) for (const action of ACTIONS) {
      expect(row.cells[role].includes(action), `${row.area} ${role} ${action}`).toBe(can(role, row.area, action));
    }
  });
  it("shows ADMIN every action on every area", () => {
    for (const row of matrix.rows) expect(row.cells.ADMIN).toEqual(ACTIONS.filter((a) => a));
  });
  it("renders a cell as short text: none, view, view+manage...", () => {
    expect(cellText([])).toBe("None");
    expect(cellText(["view"])).toBe("View");
    expect(cellText(["view", "manage", "export"])).toBe("View, change, export");
  });
  it("matches the owner's policy on the headline rows", () => {
    const row = (a: string) => matrix.rows.find((r) => r.area === a)!;
    expect(row("marketing").cells.MARKETING).toContain("view");
    expect(row("marketing").cells.RM).toEqual([]);
    expect(row("clients").cells.MARKETING).toEqual([]);
    expect(row("clients").cells.RM).toContain("view");
    expect(row("settings-users").cells.MANAGER).toEqual([]);
  });
});

describe("View as role preview", () => {
  it("shows MARKETING only marketing items and lands on the Marketing workspace", () => {
    const p = previewFor("MARKETING", ["marketing", "referral-program"]);
    expect(p.landing).toBe("/marketing");
    const hrefs = p.sidebar.map((i) => i.href);
    expect(hrefs).toContain("/marketing");
    for (const h of ["/clients", "/inbox", "/calls", "/partners", "/settings/users"]) expect(hrefs).not.toContain(h);
  });
  it("shows an RM their desk and no marketing item", () => {
    const p = previewFor("RM", ["marketing", "referral-program"]);
    expect(p.landing).toBe("/dashboard");
    expect(p.sidebar.map((i) => i.href)).toEqual(expect.arrayContaining(["/clients", "/inbox", "/tasks"]));
    expect(p.sidebar.map((i) => i.href)).not.toContain("/marketing");
  });
  it("shows ADMIN everything the flags allow", () => {
    expect(previewFor("ADMIN", []).sidebar.length).toBeGreaterThan(20);
  });
  it("is read-only data: no functions, nothing to call", () => {
    expect(JSON.parse(JSON.stringify(previewFor("RM", [])))).toEqual(previewFor("RM", []));
  });
});
