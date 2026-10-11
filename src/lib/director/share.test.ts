import { describe, expect, it } from "vitest";

import { clampExpiryDays, generateToken, hashToken, isWellFormedToken, planShareDecision, scrubSnapshot, shareState } from "./share";

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

describe("shareState with approval (a new link opens nothing until a person approves it)", () => {
  const now = new Date("2026-10-10T10:00:00Z");
  const row = { expiresAt: new Date("2026-10-17T10:00:00Z"), revokedAt: null as Date | null, awaitingApproval: true };
  it("is pending while it awaits approval, and open once approved", () => {
    expect(shareState(row, now)).toBe("pending");
    expect(shareState({ ...row, awaitingApproval: false }, now)).toBe("open");
  });
  it("revoked (declined or withdrawn) and expired win over pending", () => {
    expect(shareState({ ...row, revokedAt: new Date("2026-10-11T00:00:00Z") }, now)).toBe("revoked");
    expect(shareState(row, new Date("2026-10-18T00:00:00Z"))).toBe("expired");
  });
  it("a row from before approval existed (no flag) reads as before", () => {
    expect(shareState({ expiresAt: row.expiresAt, revokedAt: null }, now)).toBe("open");
  });
});

describe("planShareDecision: approving or declining the publication of a report link", () => {
  const now = new Date("2026-10-10T10:00:00Z");
  const share = { awaitingApproval: true, revokedAt: null as Date | null, expiresAt: new Date("2026-10-17T10:00:00Z"), createdById: "u1" };
  const base = { share, actorId: "u2", fourEyes: false, now };
  it("approves a pending link with the reader's tick", () => {
    expect(planShareDecision({ ...base, decision: "approve", confirmed: true })).toEqual({ ok: true, decision: "approve" });
    expect(planShareDecision({ ...base, decision: "approve", confirmed: false })).toMatchObject({ ok: false });
  });
  it("four eyes on: the person who made the link may not approve it; off: they may", () => {
    expect(planShareDecision({ ...base, actorId: "u1", fourEyes: true, decision: "approve", confirmed: true })).toMatchObject({ ok: false, error: expect.stringMatching(/second person/i) });
    expect(planShareDecision({ ...base, actorId: "u1", fourEyes: false, decision: "approve", confirmed: true })).toMatchObject({ ok: true });
  });
  it("declining needs a reason, and is allowed to anyone who may decide, even the author", () => {
    expect(planShareDecision({ ...base, decision: "decline", reason: "" })).toMatchObject({ ok: false });
    expect(planShareDecision({ ...base, actorId: "u1", fourEyes: true, decision: "decline", reason: "Numbers look off" })).toEqual({ ok: true, decision: "decline", reason: "Numbers look off" });
  });
  it("only a pending, unexpired, unrevoked link can be decided", () => {
    for (const s of [{ ...share, awaitingApproval: false }, { ...share, revokedAt: new Date("2026-10-09T00:00:00Z") }, { ...share, expiresAt: new Date("2026-10-10T10:00:00Z") }]) {
      expect(planShareDecision({ ...base, share: s, decision: "approve", confirmed: true })).toMatchObject({ ok: false });
      expect(planShareDecision({ ...base, share: s, decision: "decline", reason: "x" })).toMatchObject({ ok: false });
    }
  });
});
