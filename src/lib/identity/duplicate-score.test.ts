import { describe, expect, it } from "vitest";
import { comparableEmail, comparablePhone, scoreDuplicate, type Identity } from "./duplicate-score";

const a: Identity = { id: "1", name: "Riya Sharma", mobile: "9876543210", email: "riya@example.com", pan: "ABCDE1234F" };
const other = (o: Partial<Identity>): Identity => ({ id: "2", name: "Someone Else", mobile: null, email: null, pan: null, ...o });

describe("scoreDuplicate", () => {
  it("is certain when the PAN matches", () => {
    expect(scoreDuplicate(a, { ...a, id: "2", mobile: null, email: null }).score).toBeGreaterThanOrEqual(0.95);
  });
  it("is strong for the same mobile with a similar name", () => {
    const r = scoreDuplicate(a, { id: "2", name: "Riya S Sharma", mobile: "+91 98765 43210", email: null, pan: null });
    expect(r.score).toBeGreaterThanOrEqual(0.8);
    expect(r.reasons).toContain("same mobile");
  });
  it("does not suggest people who only share a family name", () => {
    expect(scoreDuplicate(a, { id: "2", name: "Aman Sharma", mobile: "9123456780", email: "aman@example.com", pan: null }).score).toBeLessThan(0.5);
  });
  it("does not match two blank mobiles", () => {
    expect(scoreDuplicate({ ...a, mobile: null }, { id: "2", name: "Other Person", mobile: null, email: null, pan: null }).score).toBeLessThan(0.5);
  });
  it("treats PANs case-insensitively", () => {
    expect(scoreDuplicate(a, { ...a, id: "2", pan: "abcde1234f" }).score).toBeGreaterThanOrEqual(0.95);
  });

  it("family mobile with a different first name stays below the 0.8 threshold", () => {
    const r = scoreDuplicate({ ...a, pan: null }, other({ name: "Aman Sharma", mobile: "9876543210" }));
    expect(r.score).toBeLessThan(0.8);
    expect(r.reasons).toContain("same mobile");
  });
  it("family mobile with totally different names is low", () => {
    expect(scoreDuplicate({ ...a, pan: null }, other({ name: "Kavita Mehta", mobile: "9876543210" })).score).toBeLessThan(0.7);
  });
  it("matches an initial against a full name on the same mobile", () => {
    const r = scoreDuplicate({ ...a, pan: null }, other({ name: "R Sharma", mobile: "9876543210" }));
    expect(r.score).toBeGreaterThanOrEqual(0.8);
  });
  it("same email with a different mobile is only a weak-to-medium signal", () => {
    const r = scoreDuplicate({ ...a, pan: null }, other({ name: "Riya Sharma", mobile: "9000000000", email: "RIYA@example.com " }));
    expect(r.reasons).toContain("same email");
    expect(r.score).toBeGreaterThanOrEqual(0.5);
    expect(r.score).toBeLessThan(0.8);
  });
  it("same email with a different name and mobile is low", () => {
    expect(scoreDuplicate({ ...a, pan: null }, other({ email: "riya@example.com", mobile: "9000000000" })).score).toBeLessThan(0.5);
  });
  it("different PANs mean different legal persons, even on the same mobile, name and email", () => {
    const r = scoreDuplicate(a, { ...a, id: "2", pan: "ZZZZZ9999Z" });
    expect(r.score).toBe(0);
    expect(r.reasons).toEqual(["different PAN"]);
  });
  it("one PAN present and one missing still scores on mobile and name", () => {
    expect(scoreDuplicate(a, other({ name: "Riya Sharma", mobile: "9876543210" })).score).toBeGreaterThanOrEqual(0.8);
  });
  it("handles swapped first and last names", () => {
    expect(scoreDuplicate({ ...a, pan: null }, other({ name: "Sharma Riya", mobile: "9876543210" })).score).toBeGreaterThanOrEqual(0.8);
  });
  it("ignores case and spacing differences in names", () => {
    expect(scoreDuplicate({ ...a, pan: null }, other({ name: "  RIYA   sharma ", mobile: "9876543210" })).score).toBeGreaterThanOrEqual(0.8);
  });
  it("does not crash on or match Devanagari against Latin names", () => {
    const r = scoreDuplicate({ ...a, pan: null }, other({ name: "रिया शर्मा", mobile: "9000000000" }));
    expect(r.score).toBe(0);
  });
  it("same mobile with a Devanagari name does not reach the threshold", () => {
    expect(scoreDuplicate({ ...a, pan: null }, other({ name: "रिया शर्मा", mobile: "9876543210" })).score).toBeLessThan(0.8);
  });
  it("handles empty names without crashing", () => {
    expect(scoreDuplicate({ ...a, pan: null, name: "" }, other({ name: "   ", mobile: "9876543210" })).score).toBeLessThan(0.8);
  });
  it("never exceeds 1", () => {
    expect(scoreDuplicate({ ...a, pan: null }, { ...a, id: "2", pan: null }).score).toBeLessThanOrEqual(0.97);
  });

  it("treats a leading-zero mobile as the same as the bare number", () => {
    expect(scoreDuplicate({ ...a, pan: null }, other({ name: "Riya Sharma", mobile: "09876543210" })).reasons).toContain("same mobile");
  });
  it("does not count placeholder mobiles (all the same digit) as shared", () => {
    for (const m of ["0000000000", "9999999999"]) {
      const r = scoreDuplicate({ ...a, pan: null, mobile: m }, other({ name: "Riya Sharma", mobile: m }));
      expect(r.reasons).not.toContain("same mobile");
      expect(r.score).toBeLessThan(0.8);
    }
  });
  it("does not count short mobiles (under 10 digits) as shared", () => {
    const r = scoreDuplicate({ ...a, pan: null, mobile: "2212345" }, other({ name: "Riya Sharma", mobile: "2212345" }));
    expect(r.reasons).not.toContain("same mobile");
  });
  it("a single-token name does not match a full name containing it", () => {
    const r = scoreDuplicate({ ...a, pan: null, name: "Sharma" }, other({ name: "Aman Sharma", mobile: "9876543210" }));
    expect(r.reasons).not.toContain("similar name");
    expect(r.score).toBeLessThan(0.8);
  });
  it("two identical single-token names do match", () => {
    expect(scoreDuplicate({ ...a, pan: null, name: "Sharma" }, other({ name: "SHARMA", mobile: "9876543210" })).score).toBeGreaterThanOrEqual(0.8);
  });
});

describe("comparable contact keys follow the shared identity rule", () => {
  it("treats every common phone shape as the same number", () => {
    for (const raw of ["9876543210", "+91 98765-43210", "919876543210", "09876543210", "0091 98765 43210", "+91 09876543210"]) {
      expect(comparablePhone(raw)).toBe("9876543210");
    }
  });
  it("rejects fragments and repeated-digit placeholders", () => {
    expect(comparablePhone("12345")).toBeNull();
    expect(comparablePhone("9999999999")).toBeNull();
  });
  it("lower-cases and trims email, requiring an @", () => {
    expect(comparableEmail("  Riya@Example.COM ")).toBe("riya@example.com");
    expect(comparableEmail("nope")).toBeNull();
  });
});
