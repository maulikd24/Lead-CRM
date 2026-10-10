import { describe, expect, it } from "vitest";

import { buildConsentStatus } from "./consent";

const NOW = new Date("2026-10-10T00:00:00Z");
const base = { marketingConsentAt: null, marketingConsentText: null, openIssueCount: 0, nbaProgramme: "MF / SIP opportunity", records: [], now: NOW };
const row = (o: Partial<{ purpose: string; channel: string | null; status: string; capturedAt: Date; expiresAt: Date | null; source: string }>) => ({ purpose: "MARKETING_COMMS", channel: "whatsapp", status: "GRANTED", capturedAt: new Date("2026-09-20T00:00:00Z"), source: "APP", ...o });

describe("buildConsentStatus", () => {
  it("reports no recorded consent without inventing one", () => {
    expect(buildConsentStatus(base)).toMatchObject({ marketing: "not_recorded", salesPaused: false, doNotPitch: false });
  });
  it("reports consent with its date", () => {
    expect(buildConsentStatus({ ...base, marketingConsentAt: new Date("2026-09-01T00:00:00Z"), marketingConsentText: "I agree" })).toMatchObject({ marketing: "given", consentAtIso: "2026-09-01T00:00:00.000Z" });
  });
  it("pauses sales while an issue is open", () => expect(buildConsentStatus({ ...base, openIssueCount: 1 }).salesPaused).toBe(true));
  it("flags do-not-pitch from the next best action", () => expect(buildConsentStatus({ ...base, nbaProgramme: "No Action / Do Not Pitch" }).doNotPitch).toBe(true));

  describe("reads the consent ledger, not only the lead-form timestamp", () => {
    it("shows a ledger grant as given even with no lead-form timestamp", () => {
      expect(buildConsentStatus({ ...base, records: [row({})] })).toMatchObject({ marketing: "given", consentAtIso: "2026-09-20T00:00:00.000Z", sourceLabel: "App", channelLabel: "WhatsApp" });
    });
    it("shows the newest entry: a later withdrawal wins over an earlier grant", () => {
      const records = [row({}), row({ status: "WITHDRAWN", capturedAt: new Date("2026-10-01T00:00:00Z") })];
      expect(buildConsentStatus({ ...base, records })).toMatchObject({ marketing: "withdrawn", consentAtIso: "2026-10-01T00:00:00.000Z" });
    });
    it("shows do not contact when the flag is in force, over a marketing grant", () => {
      const records = [row({}), row({ purpose: "DO_NOT_CONTACT", channel: null, capturedAt: new Date("2026-10-02T00:00:00Z") })];
      expect(buildConsentStatus({ ...base, records }).marketing).toBe("do_not_contact");
    });
    it("lifts do not contact when a later entry withdraws the flag", () => {
      const records = [row({}), row({ purpose: "DO_NOT_CONTACT", channel: null, capturedAt: new Date("2026-10-02T00:00:00Z") }), row({ purpose: "DO_NOT_CONTACT", channel: null, status: "WITHDRAWN", capturedAt: new Date("2026-10-03T00:00:00Z") })];
      expect(buildConsentStatus({ ...base, records }).marketing).toBe("given");
    });
    it("reports an expired grant as expired", () => {
      expect(buildConsentStatus({ ...base, records: [row({ expiresAt: new Date("2026-10-01T00:00:00Z") })] }).marketing).toBe("expired");
    });
    it("still honours the lead-form timestamp when the ledger has nothing", () => {
      expect(buildConsentStatus({ ...base, marketingConsentAt: new Date("2026-09-01T00:00:00Z") })).toMatchObject({ marketing: "given", sourceLabel: "Lead form" });
    });
    it("ignores entries dated in the future", () => {
      expect(buildConsentStatus({ ...base, records: [row({ capturedAt: new Date("2026-12-01T00:00:00Z") })] }).marketing).toBe("not_recorded");
    });
    it("ignores other purposes", () => {
      expect(buildConsentStatus({ ...base, records: [row({ purpose: "SERVICE_COMMS" })] }).marketing).toBe("not_recorded");
    });
  });
});
