import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ALL_ROLES } from "./policy";
import { ASK_TOOL_AREA, askToolAllowed, askToolsFor } from "./tool-scopes";

const names = [...readFileSync(join(process.cwd(), "src/lib/intelligence/ask.ts"), "utf8").matchAll(/^\s*\{?\s*name:\s*"([a-z_]+)"/gm)].map((m) => m[1]);

describe("Ask tool scopes", () => {
  it("finds the tools (sanity)", () => expect(names.length).toBeGreaterThanOrEqual(6));
  it("declares an area for every tool Ask can call, and for no tool that is gone", () => {
    expect(names.filter((n) => !(n in ASK_TOOL_AREA))).toEqual([]);
    expect(Object.keys(ASK_TOOL_AREA).filter((n) => !names.includes(n))).toEqual([]);
  });
  it("gives a role only the tools its area allows: managers and admins all, everyone else none", () => {
    for (const role of ALL_ROLES) expect(askToolsFor(role).length, role).toBe(role === "ADMIN" || role === "MANAGER" ? names.length : 0);
  });
  it("refuses an unknown tool name even to ADMIN", () => expect(askToolAllowed("ADMIN", "drop_table")).toBe(false));
});
