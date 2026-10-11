import { describe, expect, it } from "vitest";

import { pseudonymize } from "./pseudonym";

describe("pseudonymize", () => {
  it("is stable for the same id and secret", () => {
    expect(pseudonymize("client-1", "s1")).toBe(pseudonymize("client-1", "s1"));
  });
  it("differs per id and per secret, so it cannot be joined across systems", () => {
    expect(pseudonymize("client-1", "s1")).not.toBe(pseudonymize("client-2", "s1"));
    expect(pseudonymize("client-1", "s1")).not.toBe(pseudonymize("client-1", "s2"));
  });
  it("does not contain the id and has a fixed readable shape", () => {
    const p = pseudonymize("cm9clientidabc", "s1");
    expect(p).toMatch(/^P-[0-9a-f]{10}$/);
    expect(p).not.toContain("clientid");
  });
  it("refuses an empty secret rather than hashing with nothing", () => {
    expect(() => pseudonymize("x", "")).toThrow();
  });
});

import { isPseudonymousViewer } from "./pseudonym";

describe("isPseudonymousViewer", () => {
  it("is MARKETING only: marketing sees stand-ins, never a real customer", () => {
    expect(isPseudonymousViewer("MARKETING")).toBe(true);
    for (const role of ["ADMIN", "MANAGER", "RM", "FINANCE", "marketing", "", undefined, null]) expect(isPseudonymousViewer(role as string)).toBe(false);
  });
});

import { isPseudonymousViewer, seesExactFigures } from "./pseudonym";

describe("who is shown exact figures", () => {
  it("only a signed-in ADMIN; MARKETING is pseudonymous; an unknown or empty role gets the coarse form", () => {
    expect(seesExactFigures("ADMIN")).toBe(true);
    for (const r of ["MARKETING", "RM", "MANAGER", "FINANCE", "", null, undefined, "admin"]) expect(seesExactFigures(r as never), String(r)).toBe(false);
    expect(isPseudonymousViewer("MARKETING")).toBe(true);
    expect(isPseudonymousViewer("ADMIN")).toBe(false);
  });
});
