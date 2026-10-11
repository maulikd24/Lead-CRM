import { describe, expect, it } from "vitest";

import {
  PILOT_BLOCK_TEXT, describePilotStatus, PILOT_STATEMENT, PILOT_STATEMENT_VERSION, signoffProgress, parseAiKeyInput, parsePilotUserInput, parseSignoffInput, pilotBlock, pilotReadiness,
} from "./pilot";

const ready = { agentOn: true, aiKeySaved: true, signoff: { statementVersion: PILOT_STATEMENT_VERSION }, listed: true };

describe("pilotBlock", () => {
  it("lets a listed user through only when everything else is in place", () => {
    expect(pilotBlock(ready)).toBeNull();
  });
  it("an empty list means nobody: an unlisted user is blocked even with every prerequisite met", () => {
    expect(pilotBlock({ ...ready, listed: false })).toBe("not_in_pilot");
  });
  it("blocks while the agent (flag and kill switch) is off", () => {
    expect(pilotBlock({ ...ready, agentOn: false })).toBe("agent_off");
  });
  it("blocks until an Admin has saved an AI key in Settings", () => {
    expect(pilotBlock({ ...ready, aiKeySaved: false })).toBe("no_ai_key");
  });
  it("blocks until compliance sign-off is recorded", () => {
    expect(pilotBlock({ ...ready, signoff: null })).toBe("no_signoff");
  });
  it("a sign-off recorded against older wording does not count", () => {
    expect(pilotBlock({ ...ready, signoff: { statementVersion: "an-older-version" } })).toBe("no_signoff");
  });
  it("reports the first missing prerequisite, in a fixed order, before it looks at the user", () => {
    expect(pilotBlock({ agentOn: false, aiKeySaved: false, signoff: null, listed: false })).toBe("agent_off");
    expect(pilotBlock({ agentOn: true, aiKeySaved: false, signoff: null, listed: false })).toBe("no_ai_key");
    expect(pilotBlock({ agentOn: true, aiKeySaved: true, signoff: null, listed: false })).toBe("no_signoff");
  });
  it("has plain words for every block", () => {
    for (const k of ["agent_off", "no_ai_key", "no_signoff", "not_in_pilot"] as const) expect(PILOT_BLOCK_TEXT[k].length).toBeGreaterThan(10);
  });
});

describe("pilotReadiness", () => {
  it("lists everything still missing, without looking at who is asking", () => {
    expect(pilotReadiness({ agentOn: false, aiKeySaved: false, signoff: null })).toEqual({ ready: false, missing: ["agent_off", "no_ai_key", "no_signoff"] });
    expect(pilotReadiness({ agentOn: true, aiKeySaved: true, signoff: { statementVersion: PILOT_STATEMENT_VERSION } })).toEqual({ ready: true, missing: [] });
  });
});

describe("the statement an owner signs off", () => {
  it("is versioned and says what the pilot does and does not do", () => {
    expect(PILOT_STATEMENT_VERSION).toMatch(/\S/);
    const text = PILOT_STATEMENT.join(" ").toLowerCase();
    expect(text).toContain("draft");
    expect(text).toContain("nothing is sent");
    expect(text).toContain("consent");
  });
});

describe("input parsing", () => {
  it("accepts a plain user id and rejects everything else", () => {
    expect(parsePilotUserInput("ckabc123")).toEqual({ ok: true, userId: "ckabc123" });
    for (const bad of [undefined, null, 5, "", "   ", "a".repeat(65), {}, ["x"]]) expect(parsePilotUserInput(bad).ok).toBe(false);
  });
  it("a sign-off needs the box ticked and the exact current wording version", () => {
    expect(parseSignoffInput({ confirmed: true, statementVersion: PILOT_STATEMENT_VERSION })).toEqual({ ok: true });
    expect(parseSignoffInput({ confirmed: false, statementVersion: PILOT_STATEMENT_VERSION }).ok).toBe(false);
    expect(parseSignoffInput({ confirmed: true, statementVersion: "x" }).ok).toBe(false);
    expect(parseSignoffInput({ confirmed: "true", statementVersion: PILOT_STATEMENT_VERSION }).ok).toBe(false);
    expect(parseSignoffInput(null).ok).toBe(false);
  });
  it("an AI key is trimmed and must look like one; the error never echoes it", () => {
    const good = "sk-ant-api03-" + "a".repeat(40);
    expect(parseAiKeyInput(`  ${good}\n`)).toEqual({ ok: true, key: good });
    for (const bad of ["", "short", "sk-ant bad key with spaces " + "a".repeat(30), 7, null, "x".repeat(400)]) {
      const r = parseAiKeyInput(bad);
      expect(r.ok).toBe(false);
      if (!r.ok && typeof bad === "string" && bad.length > 5) expect(r.error).not.toContain(bad);
    }
  });
});

describe("describePilotStatus", () => {
  it("tells a listed user they have it, and anyone else why not", () => {
    expect(describePilotStatus(null)).toBe("You are in the reply assistant pilot.");
    expect(describePilotStatus("not_in_pilot")).toBe(`Reply assistant pilot: ${PILOT_BLOCK_TEXT.not_in_pilot}`);
    expect(describePilotStatus("no_signoff")).toContain(PILOT_BLOCK_TEXT.no_signoff);
  });
});

describe("signoffProgress (four-eyes: two different people on the current wording)", () => {
  const at = (n: number) => new Date(Date.UTC(2027, 0, 1, 10, n));
  const row = (by: string, n: number, v = PILOT_STATEMENT_VERSION) => ({ statementVersion: v, acknowledgedById: by, acknowledgedAt: at(n) });
  it("nothing signed: the compliance signature is awaited", () => {
    expect(signoffProgress([])).toMatchObject({ complete: false, compliance: null, countersign: null, awaiting: "compliance" });
  });
  it("one signature: a countersignature is awaited and the signer is the compliance reviewer", () => {
    expect(signoffProgress([row("a", 0)])).toMatchObject({ complete: false, compliance: { acknowledgedById: "a" }, countersign: null, awaiting: "countersign" });
  });
  it("two signatures by the SAME person are still one signature", () => {
    expect(signoffProgress([row("a", 0), row("a", 1)])).toMatchObject({ complete: false, awaiting: "countersign" });
  });
  it("two different people complete it, whatever the order the rows arrive in; the earlier one is the compliance signature", () => {
    const p = signoffProgress([row("b", 5), row("a", 0)]);
    expect(p).toMatchObject({ complete: true, awaiting: null, compliance: { acknowledgedById: "a" }, countersign: { acknowledgedById: "b" } });
  });
  it("signatures on an older wording never count", () => {
    expect(signoffProgress([row("a", 0, "old"), row("b", 1, "old")])).toMatchObject({ complete: false, awaiting: "compliance" });
    expect(signoffProgress([row("a", 0, "old"), row("b", 1)])).toMatchObject({ complete: false, awaiting: "countersign" });
  });
});
