import { describe, expect, it } from "vitest";

import { PURPOSES, consentRequirement, getPurpose } from "./purposes";

describe("the purpose registry is linted", () => {
  it("has unique ids and unique prompt ids with a version", () => {
    expect(new Set(PURPOSES.map((p) => p.id)).size).toBe(PURPOSES.length);
    expect(new Set(PURPOSES.map((p) => p.prompt.id)).size).toBe(PURPOSES.length);
    for (const p of PURPOSES) expect(p.prompt.version, p.id).toMatch(/^\d+(\.\d+)*$/);
  });
  it("customer text and identifiers always need a ledger consent purpose (never an exemption)", () => {
    for (const p of PURPOSES.filter((x) => x.dataClass === "customer_text" || x.dataClass === "customer_identifiers")) expect(consentRequirement(p), p.id).not.toBeNull();
  });
  it("customer facts name a ledger purpose or carry a written reason for the exemption", () => {
    for (const p of PURPOSES.filter((x) => x.dataClass === "customer_facts")) {
      expect(p.consent, p.id).not.toBeNull();
      if (p.consent && "exempt" in p.consent) expect(p.consent.exempt.length, p.id).toBeGreaterThan(40);
    }
  });
  it("only a purpose that reads transcripts may receive contact details", () => {
    for (const p of PURPOSES.filter((x) => x.allowContactIdentifiers)) expect(p.dataClass, p.id).toBe("customer_text");
  });
  it("a purpose with no customer data needs no consent and takes no names", () => {
    for (const p of PURPOSES.filter((x) => x.dataClass === "none")) { expect(p.consent, p.id).toBeNull(); expect(p.allowNames, p.id).toBe(false); }
  });
  it("has sane limits: bounded tokens, a timeout, at most three attempts", () => {
    for (const p of PURPOSES) {
      expect(p.maxTokens, p.id).toBeGreaterThan(0);
      expect(p.maxTokens, p.id).toBeLessThanOrEqual(4096);
      expect(p.timeoutMs, p.id).toBeGreaterThanOrEqual(1000);
      expect(p.maxAttempts, p.id).toBeGreaterThanOrEqual(1);
      expect(p.maxAttempts, p.id).toBeLessThanOrEqual(3);
    }
  });
  it("looks purposes up by id", () => {
    expect(getPurpose("nudger.draft")?.agentKey).toBe("wa_nudger");
    expect(getPurpose("nope")).toBeUndefined();
  });
});
