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

  it("outcomes_review has its own flag (OUTCOMES_DRAFTS_ENABLED) plus the kill-switch row, and no other flag turns it on", async () => {
    const on = async () => ({ enabled: true });
    expect(await agentEnabled("outcomes_review", { OUTCOMES_DRAFTS_ENABLED: "1" }, on)).toBe(true);
    expect(await agentEnabled("outcomes_review", { OUTCOMES_DRAFTS_ENABLED: "1" }, async () => null)).toBe(false);
    expect(await agentEnabled("outcomes_review", { AGENT_NUDGER_ENABLED: "1", NEXT_PUBLIC_OUTCOMES: "1" }, on)).toBe(false);
  });

  it("wa_reply has its own flag (WA_ASSIST_ENABLED) and is not switched on by the nudger flag", async () => {
    const on = async () => ({ enabled: true });
    expect(await agentEnabled("wa_reply", { WA_ASSIST_ENABLED: "1" }, on)).toBe(true);
    expect(await agentEnabled("wa_reply", { AGENT_NUDGER_ENABLED: "1" }, on)).toBe(false);
    expect(await agentEnabled("wa_nudger", { WA_ASSIST_ENABLED: "1" }, on)).toBe(false);
    expect(await agentEnabled("wa_reply", { WA_ASSIST_ENABLED: "1" }, async () => ({ enabled: false }))).toBe(false);
  });
});
