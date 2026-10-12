import { describe, expect, it } from "vitest";

import { emptyCounts, hasIdentifier, redactFeedback } from "./redact";

// Synthetic identifiers only. None belongs to a real person or account.
describe("redactFeedback: one rule per identifier", () => {
  it("masks an email address", () => {
    const r = redactFeedback("write to test.user+tag@example.com today");
    expect(r.text).toBe("write to [email] today");
    expect(r.counts.email).toBe(1);
  });

  it("masks a PAN (5 letters, 4 digits, 1 letter) as a whole word only", () => {
    const r = redactFeedback("my PAN is ABCDE1234F, not a word");
    expect(r.text).toBe("my PAN is [pan], not a word");
    expect(r.counts.pan).toBe(1);
    // Longer or lower-case runs are not PANs.
    expect(redactFeedback("ABCDE12345F and abcde1234f").counts.pan).toBe(0);
  });

  it("masks a 12-digit Aadhaar-like number, grouped or not", () => {
    expect(redactFeedback("id 1234 5678 9012 on file").text).toBe("id [aadhaar] on file");
    expect(redactFeedback("id 1234-5678-9012 on file").text).toBe("id [aadhaar] on file");
    expect(redactFeedback("id 123456789012 on file").counts.aadhaar).toBe(1);
  });

  it("masks an Indian mobile number with and without the +91 prefix", () => {
    expect(redactFeedback("call +91 98765 43210 please").text).toBe("call [phone] please");
    expect(redactFeedback("call 9876543210 please").text).toBe("call [phone] please");
    expect(redactFeedback("call +919876543210 please").counts.phone).toBe(1);
  });

  it("does not take a mobile-shaped number out of the middle of a longer run", () => {
    // A 10-digit run that starts with 1 is not a mobile number; it falls to the account rule instead.
    expect(redactFeedback("ref 1234567890").counts.phone).toBe(0);
  });

  it("masks an account-like run of 9 to 18 digits", () => {
    const r = redactFeedback("account 123456789012345 was debited");
    expect(r.text).toBe("account [account] was debited");
    expect(r.counts.account).toBe(1);
    expect(redactFeedback("ref 12345678").counts.account).toBe(0); // 8 digits: left alone
  });

  it("counts each kind and leaves ordinary text, including short amounts, untouched", () => {
    const r = redactFeedback("Rs 5000 late, ABCDE1234F, a@b.co, 9876543210, 123456789");
    expect(r.counts).toEqual({ email: 1, pan: 1, aadhaar: 0, phone: 1, account: 1 });
    expect(r.text).toContain("Rs 5000 late");
  });

  it("returns empty counts and the same text when there is nothing to mask", () => {
    const r = redactFeedback("The statement came late, twice.");
    expect(r.text).toBe("The statement came late, twice.");
    expect(r.counts).toEqual(emptyCounts());
  });

  it("is idempotent: a second pass finds nothing new", () => {
    const once = redactFeedback("ABCDE1234F and 9876543210 and a@b.co and 123456789012345");
    const twice = redactFeedback(once.text);
    expect(twice.text).toBe(once.text);
    expect(hasIdentifier(once.text)).toBe(false);
  });

  it("hasIdentifier flags text that still holds a shape", () => {
    expect(hasIdentifier("contact a@b.co")).toBe(true);
    expect(hasIdentifier("nothing here")).toBe(false);
  });
});
