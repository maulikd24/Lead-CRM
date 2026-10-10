import { describe, expect, it } from "vitest";

import { AGENT_CATALOGUE, agentStatus, parseSetEnabledInput, ruleLines } from "./rules";

describe("agentStatus", () => {
  it("runs only when the environment flag is exactly 1 AND the kill-switch row is on", () => {
    expect(agentStatus("wa_nudger", { AGENT_NUDGER_ENABLED: "1" }, { enabled: true })).toEqual({ envOn: true, rowOn: true, running: true });
    expect(agentStatus("wa_nudger", { AGENT_NUDGER_ENABLED: "true" }, { enabled: true }).running).toBe(false);
    expect(agentStatus("wa_nudger", { AGENT_NUDGER_ENABLED: "1" }, { enabled: false }).running).toBe(false);
    expect(agentStatus("wa_nudger", { AGENT_NUDGER_ENABLED: "1" }, null)).toEqual({ envOn: true, rowOn: false, running: false });
  });
  it("uses each agent's own flag", () => {
    expect(agentStatus("wa_reply", { AGENT_NUDGER_ENABLED: "1" }, { enabled: true }).envOn).toBe(false);
    expect(agentStatus("wa_reply", { WA_ASSIST_ENABLED: "1" }, { enabled: true }).running).toBe(true);
  });
});

describe("parseSetEnabledInput", () => {
  it("accepts a known agent and a boolean", () => {
    expect(parseSetEnabledInput("wa_nudger", false)).toEqual({ ok: true, agentKey: "wa_nudger", enabled: false });
  });
  it("rejects unknown agents and non-booleans", () => {
    expect(parseSetEnabledInput("evil", true).ok).toBe(false);
    expect(parseSetEnabledInput("wa_nudger", "yes").ok).toBe(false);
    expect(parseSetEnabledInput(undefined, undefined).ok).toBe(false);
  });
  it("catalogue keys match the kill-switch flag table", () => {
    expect(AGENT_CATALOGUE.map((a) => a.key).sort()).toEqual(["social_drafter", "wa_nudger", "wa_reply"]);
  });
});

describe("ruleLines", () => {
  it("states approval, expiry and cooldowns from the real constants", () => {
    const lines = ruleLines().join("\n");
    expect(lines).toMatch(/approve/i);
    expect(lines).toContain("48 hours");
    expect(lines).toContain("7 days");
    expect(lines).toContain("14 days");
  });
});
