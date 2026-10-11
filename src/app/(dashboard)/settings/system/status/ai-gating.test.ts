import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { can } from "@/lib/access/policy";

const read = (f: string) => readFileSync(path.join(__dirname, f), "utf8");

describe("the AI tab is Admin only, behind its own flag, and read only apart from the existing kill switches", () => {
  const page = read("page.tsx");
  it("exists only when the flag is on AND the access registry allows settings-ai, after the ADMIN guard", () => {
    expect(page).toContain('requireRole(["ADMIN"])');
    expect(page).toMatch(/process\.env\.AI_ADMIN_TAB === "1" && can\(session\.user\.role, "settings-ai"\)/);
    expect(page).toContain("aiOn ?");
  });
  it("only Admin can see or manage the area", () => {
    for (const role of ["RM", "MANAGER", "MARKETING", "SUPPORT", "PARTNER", undefined]) for (const action of ["view", "manage", "export"] as const) expect(can(role, "settings-ai", action), `${role} ${action}`).toBe(false);
    expect(can("ADMIN", "settings-ai", "view")).toBe(true);
  });
  it("the view's only write is the EXISTING agent kill-switch action; it adds no server action of its own", () => {
    const view = read("ai-view.tsx");
    expect([...view.matchAll(/(\w+Action)\b/g)].map((m) => m[1]).filter((n, i, a) => a.indexOf(n) === i)).toEqual(["setAgentEnabledAction"]);
    expect(view).not.toMatch(/use server|fetch\(|setAutonomy/);
    expect(read("actions.ts")).not.toMatch(/autonomy|AgentRun/i);
  });
  it("never selects or shows a prompt, an answer or customer text", () => {
    const loader = readFileSync(path.join(process.cwd(), "src/lib/ai/gateway/panel-wiring.ts"), "utf8");
    expect(loader).not.toMatch(/subjectId|redactionSummary|promptHash|\.text\b/);
  });
});
