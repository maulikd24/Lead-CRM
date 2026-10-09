import { describe, expect, it } from "vitest";
import { buildPanelRows, consentWarning, sourceLabel, STATE_LABEL, type PanelRowInput } from "./view";
import { resolvePolicy } from "./policy";

const NOW = new Date("2026-10-09T10:00:00Z");
const d = (s: string) => new Date(s);
const r = (o: Partial<PanelRowInput> & Pick<PanelRowInput, "purpose" | "status" | "capturedAt">): PanelRowInput => ({ channel: null, source: "RM_RECORDED", noticeVersion: null, expiresAt: null, id: Math.random().toString(36), ...o });
const policy = resolvePolicy({});

describe("buildPanelRows", () => {
  it("shows every purpose, with 'Not recorded' where nothing is on file", () => {
    const rows = buildPanelRows([], null, NOW, policy);
    expect(rows.map((x) => x.purpose)).toEqual(["MARKETING_COMMS", "SERVICE_COMMS", "AI_PROCESSING_OF_CHATS", "CALL_RECORDING", "DATA_SHARING_PARTNERS", "DO_NOT_CONTACT"]);
    expect(rows.every((x) => x.state === "UNKNOWN")).toBe(true);
    expect(STATE_LABEL.UNKNOWN).toBe("Not recorded");
  });
  it("uses the latest row per purpose and channel, with source, date and notice version", () => {
    const rows = buildPanelRows([
      r({ purpose: "MARKETING_COMMS", status: "GRANTED", capturedAt: d("2026-09-01"), source: "LEAD_FORM", noticeVersion: "v1" }),
      r({ purpose: "MARKETING_COMMS", status: "WITHDRAWN", capturedAt: d("2026-09-20"), source: "WHATSAPP_KEYWORD", noticeVersion: null }),
    ], null, NOW, policy);
    const m = rows.filter((x) => x.purpose === "MARKETING_COMMS");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ state: "WITHDRAWN", source: "WHATSAPP_KEYWORD", legacy: false });
    expect(m[0].at).toEqual(d("2026-09-20"));
  });
  it("lists a channel-specific row separately from the all-channel one", () => {
    const rows = buildPanelRows([
      r({ purpose: "MARKETING_COMMS", status: "GRANTED", capturedAt: d("2026-09-01") }),
      r({ purpose: "MARKETING_COMMS", channel: "sms", status: "WITHDRAWN", capturedAt: d("2026-09-02") }),
    ], null, NOW, policy);
    expect(rows.filter((x) => x.purpose === "MARKETING_COMMS").map((x) => `${x.channel ?? "all"}:${x.state}`)).toEqual(["all:GRANTED", "sms:WITHDRAWN"]);
  });
  it("backfills marketing from the lead-form timestamp and marks it legacy", () => {
    const m = buildPanelRows([], d("2026-08-01"), NOW, policy).find((x) => x.purpose === "MARKETING_COMMS")!;
    expect(m).toMatchObject({ state: "GRANTED", legacy: true, source: "LEAD_FORM" });
    expect(m.at).toEqual(d("2026-08-01"));
  });
  it("marks an expired grant as expired", () => {
    const rows = buildPanelRows([r({ purpose: "CALL_RECORDING", status: "GRANTED", capturedAt: d("2025-01-01"), expiresAt: d("2026-01-01") })], null, NOW, policy);
    expect(rows.find((x) => x.purpose === "CALL_RECORDING")!.state).toBe("EXPIRED");
  });
  it("shows do-not-contact as ON when the flag is in force and as off after it is lifted", () => {
    const on = buildPanelRows([r({ purpose: "DO_NOT_CONTACT", status: "GRANTED", capturedAt: d("2026-09-01") })], null, NOW, policy).find((x) => x.purpose === "DO_NOT_CONTACT")!;
    expect(on.state).toBe("DO_NOT_CONTACT");
    const lifted = buildPanelRows([
      r({ purpose: "DO_NOT_CONTACT", status: "GRANTED", capturedAt: d("2026-09-01") }),
      r({ purpose: "DO_NOT_CONTACT", status: "WITHDRAWN", capturedAt: d("2026-09-05") }),
    ], null, NOW, policy).find((x) => x.purpose === "DO_NOT_CONTACT")!;
    expect(lifted.state).toBe("WITHDRAWN");
    expect(lifted.stateLabel).toBe("Lifted");
  });
  it("carries the policy mode for each purpose", () => {
    const rows = buildPanelRows([], null, NOW, resolvePolicy({ CONSENT_RECORD_ONLY_PURPOSES: "MARKETING_COMMS" }));
    expect(rows.find((x) => x.purpose === "MARKETING_COMMS")!.mode).toBe("record_only");
    expect(rows.find((x) => x.purpose === "SERVICE_COMMS")!.mode).toBe("default_allow");
    expect(rows.find((x) => x.purpose === "DO_NOT_CONTACT")!.mode).toBeNull();
  });
});

describe("consentWarning (the inbox banner)", () => {
  it("is null when nothing stands in the way", () => {
    expect(consentWarning([], null, NOW)).toBeNull();
    expect(consentWarning([], d("2026-08-01"), NOW)).toBeNull();
  });
  it("warns about a marketing withdrawal on WhatsApp but says replies are fine", () => {
    const w = consentWarning([r({ purpose: "MARKETING_COMMS", channel: "whatsapp", status: "WITHDRAWN", capturedAt: d("2026-09-20") })], null, NOW)!;
    expect(w.kind).toBe("MARKETING_WITHDRAWN");
    expect(w.text).toMatch(/withdrew/i);
    expect(w.text).toMatch(/reply/i);
  });
  it("a do-not-contact flag takes precedence", () => {
    const w = consentWarning([
      r({ purpose: "MARKETING_COMMS", status: "WITHDRAWN", capturedAt: d("2026-09-01") }),
      r({ purpose: "DO_NOT_CONTACT", status: "GRANTED", capturedAt: d("2026-09-02") }),
    ], null, NOW)!;
    expect(w.kind).toBe("DO_NOT_CONTACT");
  });
  it("does not warn about a withdrawal on another channel", () => {
    expect(consentWarning([r({ purpose: "MARKETING_COMMS", channel: "email", status: "WITHDRAWN", capturedAt: d("2026-09-01") })], null, NOW)).toBeNull();
  });
});

describe("sourceLabel", () => {
  it("humanises known sources, passes unknown ones through and blanks null", () => {
    expect(sourceLabel("WHATSAPP_KEYWORD")).toBe("WhatsApp keyword");
    expect(sourceLabel("RM_RECORDED")).toBe("Recorded by a team member");
    expect(sourceLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(sourceLabel(null)).toBe("");
  });
});
