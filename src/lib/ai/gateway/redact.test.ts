import { describe, expect, it } from "vitest";

import { findSensitive, redact, scrub, scrubForVendor } from "./redact";

// The previous implementations, copied verbatim as the reference the shared redactor must still equal.
const DEVANAGARI_DIGITS = /[०-९]/g;
const LINK = /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?[\/?#]\S*/gi;
const PAN_LOOSE = /\b[A-Z]{5}\s?\d{4}\s?[A-Z]\b/gi;
const DIGIT_RUN = /\+?\d[\d\s().\/-]{4,}\d/g;
function oldScrub(s: string): string {
  return s.replace(/\S+@\S+/g, "[email]").replace(/\b[A-Z]{5}\d{4}[A-Z]\b/gi, "[id]").replace(/\+?\d[\d\s-]{4,}\d/g, (m) => (m.replace(/\D/g, "").length >= 6 ? "[number]" : m)).replace(/\d{6,}/g, "[number]");
}
function oldScrubForVendor(input: string): string {
  const ascii = input.replace(DEVANAGARI_DIGITS, (d) => String.fromCharCode(d.charCodeAt(0) - 0x966 + 48));
  const digits = ascii.replace(PAN_LOOSE, "[id]").replace(LINK, "$1").replace(DIGIT_RUN, (m) => (m.replace(/\D/g, "").length >= 6 ? "[number]" : m));
  return oldScrub(digits);
}

const CORPUS = [
  "Hi Riya, my number is +91 98765 43210 and mail riya.s@example.com",
  "PAN ABCDE1234F and abcde 1234 f both",
  "see https://pay.example.com/x?token=abc123 and www.foo.in/path",
  "call me on ९८७६५ ४३२१०",
  "plain text with 3 apples and 12/05/2026",
  "account 123456789012 and dob 01-02-1990",
  "Please share the KYC documents when you can.",
  "",
];

describe("redact is a superset of the old scrubbers", () => {
  it.each(CORPUS)("scrubForVendor equals the previous implementation: %s", (t) => expect(scrubForVendor(t)).toBe(oldScrubForVendor(t)));
  it.each(CORPUS)("scrub equals the previous implementation: %s", (t) => expect(scrub(t)).toBe(oldScrub(t)));
});

describe("redact", () => {
  it("counts what it removed, by kind, and never returns the removed text", () => {
    const r = redact("a@b.com c@d.com ABCDE1234F 9876543210");
    expect(r.summary).toMatchObject({ email: 2, pan: 1, number: 1 });
    expect(JSON.stringify(r.summary)).not.toMatch(/a@b|ABCDE|9876/);
  });
  it("keeps phone and email when the purpose needs contact details, but ALWAYS removes a PAN", () => {
    const r = redact("mail a@b.com phone 9876543210 pan ABCDE1234F", { allowContactIdentifiers: true });
    expect(r.text).toContain("a@b.com");
    expect(r.text).toContain("9876543210");
    expect(r.text).not.toMatch(/ABCDE1234F/);
  });
  it("strips known names (whole words, any case) unless the purpose needs names", () => {
    expect(redact("Riya Sharma asked; riya agrees", { knownNames: ["Riya Sharma"] }).text).toBe("[name] asked; [name] agrees");
    expect(redact("Riya asked", { knownNames: ["Riya"], allowNames: true }).text).toBe("Riya asked");
  });
  it("is idempotent", () => {
    const once = redact("x@y.com 9876543210 ABCDE1234F https://a.b.com/p?q=1").text;
    expect(redact(once).text).toBe(once);
  });
  it("findSensitive reports what survives, used as the gateway's last check", () => {
    expect(findSensitive("clean text")).toEqual([]);
    expect(findSensitive("pan ABCDE1234F")).toContain("pan");
    expect(findSensitive("mail a@b.com")).toContain("email");
    expect(findSensitive("mail a@b.com", { allowContactIdentifiers: true })).toEqual([]);
  });
});
