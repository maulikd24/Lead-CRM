import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, parseSettings, validateSettingsInput } from "./settings";

describe("attribution settings", () => {
  it("defaults to a 15 minute SLA and escalation at breach when nothing is saved", () => {
    expect(parseSettings([])).toEqual({ slaMinutes: 15, graceMinutes: 0 });
    expect(DEFAULT_SETTINGS).toEqual({ slaMinutes: 15, graceMinutes: 0 });
  });
  it("reads saved rows and ignores junk or out-of-range values", () => {
    expect(parseSettings([{ key: "lead_sla_minutes", value: "30" }, { key: "escalation_grace_minutes", value: "10" }])).toEqual({ slaMinutes: 30, graceMinutes: 10 });
    expect(parseSettings([{ key: "lead_sla_minutes", value: "abc" }, { key: "escalation_grace_minutes", value: "-4" }])).toEqual({ slaMinutes: 15, graceMinutes: 0 });
    expect(parseSettings([{ key: "lead_sla_minutes", value: "99999" }])).toEqual({ slaMinutes: 15, graceMinutes: 0 });
  });
  it("validates what an admin types: whole minutes, SLA 5 to 1440, grace 0 to 1440", () => {
    expect(validateSettingsInput({ slaMinutes: 20, graceMinutes: 5 })).toEqual({ ok: true, value: { slaMinutes: 20, graceMinutes: 5 } });
    expect(validateSettingsInput({ slaMinutes: "20", graceMinutes: "5" })).toEqual({ ok: true, value: { slaMinutes: 20, graceMinutes: 5 } });
    for (const bad of [{ slaMinutes: 4, graceMinutes: 0 }, { slaMinutes: 1441, graceMinutes: 0 }, { slaMinutes: 15, graceMinutes: -1 }, { slaMinutes: 15.5, graceMinutes: 0 }, { slaMinutes: "x", graceMinutes: 0 }, null, "nope"]) {
      expect(validateSettingsInput(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});
