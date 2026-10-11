import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(path.join(__dirname, f), "utf8");

describe("the Flags tab is gated and read only", () => {
  const page = read("page.tsx");
  it("is built only when the access registry allows the settings-flags area (ADMIN only), after the ADMIN role guard", () => {
    expect(page).toContain('requireRole(["ADMIN"])');
    expect(page).toMatch(/can\(session\.user\.role, "settings-flags"\)/);
    expect(page).toContain("flags ?");
  });
  it("has no server action, no form and no client code that could toggle a flag", () => {
    const view = read("flags-view.tsx");
    expect(view).not.toMatch(/use server|use client|<form|<button|onClick|fetch\(/);
    expect(read("actions.ts")).not.toMatch(/FLAG|flag-registry|flags\//);
  });
});
