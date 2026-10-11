import { describe, expect, it } from "vitest";

import { clampExpiryDays, generateToken, hashToken, isWellFormedToken, scrubSnapshot, shareState } from "./share";

describe("tokens", () => {
  it("are 43 url-safe characters and different every time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = generateToken();
      expect(isWellFormedToken(t)).toBe(true);
      seen.add(t);
    }
    expect(seen.size).toBe(200);
  });
  it("only the hash is kept, and it is not the token", () => {
    const t = generateToken();
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(hashToken(generateToken()));
  });
  it("rejects malformed tokens before any lookup", () => {
    for (const bad of ["", "short", "a".repeat(44), "a".repeat(42) + "!", " " + "a".repeat(42), "../../etc/passwd"]) expect(isWellFormedToken(bad)).toBe(false);
  });
});

describe("expiry", () => {
  it("is between 1 and 30 days, default 7", () => {
    expect(clampExpiryDays(undefined)).toBe(7);
    expect(clampExpiryDays(0)).toBe(1);
    expect(clampExpiryDays(400)).toBe(30);
    expect(clampExpiryDays(14)).toBe(14);
    expect(clampExpiryDays(Number.NaN)).toBe(7);
  });
});

describe("shareState", () => {
  const now = new Date("2026-10-10T10:00:00Z");
  const row = { expiresAt: new Date("2026-10-17T10:00:00Z"), revokedAt: null as Date | null };
  it("is open before expiry", () => expect(shareState(row, now)).toBe("open"));
  it("is expired at and after the expiry instant", () => {
    expect(shareState(row, new Date("2026-10-17T10:00:00Z"))).toBe("expired");
    expect(shareState(row, new Date("2026-10-18T00:00:00Z"))).toBe("expired");
  });
  it("is revoked once revoked, even before expiry", () => expect(shareState({ ...row, revokedAt: new Date("2026-10-11T00:00:00Z") }, now)).toBe("revoked"));
  it("revoked wins over expired", () => expect(shareState({ expiresAt: new Date("2026-10-01T00:00:00Z"), revokedAt: new Date("2026-10-02T00:00:00Z") }, now)).toBe("revoked"));
});

describe("scrubSnapshot", () => {
  it("removes personal identifiers that slipped into a text and drops forbidden keys", () => {
    const { value, removed } = scrubSnapshot({ campaigns: [{ name: "Retarget a.b@example.com 9876543210 ABCDE1234F", clientId: "c1", funded: 3 }], email: "x@y.com", note: "fine" });
    const json = JSON.stringify(value);
    expect(json).not.toMatch(/example\.com|9876543210|ABCDE1234F|clientId|"email"/);
    expect(json).toContain("fine");
    expect(removed).toBeGreaterThan(0);
  });
  it("leaves ordinary numbers and names alone", () => {
    const input = { name: "Demat basics Q3", funded: 12, revenue: 123456.5, spend: 80000 };
    expect(scrubSnapshot(input)).toEqual({ value: input, removed: 0 });
  });
});
