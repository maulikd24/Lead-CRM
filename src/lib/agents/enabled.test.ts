import { describe, expect, it } from "vitest";
import { agentEnabled } from "./enabled";

describe("agentEnabled", () => {
  it("needs BOTH the env flag and an enabled setting row", async () => {
    const on = async () => ({ enabled: true });
    expect(await agentEnabled("wa_nudger", { AGENT_NUDGER_ENABLED: "1" }, on)).toBe(true);
    expect(await agentEnabled("wa_nudger", {}, on)).toBe(false);
    expect(await agentEnabled("wa_nudger", { AGENT_NUDGER_ENABLED: "true" }, on)).toBe(false);
    expect(await agentEnabled("wa_nudger", { AGENT_NUDGER_ENABLED: "1" }, async () => ({ enabled: false }))).toBe(false);
    expect(await agentEnabled("wa_nudger", { AGENT_NUDGER_ENABLED: "1" }, async () => null)).toBe(false);
  });

  it("does not even query the database when the env flag is off", async () => {
    let queried = false;
    await agentEnabled("wa_nudger", {}, async () => { queried = true; return { enabled: true }; });
    expect(queried).toBe(false);
  });

  it("an agent with no env flag mapped is never enabled", async () => {
    expect(await agentEnabled("something_else", { AGENT_NUDGER_ENABLED: "1" }, async () => ({ enabled: true }))).toBe(false);
  });
});
