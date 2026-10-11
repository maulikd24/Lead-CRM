import { describe, expect, it } from "vitest";

import { AutonomyCeilingError } from "./autonomy";
import { AutonomyForbiddenError, EvalGateError, setAutonomyLevel, type AutonomyDeps } from "./autonomy-service";

function deps(over: Partial<AutonomyDeps> & { current?: number | null; green?: boolean } = {}) {
  const saved: unknown[] = [];
  const audits: Record<string, unknown>[] = [];
  const d: AutonomyDeps = {
    loadLevel: async () => (over.current === undefined ? null : over.current),
    saveLevel: async (...a) => { saved.push(a); },
    evalGate: async () => ({ green: over.green ?? true, detail: over.green === false ? "2 must-block cases passed the safety layers" : "all green" }),
    audit: async (e) => { audits.push(e as unknown as Record<string, unknown>); },
    ...over,
  };
  return { d, saved, audits };
}
const admin = { id: "u-admin", role: "ADMIN" };

describe("setAutonomyLevel", () => {
  it("is an Admin action", async () => {
    const { d, saved } = deps();
    for (const role of ["RM", "MANAGER", "MARKETING", "SUPPORT"]) await expect(setAutonomyLevel(d, { id: "u", role }, { agentKey: "wa_nudger", actionType: "draft_customer_message", level: 4, reason: "r" })).rejects.toBeInstanceOf(AutonomyForbiddenError);
    expect(saved).toHaveLength(0);
  });
  it("refuses a level above the ceiling, throws, and writes nothing", async () => {
    const { d, saved, audits } = deps();
    await expect(setAutonomyLevel(d, admin, { agentKey: "wa_nudger", actionType: "draft_customer_message", level: 5, reason: "go" })).rejects.toBeInstanceOf(AutonomyCeilingError);
    expect(saved).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });
  it("refuses a level above the agent's own registered maximum", async () => {
    const { d, saved } = deps();
    await expect(setAutonomyLevel(d, admin, { agentKey: "ai_summaries", actionType: "summarise_page", level: 3, reason: "x" })).rejects.toBeInstanceOf(AutonomyCeilingError);
    expect(saved).toHaveLength(0);
  });
  it("refuses an action the agent does not have, and an unknown agent", async () => {
    const { d } = deps();
    await expect(setAutonomyLevel(d, admin, { agentKey: "wa_nudger", actionType: "change_ad_spend", level: 1, reason: "x" })).rejects.toThrow(/not an action of/);
    await expect(setAutonomyLevel(d, admin, { agentKey: "nobody", actionType: "draft_customer_message", level: 1, reason: "x" })).rejects.toThrow(/Unknown agent/);
  });
  it("raising needs the agent's eval gate to be green", async () => {
    const red = deps({ current: 3, green: false });
    await expect(setAutonomyLevel(red.d, admin, { agentKey: "wa_nudger", actionType: "draft_customer_message", level: 4, reason: "approved send" })).rejects.toBeInstanceOf(EvalGateError);
    expect(red.saved).toHaveLength(0);
    const green = deps({ current: 3 });
    const r = await setAutonomyLevel(green.d, admin, { agentKey: "wa_nudger", actionType: "draft_customer_message", level: 4, reason: "approved send" });
    expect(r).toEqual({ from: 3, to: 4, changed: true });
    expect(green.saved).toEqual([["wa_nudger", "draft_customer_message", 4, "u-admin", "approved send"]]);
  });
  it("an agent with no eval suite can never be raised", async () => {
    const { d } = deps({ current: 1 });
    await expect(setAutonomyLevel(d, admin, { agentKey: "ai_summaries", actionType: "summarise_page", level: 2, reason: "x" })).rejects.toBeInstanceOf(EvalGateError);
  });
  it("raising needs a written reason", async () => {
    const { d } = deps({ current: 3 });
    await expect(setAutonomyLevel(d, admin, { agentKey: "wa_nudger", actionType: "draft_customer_message", level: 4, reason: "  " })).rejects.toThrow(/reason/i);
  });
  it("lowering needs no gate and is still audited", async () => {
    const { d, saved, audits } = deps({ current: 4, green: false });
    expect(await setAutonomyLevel(d, admin, { agentKey: "wa_nudger", actionType: "draft_customer_message", level: 2, reason: "pause" })).toEqual({ from: 4, to: 2, changed: true });
    expect(saved).toHaveLength(1);
    expect(audits[0]).toMatchObject({ userId: "u-admin", entity: "AgentAutonomy", entityId: "wa_nudger:draft_customer_message", action: "agent.autonomy.lower", oldValue: { level: 4 }, newValue: { level: 2 }, reason: "pause" });
  });
  it("audits a raise with who, what and why", async () => {
    const { d, audits } = deps({ current: 3 });
    await setAutonomyLevel(d, admin, { agentKey: "wa_nudger", actionType: "draft_customer_message", level: 4, reason: "approved send" });
    expect(audits[0]).toMatchObject({ action: "agent.autonomy.raise", oldValue: { level: 3 }, newValue: { level: 4 }, reason: "approved send" });
  });
  it("starts from the registry default when no row is stored, and a same-level request changes nothing", async () => {
    const { d, saved } = deps({ current: null });
    expect(await setAutonomyLevel(d, admin, { agentKey: "wa_nudger", actionType: "draft_customer_message", level: 3, reason: "same" })).toEqual({ from: 3, to: 3, changed: false });
    expect(saved).toHaveLength(0);
  });
  it("a failed audit write fails the change (no unaudited change)", async () => {
    const { d, saved } = deps({ current: 4, audit: async () => { throw new Error("audit down"); } });
    await expect(setAutonomyLevel(d, admin, { agentKey: "wa_nudger", actionType: "draft_customer_message", level: 3, reason: "x" })).rejects.toThrow("audit down");
    expect(saved).toHaveLength(0);
  });
});
