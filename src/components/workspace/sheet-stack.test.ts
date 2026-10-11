import { describe, expect, it } from "vitest";

import { isCovered, popSheet, pushSheet } from "./sheet-stack";

describe("sheet stack (layered drawers)", () => {
  it("covers a sheet only while another opened after it is still open", () => {
    let stack: string[] = [];
    stack = pushSheet(stack, "detail");
    expect(isCovered(stack, "detail")).toBe(false);
    stack = pushSheet(stack, "notes");
    expect(isCovered(stack, "detail")).toBe(true);
    expect(isCovered(stack, "notes")).toBe(false);
    stack = popSheet(stack, "notes");
    expect(isCovered(stack, "detail")).toBe(false);
  });
  it("never lists a sheet twice and ignores closing one that is not open", () => {
    expect(pushSheet(["a"], "a")).toEqual(["a"]);
    expect(popSheet(["a"], "zzz")).toEqual(["a"]);
  });
  it("is not covered when it is not in the stack at all", () => {
    expect(isCovered(["a", "b"], "c")).toBe(false);
  });
});
