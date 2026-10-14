import { describe, expect, it } from "vitest";

import { showDocumentChecklist } from "./document-checklist";

describe("showDocumentChecklist", () => {
  it("is reachable at New Lead once collection has started, so the RM can clear the block before Submit for KYC", () => {
    expect(showDocumentChecklist("New Lead", true)).toBe(true);
  });
  it("is shown while the KYC is submitted", () => {
    expect(showDocumentChecklist("Submitted for KYC", true)).toBe(true);
    expect(showDocumentChecklist("Submitted for KYC", false)).toBe(true);
  });
  it("is not shown before collection starts at New Lead (Start documents comes first) or after the KYC pipeline", () => {
    expect(showDocumentChecklist("New Lead", false)).toBe(false);
    expect(showDocumentChecklist("KYC completed", true)).toBe(false);
    expect(showDocumentChecklist("Pushed for funds", true)).toBe(false);
  });
});
