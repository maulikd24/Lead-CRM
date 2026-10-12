import { describe, expect, it } from "vitest";

import { callBlockReason, callStatusFromExotel, exotelNumber, isValidCallPhone, withinCallingHours } from "./policy";

// 10:30 IST = 05:00 UTC; 21:15 IST = 15:45 UTC; 08:59 IST = 03:29 UTC.
const IST_1030 = new Date("2026-10-12T05:00:00Z");
const IST_2115 = new Date("2026-10-12T15:45:00Z");
const IST_0859 = new Date("2026-10-12T03:29:00Z");

describe("calling hours (IST, whatever the server zone)", () => {
  it("allows 09:00 to 21:00 IST only", () => {
    expect(withinCallingHours(IST_1030)).toBe(true);
    expect(withinCallingHours(IST_2115)).toBe(false);
    expect(withinCallingHours(IST_0859)).toBe(false);
    expect(withinCallingHours(new Date("2026-10-12T03:30:00Z"))).toBe(true); // 09:00 IST exactly
  });
});

describe("numbers", () => {
  it("formats Indian numbers for Exotel and keeps international ones", () => {
    expect(exotelNumber("+91 98765-43210")).toBe("09876543210");
    expect(exotelNumber("9876543210")).toBe("09876543210");
    expect(exotelNumber("+44 20 7946 0958")).toBe("+442079460958");
    expect(exotelNumber("12345")).toBeNull();
    expect(exotelNumber(null)).toBeNull();
  });
  it("accepts an Indian mobile as a calling number", () => {
    expect(isValidCallPhone("+91 98765 43210")).toBe(true);
    expect(isValidCallPhone("022 2345 6789")).toBe(false); // landline
    expect(isValidCallPhone("abc")).toBe(false);
  });
});

describe("callBlockReason", () => {
  const ok = { now: IST_1030, clientStatus: "ACTIVE", clientMobile: "9876543210", callerPhone: "9123456780", consentAllowed: true, hasActiveCall: false };
  it("allows a normal call", () => expect(callBlockReason(ok)).toBeNull());
  it("says why a call can't go out", () => {
    expect(callBlockReason({ ...ok, hasActiveCall: true })).toMatch(/already on a call/);
    expect(callBlockReason({ ...ok, callerPhone: null })).toMatch(/calling number/);
    expect(callBlockReason({ ...ok, clientMobile: null })).toMatch(/no valid mobile/);
    expect(callBlockReason({ ...ok, clientStatus: "NOT_PROCEEDING" })).toMatch(/Not proceeding/);
    expect(callBlockReason({ ...ok, consentAllowed: false })).toMatch(/opted out/);
    expect(callBlockReason({ ...ok, now: IST_2115 })).toMatch(/9:00 and 21:00 IST/);
  });
});

describe("callStatusFromExotel", () => {
  it("maps Exotel's statuses", () => {
    expect(callStatusFromExotel("in-progress")).toBe("IN_PROGRESS");
    expect(callStatusFromExotel(undefined, "answered")).toBe("IN_PROGRESS");
    expect(callStatusFromExotel("completed")).toBe("COMPLETED");
    expect(callStatusFromExotel("no-answer")).toBe("NO_ANSWER");
    expect(callStatusFromExotel("busy")).toBe("BUSY");
    expect(callStatusFromExotel("failed")).toBe("FAILED");
    expect(callStatusFromExotel("weird")).toBe("FAILED");
  });
});
