import { describe, expect, it } from "vitest";

import { PURPOSES } from "@/lib/ai/gateway/purposes";

import { ACTION_TYPES, ceilingForAction } from "./autonomy";
import { ENV_FLAG_BY_AGENT } from "./enabled";
import { ALL_CASES } from "./evals/cases";
import { AGENTS, BASE_PROHIBITED, FORBIDDEN_TOOLS, TOOL_REGISTRY, agentForPurpose, getAgent } from "./registry";

describe("the agent registry is linted", () => {
  it("has unique keys and every contract field", () => {
    expect(new Set(AGENTS.map((a) => a.key)).size).toBe(AGENTS.length);
    for (const a of AGENTS) {
      for (const f of ["version", "owner", "purpose", "fallback"] as const) expect(a[f], `${a.key}.${f}`).toBeTruthy();
      expect(a.inputSchema && a.outputSchema, a.key).toBeTruthy();
      expect(a.timeoutMs, a.key).toBeGreaterThan(0);
      expect(a.audit, a.key).toBeDefined();
      expect(a.actions.length, a.key).toBeGreaterThan(0);
    }
  });
  it("every agent prohibits the base six, and any tool it is given is registered and never a forbidden one", () => {
    for (const a of AGENTS) {
      for (const p of BASE_PROHIBITED) expect(a.prohibitedActions, a.key).toContain(p);
      for (const t of a.allowedTools) { expect(TOOL_REGISTRY, `${a.key} ${t}`).toContain(t); expect(FORBIDDEN_TOOLS.test(t), `${a.key} ${t}`).toBe(false); }
    }
    expect(["send_whatsapp", "send_email", "apply_ad_change", "create_payout", "write_consent", "merge_clients", "delete_client"].every((t) => FORBIDDEN_TOOLS.test(t))).toBe(true);
    expect(TOOL_REGISTRY.some((t) => FORBIDDEN_TOOLS.test(t))).toBe(false);
  });
  it("action entries respect the ceilings and never default above their maximum", () => {
    for (const a of AGENTS) for (const e of a.actions) {
      expect(e.actionType in ACTION_TYPES, `${a.key} ${e.actionType}`).toBe(true);
      expect(e.defaultLevel, `${a.key} ${e.actionType}`).toBeLessThanOrEqual(e.maxLevel);
      expect(e.maxLevel, `${a.key} ${e.actionType}`).toBeLessThanOrEqual(ceilingForAction(e.actionType));
    }
  });
  it("no customer-facing or ad-spend action is registered above L4, and L5 appears only on internal reversible actions", () => {
    for (const a of AGENTS) for (const e of a.actions) {
      const cls = ACTION_TYPES[e.actionType].class;
      if (cls === "customer_send" || cls === "ad_spend") expect(e.maxLevel, `${a.key} ${e.actionType}`).toBeLessThanOrEqual(4);
      if (e.maxLevel === 5) expect(cls, `${a.key} ${e.actionType}`).toBe("internal_reversible");
    }
  });
  it("kill switches match the existing env flags and AgentSetting keys", () => {
    for (const a of AGENTS) {
      if (a.killSwitch.kind === "flag_and_setting") { expect(a.killSwitch.envFlag, a.key).toBe(ENV_FLAG_BY_AGENT[a.key]); expect(a.killSwitch.settingKey, a.key).toBe(a.key); expect(a.flags, a.key).toContain(a.killSwitch.envFlag); }
    }
    for (const key of Object.keys(ENV_FLAG_BY_AGENT)) expect(getAgent(key), key).toBeDefined();
  });
  it("purposes and agents agree: every purpose with an agent is listed by it, every listed purpose exists", () => {
    const ids = new Set(PURPOSES.map((p) => p.id));
    for (const p of PURPOSES) if (p.agentKey) expect(getAgent(p.agentKey)?.purposes, p.id).toContain(p.id);
    for (const a of AGENTS) for (const pid of a.purposes) expect(ids.has(pid), `${a.key} ${pid}`).toBe(true);
    for (const p of PURPOSES) expect(p.agentKey !== null || AGENTS.some((a) => a.purposes.includes(p.id)), p.id).toBe(true);
    expect(agentForPurpose("nudger.draft")?.key).toBe("wa_nudger");
  });
  it("a purpose's data class never exceeds its agent's data-permission ceiling", () => {
    const rank = (c: string) => ["none", "aggregate", "customer_facts", "customer_identifiers", "customer_text"].indexOf(c);
    for (const p of PURPOSES) { const a = p.agentKey ? getAgent(p.agentKey) : undefined; if (a) expect(rank(p.dataClass), `${a.key} ${p.id}`).toBeLessThanOrEqual(rank(a.dataPermissions.dataClassCeiling)); }
  });
  it("eval suites name categories that exist in the harness", () => {
    const cats = new Set(ALL_CASES.map((c) => c.category));
    for (const a of AGENTS) for (const c of a.evalSuite?.categories ?? []) expect(cats.has(c), `${a.key} ${c}`).toBe(true);
  });
  it("an agent whose purposes send customer data needs an approval requirement", () => {
    for (const a of AGENTS) if (a.actions.some((e) => ACTION_TYPES[e.actionType].class === "customer_send")) expect(a.approval.required, a.key).toBe("always");
  });
  it("owners are roles, not people", () => { for (const a of AGENTS) expect(a.owner, a.key).toMatch(/^[a-z-]+$/); });
});
