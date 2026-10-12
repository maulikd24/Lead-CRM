import { describe, expect, it } from "vitest";

import { nextItemId, resolveSelected } from "./master-detail-logic";
import { parseSheetParam, sheetDomId, sheetHref, shouldGoBack, withSheet } from "./sheet-logic";
import { splitShowFirst, viewAllLabel } from "./show-first-logic";

describe("sheet URL contract (?sheet=)", () => {
  it("reads the open sheet, ignoring anything that is not a plain name", () => {
    expect(parseSheetParam("activity")).toBe("activity");
    expect(parseSheetParam(["tasks", "x"])).toBe("tasks");
    expect(parseSheetParam("")).toBeNull();
    expect(parseSheetParam(null)).toBeNull();
    expect(parseSheetParam(undefined)).toBeNull();
    expect(parseSheetParam("<script>")).toBeNull();
    expect(parseSheetParam("a b")).toBeNull();
  });
  it("sets the sheet and keeps every other parameter", () => {
    expect(withSheet("?tab=wealth", "holdings")).toBe("?tab=wealth&sheet=holdings");
    expect(withSheet("", "holdings")).toBe("?sheet=holdings");
    expect(withSheet("?sheet=old&x=1", "new")).toBe("?sheet=new&x=1");
  });
  it("removes the sheet, leaving the rest (or nothing)", () => {
    expect(withSheet("?tab=wealth&sheet=holdings", null)).toBe("?tab=wealth");
    expect(withSheet("?sheet=holdings", null)).toBe("");
  });
  it("builds a full href", () => {
    expect(sheetHref("/clients/1", "?tab=activity", "activity")).toBe("/clients/1?tab=activity&sheet=activity");
    expect(sheetHref("/clients/1", "?tab=activity&sheet=activity", null)).toBe("/clients/1?tab=activity");
  });
  it("gives each sheet a stable DOM id", () => expect(sheetDomId("tasks")).toBe("sheet-tasks"));
  it("Back closes a sheet we opened (we pushed the entry); a deep link is closed by replacing the URL instead", () => {
    expect(shouldGoBack({ wsSheet: "tasks" }, "tasks")).toBe(true);
    expect(shouldGoBack({ wsSheet: "other" }, "tasks")).toBe(false);
    expect(shouldGoBack(null, "tasks")).toBe(false);
    expect(shouldGoBack("x", "tasks")).toBe(false);
  });
});

describe("ShowFirst split", () => {
  it("shows everything when the list fits", () => {
    expect(splitShowFirst(3, 5)).toEqual({ shown: 3, hidden: 0, needsViewAll: false });
    expect(splitShowFirst(5, 5)).toEqual({ shown: 5, hidden: 0, needsViewAll: false });
  });
  it("shows the top N and counts the rest", () => {
    expect(splitShowFirst(12, 5)).toEqual({ shown: 5, hidden: 7, needsViewAll: true });
  });
  it("handles an empty list and a silly limit", () => {
    expect(splitShowFirst(0, 5)).toEqual({ shown: 0, hidden: 0, needsViewAll: false });
    expect(splitShowFirst(4, 0).shown).toBe(1);
  });
  it("labels the button with the TOTAL", () => {
    expect(viewAllLabel(12)).toBe("View all (12)");
    expect(viewAllLabel(12, "tasks")).toBe("View all 12 tasks");
  });
});

describe("MasterDetail keyboard model", () => {
  const ids = ["a", "b", "c"];
  it("Down and Up move one step and stop at the ends", () => {
    expect(nextItemId(ids, "a", "ArrowDown")).toBe("b");
    expect(nextItemId(ids, "c", "ArrowDown")).toBe("c");
    expect(nextItemId(ids, "b", "ArrowUp")).toBe("a");
    expect(nextItemId(ids, "a", "ArrowUp")).toBe("a");
  });
  it("Home and End jump to the ends; other keys do nothing", () => {
    expect(nextItemId(ids, "b", "Home")).toBe("a");
    expect(nextItemId(ids, "b", "End")).toBe("c");
    expect(nextItemId(ids, "b", "x")).toBeNull();
    expect(nextItemId([], "b", "ArrowDown")).toBeNull();
  });
  it("an unknown current counts as before the first item", () => {
    expect(nextItemId(ids, "zzz", "ArrowDown")).toBe("a");
  });
  it("resolves the selection, falling back to the first item", () => {
    expect(resolveSelected(ids, "b")).toBe("b");
    expect(resolveSelected(ids, "nope")).toBe("a");
    expect(resolveSelected(ids, null)).toBe("a");
    expect(resolveSelected([], "a")).toBeNull();
  });
});
