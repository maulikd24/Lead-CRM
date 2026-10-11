import { describe, expect, it } from "vitest";

import { DEFAULT_APPROVAL_SETTINGS, parseApprovalSettings } from "./approval-settings";

describe("approval settings (where four eyes are required)", () => {
  it("default: ad copy needs a second person (as it always has), a report link does not", () => {
    expect(DEFAULT_APPROVAL_SETTINGS).toEqual({ adCreativeFourEyes: true, reportFourEyes: false });
  });
  it("reads a stored value and ignores anything it does not recognise", () => {
    expect(parseApprovalSettings({ adCreativeFourEyes: false, reportFourEyes: true, extra: 1 })).toEqual({ adCreativeFourEyes: false, reportFourEyes: true });
  });
  it("a broken or partial value falls back to the safe defaults, never to 'off'", () => {
    expect(parseApprovalSettings(null)).toEqual(DEFAULT_APPROVAL_SETTINGS);
    expect(parseApprovalSettings("nope")).toEqual(DEFAULT_APPROVAL_SETTINGS);
    expect(parseApprovalSettings({ adCreativeFourEyes: "no" })).toEqual(DEFAULT_APPROVAL_SETTINGS);
    expect(parseApprovalSettings({ reportFourEyes: true })).toEqual({ adCreativeFourEyes: true, reportFourEyes: true });
  });
});
