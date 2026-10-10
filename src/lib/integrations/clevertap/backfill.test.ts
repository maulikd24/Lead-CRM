import { describe, expect, it, vi } from "vitest";
import { applyBackfill, contactFromPayload, planBackfill, type BackfillDeps, type StaleRow } from "./backfill";

const row = (over: Partial<StaleRow> = {}): StaleRow => ({ id: "r1", externalId: "sub-1", clientId: null, phoneKey: null, email: null, ...over });

/** Fake deps: a tiny world of live customers, merge links and ledger ids. */
function world(w: {
  byPhone?: Record<string, string[]>;
  byEmail?: Record<string, string[]>;
  live?: Record<string, string | null>; // clientId -> survivor id (itself when live) or null when gone
  ids?: Record<string, string[]>; // clientId -> app ids already on it
}): BackfillDeps & { linked: [string, string | null, string][] } {
  const linked: [string, string | null, string][] = [];
  return {
    linked,
    resolveLive: async (id) => (w.live && id in w.live ? w.live[id] : null),
    clientsByPhoneKey: async (k) => w.byPhone?.[k] ?? [],
    clientsByEmail: async (e) => w.byEmail?.[e] ?? [],
    appIdsOf: async (id) => w.ids?.[id] ?? [],
    link: async (rowId, from, to) => { linked.push([rowId, from, to]); return true; },
  };
}

describe("contactFromPayload", () => {
  it("reads the normalised phone (last 10 digits) and email from the ledger payload", () => {
    expect(contactFromPayload({ raw: {}, normalized: { phone: "+91 98765-43210", email: "A@Example.test" } })).toEqual({ phoneKey: "9876543210", email: "a@example.test" });
  });
  it("falls back to the stored contract fields", () => {
    expect(contactFromPayload({ mobile: "09876543210", email: "b@example.test" })).toEqual({ phoneKey: "9876543210", email: "b@example.test" });
  });
  it("uses the shared identity keys (phoneKey/emailKey), not its own last-10-digits rule", () => {
    // An international number keeps all its digits under phoneKey; a +91 0-prefixed number and 0091 prefix are Indian.
    expect(contactFromPayload({ normalized: { phone: "+44 7911 123456" } }).phoneKey).toBe("447911123456");
    expect(contactFromPayload({ normalized: { phone: "0091 98765 43210" } }).phoneKey).toBe("9876543210");
    expect(contactFromPayload({ normalized: { phone: "+91 098765 43210" } }).phoneKey).toBe("9876543210");
    expect(contactFromPayload({ normalized: { email: "  A@Example.test " } }).email).toBe("a@example.test");
  });
  it("returns nulls for nothing usable (short number, no email, junk payload)", () => {
    expect(contactFromPayload({ normalized: { phone: "12345" } })).toEqual({ phoneKey: null, email: null });
    expect(contactFromPayload(null)).toEqual({ phoneKey: null, email: null });
    expect(contactFromPayload("x")).toEqual({ phoneKey: null, email: null });
  });
});

describe("planBackfill: a row whose customer was merged away", () => {
  it("links to the survivor (the ledger itself is the evidence; no contact matching)", async () => {
    const d = world({ live: { old: "new" } });
    expect(await planBackfill([row({ clientId: "old" })], d)).toEqual([{ rowId: "r1", action: "link", clientId: "new", basis: "merged_into_survivor" }]);
  });
  it("skips when the customer was erased or is gone, and never matches by contact instead", async () => {
    const d = world({ live: { old: null }, byPhone: { "9876543210": ["x"] } });
    const [out] = await planBackfill([row({ clientId: "old", phoneKey: "9876543210" })], d);
    expect(out).toMatchObject({ action: "skip", reason: "customer_gone" });
  });
  it("skips when the survivor already has a different app user id (it would become two)", async () => {
    const d = world({ live: { old: "new" }, ids: { new: ["sub-other"] } });
    expect((await planBackfill([row({ clientId: "old" })], d))[0]).toMatchObject({ action: "skip", reason: "customer_has_other_app_id" });
  });
  it("a row that already points at a live customer is left alone", async () => {
    const d = world({ live: { c1: "c1" } });
    expect((await planBackfill([row({ clientId: "c1" })], d))[0]).toMatchObject({ action: "skip", reason: "already_linked" });
  });
});

describe("planBackfill: a row that never reached a customer", () => {
  it("links on a unique phone match when the row has only a phone", async () => {
    const d = world({ byPhone: { "9876543210": ["c1"] } });
    expect((await planBackfill([row({ phoneKey: "9876543210" })], d))[0]).toEqual({ rowId: "r1", action: "link", clientId: "c1", basis: "unique_phone" });
  });
  it("links on a unique email match when the row has only an email", async () => {
    const d = world({ byEmail: { "a@example.test": ["c1"] } });
    expect((await planBackfill([row({ email: "a@example.test" })], d))[0]).toMatchObject({ action: "link", clientId: "c1", basis: "unique_email" });
  });
  it("links when phone and email agree on the same single customer", async () => {
    const d = world({ byPhone: { "9876543210": ["c1"] }, byEmail: { "a@example.test": ["c1"] } });
    expect((await planBackfill([row({ phoneKey: "9876543210", email: "a@example.test" })], d))[0]).toMatchObject({ action: "link", basis: "unique_phone_and_email" });
  });
  it("never guesses: phone and email point at different customers", async () => {
    const d = world({ byPhone: { "9876543210": ["c1"] }, byEmail: { "a@example.test": ["c2"] } });
    expect((await planBackfill([row({ phoneKey: "9876543210", email: "a@example.test" })], d))[0]).toMatchObject({ action: "skip", reason: "ambiguous" });
  });
  it("never guesses: the row has both, but only one of them matches anyone", async () => {
    const d = world({ byPhone: { "9876543210": ["c1"] } });
    expect((await planBackfill([row({ phoneKey: "9876543210", email: "a@example.test" })], d))[0]).toMatchObject({ action: "skip", reason: "ambiguous" });
  });
  it("never guesses: two customers share the phone", async () => {
    const d = world({ byPhone: { "9876543210": ["c1", "c2"] } });
    expect((await planBackfill([row({ phoneKey: "9876543210" })], d))[0]).toMatchObject({ action: "skip", reason: "ambiguous" });
  });
  it("skips with no match, and with no usable contact at all", async () => {
    expect((await planBackfill([row({ phoneKey: "9876543210" })], world({})))[0]).toMatchObject({ action: "skip", reason: "no_match" });
    expect((await planBackfill([row()], world({})))[0]).toMatchObject({ action: "skip", reason: "no_contact" });
  });
  it("skips when the matched customer already carries a different app user id", async () => {
    const d = world({ byPhone: { "9876543210": ["c1"] }, ids: { c1: ["sub-other"] } });
    expect((await planBackfill([row({ phoneKey: "9876543210" })], d))[0]).toMatchObject({ action: "skip", reason: "customer_has_other_app_id" });
  });
  it("a customer that already carries this same id is fine", async () => {
    const d = world({ byPhone: { "9876543210": ["c1"] }, ids: { c1: ["sub-1"] } });
    expect((await planBackfill([row({ phoneKey: "9876543210" })], d))[0]).toMatchObject({ action: "link" });
  });
  it("skips an unusable app user id (blank or over-long)", async () => {
    const d = world({ byPhone: { "9876543210": ["c1"] } });
    expect((await planBackfill([row({ externalId: "  ", phoneKey: "9876543210" })], d))[0]).toMatchObject({ action: "skip", reason: "unusable_id" });
    expect((await planBackfill([row({ externalId: "x".repeat(201), phoneKey: "9876543210" })], d))[0]).toMatchObject({ action: "skip", reason: "unusable_id" });
  });
  it("two different app ids competing for one customer: both skipped, neither wins", async () => {
    const d = world({ byPhone: { "9876543210": ["c1"] } });
    const out = await planBackfill([row({ id: "r1", externalId: "sub-1", phoneKey: "9876543210" }), row({ id: "r2", externalId: "sub-2", phoneKey: "9876543210" })], d);
    expect(out.map((o) => [o.rowId, o.action, "reason" in o ? o.reason : null])).toEqual([["r1", "skip", "competing_app_ids"], ["r2", "skip", "competing_app_ids"]]);
  });
  it("the report carries ids only, never a phone, email or app user id", async () => {
    const d = world({ byPhone: { "9876543210": ["c1"] }, byEmail: { "a@example.test": ["c1"] } });
    const text = JSON.stringify(await planBackfill([row({ phoneKey: "9876543210", email: "a@example.test", externalId: "sub-secret" })], d));
    expect(text).not.toContain("9876543210");
    expect(text).not.toContain("example.test");
    expect(text).not.toContain("sub-secret");
  });
});

describe("applyBackfill", () => {
  it("dry run writes nothing", async () => {
    const d = world({ live: { old: "new" } });
    const plan = await planBackfill([row({ clientId: "old" })], d);
    expect(await applyBackfill(plan, [row({ clientId: "old" })], d, { dryRun: true })).toEqual({ linked: 0, skipped: 0, wouldLink: 1 });
    expect(d.linked).toEqual([]);
  });
  it("applies each link once, compare-and-set from the row's current customer; a lost race counts as skipped", async () => {
    const d = world({ live: { old: "new" }, byPhone: { "9876543210": ["c9"] } });
    const rows = [row({ id: "r1", clientId: "old" }), row({ id: "r2", externalId: "sub-2", phoneKey: "9876543210" })];
    d.link = vi.fn(async (rowId: string) => rowId === "r1");
    const plan = await planBackfill(rows, d);
    expect(await applyBackfill(plan, rows, d, { dryRun: false })).toEqual({ linked: 1, skipped: 1, wouldLink: 0 });
    expect(d.link).toHaveBeenNthCalledWith(1, "r1", "old", "new");
    expect(d.link).toHaveBeenNthCalledWith(2, "r2", null, "c9");
  });
  it("is idempotent: once rows point at live customers, a second plan finds nothing to link", async () => {
    const d = world({ live: { new: "new" } });
    const plan = await planBackfill([row({ clientId: "new" })], d);
    expect(plan.filter((p) => p.action === "link")).toEqual([]);
  });
});
