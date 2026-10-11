import { describe, expect, it } from "vitest";

import { buildDigest, createWeeklyDigest, decideDigest, shouldRunDigest, weekStartOf, type DigestDeps, type DigestFacts, type DigestRow } from "./digest";

const facts: DigestFacts = {
  weekStart: "2026-10-05", health: 71, wastedSpend: 18_400, wastedShare: 0.12, totalSpend: 153_000, open: 6, newThisWeek: 2, approvedWaiting: 1, dataAge: "5 hours old",
  top: [{ issue: "Cost per funded customer is over target on Meta - Demat open", impact: "Could save about ₹12,000 a month" }, { issue: "Leads arriving 9pm-7am are called late", impact: "" }],
};

function harness(over: Partial<DigestDeps> = {}) {
  const rows = new Map<string, DigestRow>();
  const notified: { users: string[]; payload: Record<string, unknown> }[] = [];
  const sent: { to: string[]; subject: string; text: string }[] = [];
  const deps: DigestDeps = {
    now: () => new Date("2026-10-12T04:00:00.000Z"),
    facts: async () => facts,
    recipients: async () => [{ id: "u1", email: "a@example.test" }, { id: "u2", email: "m@example.test" }],
    insert: async (row) => { if ([...rows.values()].some((r) => r.weekStart === row.weekStart)) return false; rows.set(row.id, row); return true; },
    exists: async (w) => [...rows.values()].some((r) => r.weekStart === w),
    get: async (id) => rows.get(id) ?? null,
    claim: async (id, to, by) => { const r = rows.get(id); if (!r || r.status !== "DRAFT") return false; rows.set(id, { ...r, status: to, decidedById: by }); return true; },
    release: async (id) => { const r = rows.get(id)!; rows.set(id, { ...r, status: "DRAFT", decidedById: null }); },
    notify: async (users, payload) => { notified.push({ users, payload }); },
    send: async (m) => { sent.push(m); return { ok: true }; },
    newId: () => "d1",
    ...over,
  };
  return { deps, rows, notified, sent };
}

describe("the digest content", () => {
  it("is aggregates only: health, waste, open proposals and the top issues, with the data's age", () => {
    const d = buildDigest(facts);
    expect(d.subject).toMatch(/Autopilot/);
    expect(d.body).toContain("71");
    expect(d.body).toContain("₹18,400");
    expect(d.body).toContain("5 hours old");
    expect(d.body).toContain("Cost per funded customer is over target");
    expect(d.body).not.toMatch(/\b\d{10}\b|@|PAN|phone|email/i);
    expect(d.inApp).toEqual({ open: 6, health: 71 });
  });
  it("says so when there is no health score or no spend (never a made-up number)", () => {
    const d = buildDigest({ ...facts, health: null, wastedSpend: null, wastedShare: null, totalSpend: null, top: [] });
    expect(d.body).toMatch(/not enough data/i);
    expect(d.body).not.toMatch(/NaN|undefined|null/);
  });
  it("finds Monday of the week in India", () => {
    expect(weekStartOf(new Date("2026-10-12T04:00:00.000Z"))).toBe("2026-10-12"); // Monday 09:30 IST
    expect(weekStartOf(new Date("2026-10-11T20:00:00.000Z"))).toBe("2026-10-12"); // Monday 01:30 IST
    expect(weekStartOf(new Date("2026-10-18T10:00:00.000Z"))).toBe("2026-10-12"); // Sunday
  });
  it("is due from Monday 08:00 IST, once per week", () => {
    expect(shouldRunDigest(new Date("2026-10-12T01:00:00.000Z"), false)).toBe(false); // 06:30 IST
    expect(shouldRunDigest(new Date("2026-10-12T04:00:00.000Z"), false)).toBe(true);
    expect(shouldRunDigest(new Date("2026-10-12T04:00:00.000Z"), true)).toBe(false);
    expect(shouldRunDigest(new Date("2026-10-14T04:00:00.000Z"), false)).toBe(true); // a missed Monday is caught up
  });
});

describe("creating the weekly digest: an in-app notification and a DRAFT email, never a sent one", () => {
  it("stores a draft, notifies the recipients in app, sends nothing", async () => {
    const h = harness();
    const r = await createWeeklyDigest(h.deps);
    expect(r).toMatchObject({ created: true });
    expect([...h.rows.values()][0]).toMatchObject({ status: "DRAFT", weekStart: "2026-10-12" });
    expect(h.notified).toHaveLength(1);
    expect(h.notified[0].users).toEqual(["u1", "u2"]);
    expect(h.sent).toEqual([]);
  });
  it("creates one digest per week: a second run does nothing and notifies nobody again", async () => {
    const h = harness();
    await createWeeklyDigest(h.deps);
    expect(await createWeeklyDigest(h.deps)).toMatchObject({ created: false });
    expect(h.notified).toHaveLength(1);
  });
  it("a concurrent second run loses the insert race and notifies nobody", async () => {
    const h = harness({ exists: async () => false });
    await createWeeklyDigest(h.deps);
    expect(await createWeeklyDigest(h.deps)).toMatchObject({ created: false });
    expect(h.notified).toHaveLength(1);
  });
  it("with nobody to receive it, it creates nothing", async () => {
    const h = harness({ recipients: async () => [] });
    expect(await createWeeklyDigest(h.deps)).toMatchObject({ created: false });
    expect(h.rows.size).toBe(0);
  });
});

describe("approving the draft email", () => {
  async function drafted() { const h = harness(); await createWeeklyDigest(h.deps); return h; }
  it("a person approves; only then is it sent, to the recipients, once", async () => {
    const h = await drafted();
    expect(await decideDigest(h.deps, { id: "d1", actorId: "u1", verdict: "approve" })).toEqual({ ok: true });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].to).toEqual(["a@example.test", "m@example.test"]);
    expect(h.rows.get("d1")!.status).toBe("APPROVED");
    expect(await decideDigest(h.deps, { id: "d1", actorId: "u2", verdict: "approve" })).toMatchObject({ ok: false });
    expect(h.sent).toHaveLength(1);
  });
  it("needs a person", async () => {
    const h = await drafted();
    expect(await decideDigest(h.deps, { id: "d1", actorId: "", verdict: "approve" })).toMatchObject({ ok: false });
    expect(h.sent).toEqual([]);
    expect(h.rows.get("d1")!.status).toBe("DRAFT");
  });
  it("discarding sends nothing", async () => {
    const h = await drafted();
    expect(await decideDigest(h.deps, { id: "d1", actorId: "u1", verdict: "discard" })).toEqual({ ok: true });
    expect(h.sent).toEqual([]);
    expect(h.rows.get("d1")!.status).toBe("DISCARDED");
  });
  it("a failed send puts the draft back so it can be tried again, and says so", async () => {
    const h = await drafted();
    h.deps.send = async () => ({ ok: false, error: "mail server refused" });
    expect(await decideDigest(h.deps, { id: "d1", actorId: "u1", verdict: "approve" })).toMatchObject({ ok: false, error: expect.stringMatching(/not sent/i) });
    expect(h.rows.get("d1")!.status).toBe("DRAFT");
  });
  it("an unknown draft is a plain error", async () => {
    const h = await drafted();
    expect(await decideDigest(h.deps, { id: "nope", actorId: "u1", verdict: "approve" })).toMatchObject({ ok: false });
  });
});
