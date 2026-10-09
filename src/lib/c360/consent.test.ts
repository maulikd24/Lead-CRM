import { describe, expect, it } from "vitest";

import { buildConsentStatus } from "./consent";

const base = { marketingConsentAt: null, marketingConsentText: null, openIssueCount: 0, nbaProgramme: "MF / SIP opportunity" };

describe("buildConsentStatus", () => {
  it("reports no recorded consent without inventing one", () => {
    expect(buildConsentStatus(base)).toMatchObject({ marketing: "not_recorded", salesPaused: false, doNotPitch: false });
  });
  it("reports consent with its date", () => {
    expect(buildConsentStatus({ ...base, marketingConsentAt: new Date("2026-09-01T00:00:00Z"), marketingConsentText: "I agree" })).toMatchObject({ marketing: "given", consentAtIso: "2026-09-01T00:00:00.000Z" });
  });
  it("pauses sales while an issue is open", () => expect(buildConsentStatus({ ...base, openIssueCount: 1 }).salesPaused).toBe(true));
  it("flags do-not-pitch from the next best action", () => expect(buildConsentStatus({ ...base, nbaProgramme: "No Action / Do Not Pitch" }).doNotPitch).toBe(true));
});
