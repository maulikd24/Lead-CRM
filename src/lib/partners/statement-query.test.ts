import { describe, expect, it } from "vitest";

import { pickAssignee, queryTaskTitle, validateQueryMessage } from "./statement-query";

describe("validateQueryMessage", () => {
  it("accepts a plain message and trims it", () => {
    expect(validateQueryMessage("  This amount looks too low  ")).toEqual({ ok: true, message: "This amount looks too low" });
  });
  it("refuses blank, tiny, non-text and over-long messages", () => {
    for (const bad of [undefined, null, 5, "", "   ", "hi"]) expect(validateQueryMessage(bad).ok, String(bad)).toBe(false);
    expect(validateQueryMessage("x".repeat(501)).ok).toBe(false);
    expect(validateQueryMessage("x".repeat(500)).ok).toBe(true);
  });
  it("collapses runs of whitespace and line breaks so a task title stays on one line", () => {
    expect(validateQueryMessage("a\n\n  b\t c  d")).toEqual({ ok: true, message: "a b c d" });
  });
});

describe("queryTaskTitle", () => {
  it("names the partner and the statement and starts the message", () => {
    expect(queryTaskTitle({ partnerCode: "PTR-00001", periodLabel: "Sep 2026", message: "This amount looks too low" })).toBe("Partner query PTR-00001 (Sep 2026): This amount looks too low");
  });
  it("is cut to a sensible length with an ellipsis", () => {
    const t = queryTaskTitle({ partnerCode: "PTR-00001", periodLabel: "Sep 2026", message: "word ".repeat(100) });
    expect(t.length).toBeLessThanOrEqual(200);
    expect(t.endsWith("…")).toBe(true);
  });
});

describe("pickAssignee: who gets the task", () => {
  const fin = [{ id: "f1" }, { id: "f2" }];
  it("the person Finance configured, if they are active and Finance or Admin", () => {
    expect(pickAssignee({ configured: { id: "x", role: "FINANCE", isActive: true }, finance: ["f1"], admins: ["a1"] })).toBe("x");
    expect(pickAssignee({ configured: { id: "x", role: "ADMIN", isActive: true }, finance: ["f1"], admins: ["a1"] })).toBe("x");
  });
  it("ignores a configured person who is inactive or in another role, and falls back to the first active Finance user", () => {
    expect(pickAssignee({ configured: { id: "x", role: "FINANCE", isActive: false }, finance: ["f1", "f2"], admins: ["a1"] })).toBe("f1");
    expect(pickAssignee({ configured: { id: "x", role: "RM", isActive: true }, finance: ["f1"], admins: ["a1"] })).toBe("f1");
  });
  it("then the first active Admin, then nobody", () => {
    expect(pickAssignee({ configured: null, finance: [], admins: ["a1", "a2"] })).toBe("a1");
    expect(pickAssignee({ configured: null, finance: [], admins: [] })).toBeNull();
    void fin;
  });
});
