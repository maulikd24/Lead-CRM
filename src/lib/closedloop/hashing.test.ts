import { describe, expect, it } from "vitest";

import { buildMatchData, googleEmail, googlePhone, metaEmail, metaPhone, sha256Hex } from "./hashing";

describe("sha256Hex", () => {
  it("is lowercase hex SHA-256 (known vector)", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("Meta normalisation (trim, lowercase email; digits with country code and no leading zeros for phone)", () => {
  it("email", () => {
    expect(metaEmail("  Asha@Example.COM ")).toBe("asha@example.com");
    expect(metaEmail("not an email")).toBeNull();
    expect(metaEmail("")).toBeNull();
    expect(metaEmail(null)).toBeNull();
  });
  it("phone: every Indian shape becomes 91 + ten digits", () => {
    for (const raw of ["+91 98765-43210", "09876543210", "919876543210", "0091 9876543210", "98765 43210"]) expect(metaPhone(raw), raw).toBe("919876543210");
  });
  it("phone: a short or missing number is not usable", () => {
    expect(metaPhone("12345")).toBeNull();
    expect(metaPhone(null)).toBeNull();
  });
  it("phone: an international number keeps its own country code", () => {
    expect(metaPhone("+44 7911 123456")).toBe("447911123456");
  });
});

describe("Google normalisation (E.164 with plus for phone; gmail dots removed)", () => {
  it("email: lowercase, no whitespace, dots removed in gmail and googlemail local parts only", () => {
    expect(googleEmail(" Asha.Sharma@Gmail.com ")).toBe("ashasharma@gmail.com");
    expect(googleEmail("a.b@googlemail.com")).toBe("ab@googlemail.com");
    expect(googleEmail("a.b@example.com")).toBe("a.b@example.com");
  });
  it("phone: E.164", () => {
    expect(googlePhone("09876543210")).toBe("+919876543210");
    expect(googlePhone("+91 98765 43210")).toBe("+919876543210");
    expect(googlePhone("x")).toBeNull();
  });
});

describe("buildMatchData", () => {
  const client = { email: "Asha@Example.com", mobile: "+91 98765 43210", attribution: { fbclid: "IwAR_click", gclid: "Cj0KCQ_x", fbp: "fb.1.1700000000000.123456789", name: "Asha", utm_source: "facebook" } };

  it("meta: hashed email and phone under the Meta rules, plus fbp and fbc, never raw values", () => {
    const m = buildMatchData("meta", client, new Date("2027-03-01T00:00:00Z"));
    expect(m.hashedEmail).toBe(sha256Hex("asha@example.com"));
    expect(m.hashedPhone).toBe("92b5072176e723878b5e06ff3ca61898e4eb74e8c46642a0f2db800b17364ab0");
    expect(m.fbp).toBe("fb.1.1700000000000.123456789");
    expect(m.fbc).toBe(`fb.1.${Date.parse("2027-03-01T00:00:00Z")}.IwAR_click`);
    expect(m.gclid).toBeUndefined();
    expect(JSON.stringify(m)).not.toMatch(/asha|9876543210|Example/i);
  });
  it("google: E.164 hash for phone, gclid carried, no meta ids", () => {
    const m = buildMatchData("google", client, new Date());
    expect(m.hashedPhone).toBe("f3a47ce5ce3d4ca8ad15225a245b2759022f79489f5c62719b8c9490f7aab90e");
    expect(m.hashedEmail).toBe(sha256Hex("asha@example.com"));
    expect(m.gclid).toBe("Cj0KCQ_x");
    expect(m.fbp).toBeUndefined();
    expect(m.fbc).toBeUndefined();
  });
  it("an stored fbc cookie wins over one rebuilt from fbclid", () => {
    expect(buildMatchData("meta", { ...client, attribution: { fbc: "fb.1.1.COOKIE" } }, new Date()).fbc).toBe("fb.1.1.COOKIE");
  });
  it("click ids that are not plain tokens are dropped", () => {
    const m = buildMatchData("meta", { email: null, mobile: null, attribution: { fbclid: "a b<script>", fbp: "x".repeat(300) } }, new Date());
    expect(m).toEqual({});
  });
  it("reports which identifiers exist, so 'no identifiers' can be explained", () => {
    expect(buildMatchData("meta", { email: null, mobile: null, attribution: null }, new Date())).toEqual({});
  });
});
