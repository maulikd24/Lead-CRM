import { describe, expect, it } from "vitest";

import { maskCkycRef, maskContactFields, maskContactInJson, maskEmail, maskMobile, toBrowserContact } from "./contact-mask";

describe("contact mask", () => {
  it("shows only the last 3 digits of a mobile", () => {
    expect(maskMobile("9876543123")).toBe("+91 ••••• ••123");
    expect(maskMobile("+91 98765 43123")).toBe("+91 ••••• ••123");
    expect(maskMobile("98765")).toBe("•••••");
    expect(maskMobile(null)).toBeNull();
  });
  it("keeps the first character and the domain of an email", () => {
    expect(maskEmail("asha.rao@gmail.com")).toBe("a•••@gmail.com");
    expect(maskEmail("nonsense")).toBe("••••");
    expect(maskEmail("")).toBeNull();
  });
  it("shows only the last 3 characters of a CKYC reference", () => {
    expect(maskCkycRef("50012345678901")).toBe("•••••••901");
    expect(maskCkycRef("12")).toBe("•••");
  });
  it("never leaves the raw value in a masked row", () => {
    const row = { id: "c1", mobile: "9876543123", email: "asha.rao@gmail.com", ckycRef: "50012345678901", name: "Test" };
    const json = JSON.stringify(maskContactFields(row));
    for (const raw of ["9876543123", "asha.rao", "50012345678901", "12345678"]) expect(json).not.toContain(raw);
    expect(json).toContain("Test");
  });
  it("only touches the fields the row has", () => {
    expect(maskContactFields({ id: "x", mobile: "9876543123" })).toEqual({ id: "x", mobile: "+91 ••••• ••123" });
  });
  it("removes the normalised copies of the contact from a row sent to the browser", () => {
    const row = { id: "c1", name: "Test", mobile: "9876543123", mobileKey: "9876543123", email: "Asha@Gmail.com", emailKey: "asha@gmail.com", ckycRef: "50012345678901", freshdeskSyncKey: "9876543123|asha@gmail.com" };
    const json = JSON.stringify(toBrowserContact(row));
    for (const raw of ["9876543123", "asha@gmail.com", "Asha", "50012345678901"]) expect(json).not.toContain(raw);
  });
  it("masks the contact keys inside audit values", () => {
    const json = JSON.stringify(maskContactInJson({ mobile: "9876543123", email: "asha@gmail.com", city: "Pune" }));
    expect(json).not.toContain("9876543123");
    expect(json).toContain("Pune");
  });
});
