import { describe, expect, it } from "vitest";
import { consentDecision, currentStates, type ConsentRow } from "./decision";
import { CONSENT_POLICY, resolvePolicy } from "./policy";

const NOW = new Date("2026-10-09T10:00:00Z");
const d = (s: string) => new Date(s);
const row = (over: Partial<ConsentRow> & Pick<ConsentRow, "purpose" | "status" | "capturedAt">): ConsentRow => ({ channel: null, expiresAt: null, ...over });

describe("consentDecision: required purposes (marketing)", () => {
  it("denies with NO_RECORD when there is nothing on file", () => {
    expect(consentDecision([], "MARKETING_COMMS", "whatsapp", NOW)).toMatchObject({ allowed: false, reason: "NO_RECORD", state: "UNKNOWN" });
  });
  it("allows a granted record", () => {
    const r = [row({ purpose: "MARKETING_COMMS", status: "GRANTED", capturedAt: d("2026-09-01") })];
    expect(consentDecision(r, "MARKETING_COMMS", "whatsapp", NOW)).toMatchObject({ allowed: true, reason: "GRANTED", state: "GRANTED" });
  });
  it("a later withdrawal beats an earlier grant", () => {
    const r = [
      row({ purpose: "MARKETING_COMMS", status: "GRANTED", capturedAt: d("2026-09-01") }),
      row({ purpose: "MARKETING_COMMS", status: "WITHDRAWN", capturedAt: d("2026-09-20") }),
    ];
    expect(consentDecision(r, "MARKETING_COMMS", "whatsapp", NOW)).toMatchObject({ allowed: false, reason: "WITHDRAWN" });
  });
  it("order in the input array does not matter, only capturedAt", () => {
    const r = [
      row({ purpose: "MARKETING_COMMS", status: "WITHDRAWN", capturedAt: d("2026-09-20") }),
      row({ purpose: "MARKETING_COMMS", status: "GRANTED", capturedAt: d("2026-09-01") }),
    ];
    expect(consentDecision(r, "MARKETING_COMMS", "whatsapp", NOW).allowed).toBe(false);
  });
  it("a re-grant after a withdrawal allows again", () => {
    const r = [
      row({ purpose: "MARKETING_COMMS", status: "GRANTED", capturedAt: d("2026-08-01") }),
      row({ purpose: "MARKETING_COMMS", status: "WITHDRAWN", capturedAt: d("2026-09-01") }),
      row({ purpose: "MARKETING_COMMS", status: "GRANTED", capturedAt: d("2026-10-01") }),
    ];
    expect(consentDecision(r, "MARKETING_COMMS", "whatsapp", NOW).allowed).toBe(true);
  });
  it("on an identical timestamp the withdrawal wins", () => {
    const t = d("2026-09-01T00:00:00Z");
    const r = [row({ purpose: "MARKETING_COMMS", status: "GRANTED", capturedAt: t }), row({ purpose: "MARKETING_COMMS", status: "WITHDRAWN", capturedAt: t })];
    expect(consentDecision(r, "MARKETING_COMMS", "whatsapp", NOW).allowed).toBe(false);
  });
  it("an expired grant is denied as EXPIRED", () => {
    const r = [row({ purpose: "MARKETING_COMMS", status: "GRANTED", capturedAt: d("2025-01-01"), expiresAt: d("2026-01-01") })];
    expect(consentDecision(r, "MARKETING_COMMS", "whatsapp", NOW)).toMatchObject({ allowed: false, reason: "EXPIRED", state: "EXPIRED" });
  });
  it("a grant expiring in the future still allows", () => {
    const r = [row({ purpose: "MARKETING_COMMS", status: "GRANTED", capturedAt: d("2026-01-01"), expiresAt: d("2027-01-01") })];
    expect(consentDecision(r, "MARKETING_COMMS", "whatsapp", NOW).allowed).toBe(true);
  });
  it("a withdrawal never expires", () => {
    const r = [row({ purpose: "MARKETING_COMMS", status: "WITHDRAWN", capturedAt: d("2025-01-01"), expiresAt: d("2025-06-01") })];
    expect(consentDecision(r, "MARKETING_COMMS", "whatsapp", NOW)).toMatchObject({ allowed: false, reason: "WITHDRAWN" });
  });
  it("ignores records dated in the future", () => {
    const r = [row({ purpose: "MARKETING_COMMS", status: "GRANTED", capturedAt: d("2026-12-01") })];
    expect(consentDecision(r, "MARKETING_COMMS", "whatsapp", NOW).reason).toBe("NO_RECORD");
  });
  it("ignores records for other purposes", () => {
    const r = [row({ purpose: "CALL_RECORDING", status: "GRANTED", capturedAt: d("2026-01-01") })];
    expect(consentDecision(r, "MARKETING_COMMS", "whatsapp", NOW).reason).toBe("NO_RECORD");
  });
});

describe("channels", () => {
  const g = row({ purpose: "MARKETING_COMMS", status: "GRANTED", capturedAt: d("2026-01-01") });
  it("a null-channel grant covers every channel", () => {
    expect(consentDecision([g], "MARKETING_COMMS", "sms", NOW).allowed).toBe(true);
    expect(consentDecision([g], "MARKETING_COMMS", null, NOW).allowed).toBe(true);
  });
  it("a channel-specific grant does not cover another channel", () => {
    const r = [row({ purpose: "MARKETING_COMMS", channel: "whatsapp", status: "GRANTED", capturedAt: d("2026-01-01") })];
    expect(consentDecision(r, "MARKETING_COMMS", "whatsapp", NOW).allowed).toBe(true);
    expect(consentDecision(r, "MARKETING_COMMS", "email", NOW).allowed).toBe(false);
  });
  it("a later channel-specific withdrawal blocks only that channel", () => {
    const r = [g, row({ purpose: "MARKETING_COMMS", channel: "whatsapp", status: "WITHDRAWN", capturedAt: d("2026-02-01") })];
    expect(consentDecision(r, "MARKETING_COMMS", "whatsapp", NOW).allowed).toBe(false);
    expect(consentDecision(r, "MARKETING_COMMS", "email", NOW).allowed).toBe(true);
  });
  it("a later all-channel withdrawal blocks every channel, even if WhatsApp was granted earlier", () => {
    const r = [row({ purpose: "MARKETING_COMMS", channel: "whatsapp", status: "GRANTED", capturedAt: d("2026-01-01") }), row({ purpose: "MARKETING_COMMS", status: "WITHDRAWN", capturedAt: d("2026-03-01") })];
    expect(consentDecision(r, "MARKETING_COMMS", "whatsapp", NOW).allowed).toBe(false);
  });
  it("a later WhatsApp grant re-opens WhatsApp after an all-channel withdrawal", () => {
    const r = [row({ purpose: "MARKETING_COMMS", status: "WITHDRAWN", capturedAt: d("2026-03-01") }), row({ purpose: "MARKETING_COMMS", channel: "whatsapp", status: "GRANTED", capturedAt: d("2026-04-01") })];
    expect(consentDecision(r, "MARKETING_COMMS", "whatsapp", NOW).allowed).toBe(true);
    expect(consentDecision(r, "MARKETING_COMMS", "sms", NOW).allowed).toBe(false);
  });
});

describe("do-not-contact always wins", () => {
  const grant = row({ purpose: "MARKETING_COMMS", status: "GRANTED", capturedAt: d("2026-01-01") });
  const dnd = row({ purpose: "DO_NOT_CONTACT", status: "GRANTED", capturedAt: d("2026-02-01") });
  it("beats a marketing grant, whether the grant is older or newer", () => {
    expect(consentDecision([grant, dnd], "MARKETING_COMMS", "whatsapp", NOW)).toMatchObject({ allowed: false, reason: "DO_NOT_CONTACT", state: "DO_NOT_CONTACT" });
    const newer = row({ purpose: "MARKETING_COMMS", status: "GRANTED", capturedAt: d("2026-05-01") });
    expect(consentDecision([dnd, newer], "MARKETING_COMMS", "whatsapp", NOW).reason).toBe("DO_NOT_CONTACT");
  });
  it("beats default-allow service messages", () => {
    expect(consentDecision([dnd], "SERVICE_COMMS", "whatsapp", NOW).reason).toBe("DO_NOT_CONTACT");
  });
  it("beats a purpose switched to record only", () => {
    const policy = resolvePolicy({ CONSENT_RECORD_ONLY_PURPOSES: "MARKETING_COMMS" });
    expect(consentDecision([grant, dnd], "MARKETING_COMMS", "whatsapp", NOW, { policy }).allowed).toBe(false);
  });
  it("does not apply to purposes that are not about contact", () => {
    const ai = row({ purpose: "AI_PROCESSING_OF_CHATS", status: "GRANTED", capturedAt: d("2026-01-01") });
    expect(consentDecision([ai, dnd], "AI_PROCESSING_OF_CHATS", "whatsapp", NOW).allowed).toBe(true);
  });
  it("can be lifted by a later withdrawal of the do-not-contact flag", () => {
    const lifted = row({ purpose: "DO_NOT_CONTACT", status: "WITHDRAWN", capturedAt: d("2026-03-01") });
    expect(consentDecision([grant, dnd, lifted], "MARKETING_COMMS", "whatsapp", NOW).allowed).toBe(true);
  });
  it("a channel-scoped flag only blocks that channel", () => {
    const sms = row({ purpose: "DO_NOT_CONTACT", channel: "sms", status: "GRANTED", capturedAt: d("2026-02-01") });
    expect(consentDecision([grant, sms], "MARKETING_COMMS", "sms", NOW).reason).toBe("DO_NOT_CONTACT");
    expect(consentDecision([grant, sms], "MARKETING_COMMS", "whatsapp", NOW).allowed).toBe(true);
  });
  it("an expired flag no longer blocks", () => {
    const old = row({ purpose: "DO_NOT_CONTACT", status: "GRANTED", capturedAt: d("2026-01-01"), expiresAt: d("2026-02-01") });
    expect(consentDecision([grant, old], "MARKETING_COMMS", "whatsapp", NOW).allowed).toBe(true);
  });
  it("applies when asking about no particular channel", () => {
    expect(consentDecision([grant, dnd], "MARKETING_COMMS", null, NOW).reason).toBe("DO_NOT_CONTACT");
  });
});

describe("policy modes", () => {
  it("service messages are allowed by default with no record", () => {
    expect(consentDecision([], "SERVICE_COMMS", "whatsapp", NOW)).toMatchObject({ allowed: true, reason: "DEFAULT_ALLOWED" });
  });
  it("service messages are still blocked by an explicit withdrawal", () => {
    const r = [row({ purpose: "SERVICE_COMMS", status: "WITHDRAWN", capturedAt: d("2026-09-01") })];
    expect(consentDecision(r, "SERVICE_COMMS", "whatsapp", NOW)).toMatchObject({ allowed: false, reason: "WITHDRAWN" });
  });
  it("chat AI processing requires a grant by default", () => {
    expect(consentDecision([], "AI_PROCESSING_OF_CHATS", "whatsapp", NOW).allowed).toBe(false);
    const r = [row({ purpose: "AI_PROCESSING_OF_CHATS", status: "GRANTED", capturedAt: d("2026-09-01") })];
    expect(consentDecision(r, "AI_PROCESSING_OF_CHATS", "whatsapp", NOW).allowed).toBe(true);
  });
  it("every purpose in the default policy has a mode, label and summary", () => {
    for (const [purpose, p] of Object.entries(CONSENT_POLICY)) {
      expect(["required", "default_allow", "record_only"], purpose).toContain(p.mode);
      expect(p.label.length).toBeGreaterThan(2);
      expect(p.summary.length).toBeGreaterThan(10);
    }
  });
  it("record only allows but reports what would have blocked", () => {
    const policy = resolvePolicy({ CONSENT_RECORD_ONLY_PURPOSES: "MARKETING_COMMS, ai_processing_of_chats" });
    expect(policy.MARKETING_COMMS.mode).toBe("record_only");
    expect(policy.AI_PROCESSING_OF_CHATS.mode).toBe("record_only");
    expect(policy.SERVICE_COMMS.mode).toBe("default_allow");
    expect(consentDecision([], "MARKETING_COMMS", "whatsapp", NOW, { policy })).toMatchObject({ allowed: true, reason: "RECORD_ONLY", wouldBlock: "NO_RECORD" });
    const w = [row({ purpose: "MARKETING_COMMS", status: "WITHDRAWN", capturedAt: d("2026-09-01") })];
    expect(consentDecision(w, "MARKETING_COMMS", "whatsapp", NOW, { policy })).toMatchObject({ allowed: true, wouldBlock: "WITHDRAWN" });
  });
  it("resolvePolicy ignores unknown names and never mutates the base", () => {
    const p = resolvePolicy({ CONSENT_RECORD_ONLY_PURPOSES: "NOPE,MARKETING_COMMS" });
    expect(Object.keys(p)).toEqual(Object.keys(CONSENT_POLICY));
    expect(CONSENT_POLICY.MARKETING_COMMS.mode).toBe("required");
    expect(resolvePolicy({}).MARKETING_COMMS.mode).toBe("required");
  });
});

describe("backfill-on-read from the lead form timestamp", () => {
  const legacy = { legacyMarketingConsentAt: d("2026-08-01") };
  it("treats marketingConsentAt as a marketing grant with no data migration", () => {
    expect(consentDecision([], "MARKETING_COMMS", "whatsapp", NOW, legacy)).toMatchObject({ allowed: true, reason: "GRANTED_LEGACY", state: "GRANTED" });
  });
  it("does not stretch to other purposes", () => {
    expect(consentDecision([], "AI_PROCESSING_OF_CHATS", "whatsapp", NOW, legacy).allowed).toBe(false);
  });
  it("is overridden by a later withdrawal", () => {
    const r = [row({ purpose: "MARKETING_COMMS", status: "WITHDRAWN", capturedAt: d("2026-09-01") })];
    expect(consentDecision(r, "MARKETING_COMMS", "whatsapp", NOW, legacy).allowed).toBe(false);
  });
  it("a withdrawal older than the form timestamp does not block (the later event wins)", () => {
    const r = [row({ purpose: "MARKETING_COMMS", status: "WITHDRAWN", capturedAt: d("2026-07-01") })];
    expect(consentDecision(r, "MARKETING_COMMS", "whatsapp", NOW, legacy).allowed).toBe(true);
  });
  it("is ignored when the timestamp is in the future or invalid", () => {
    expect(consentDecision([], "MARKETING_COMMS", "whatsapp", NOW, { legacyMarketingConsentAt: d("2027-01-01") }).allowed).toBe(false);
    expect(consentDecision([], "MARKETING_COMMS", "whatsapp", NOW, { legacyMarketingConsentAt: new Date("x") }).allowed).toBe(false);
  });
});

describe("currentStates (latest row per purpose and channel)", () => {
  it("returns one row per purpose+channel, latest first by capturedAt", () => {
    const rows = [
      row({ purpose: "MARKETING_COMMS", status: "GRANTED", capturedAt: d("2026-01-01") }),
      row({ purpose: "MARKETING_COMMS", status: "WITHDRAWN", capturedAt: d("2026-02-01") }),
      row({ purpose: "MARKETING_COMMS", channel: "sms", status: "GRANTED", capturedAt: d("2026-02-15") }),
      row({ purpose: "CALL_RECORDING", status: "GRANTED", capturedAt: d("2026-01-05") }),
    ];
    const s = currentStates(rows);
    expect(s).toHaveLength(3);
    expect(s.find((r) => r.purpose === "MARKETING_COMMS" && r.channel === null)?.status).toBe("WITHDRAWN");
  });
});
