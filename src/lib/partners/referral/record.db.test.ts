/**
 * Real-database test for referral-code attribution. Skipped unless PARTNER_NATIVE_DB_TEST=1 and the database is local.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFixture, dbTestEnabled } from "../native/db-fixture";
import { recordReferralTouch } from "./record";

describe.skipIf(!dbTestEnabled)("referral touch against a real database", () => {
  let f: Awaited<ReturnType<typeof createFixture>>;
  const NOW = new Date("2026-10-10T06:00:00Z");
  const DAY = 86400000;
  const rec = (client: string, raw: unknown, over: Record<string, unknown> = {}) => recordReferralTouch(f.db as never, { clientId: f.C[client], rawCode: raw, source: "web", now: NOW, lapseDays: 90, ...over });
  const touch = (client: string) => f.db.partnerReferralTouch.findUnique({ where: { clientId: f.C[client] } });
  const events = (client: string) => f.db.partnerAttributionEvent.findMany({ where: { clientId: f.C[client] }, orderBy: { createdAt: "asc" } });

  beforeAll(async () => {
    f = await createFixture("pfxr");
    await f.cleanup();
    f = await createFixture("pfxr");
    for (const k of ["c1", "c2", "c3", "c4", "c5", "c6", "c7"]) await f.mkClient(k);
    await f.db.partnerProfile.update({ where: { id: f.P.c }, data: { empanelmentStatus: "SUSPENDED" } });
  });
  afterAll(async () => {
    if (dbTestEnabled) await f.cleanup();
  });

  it("a malformed code is ignored, recorded as such without storing the text, and creates no touch", async () => {
    const r = await rec("c1", "PTR 1; DROP TABLE x");
    expect(r.decision).toBe("ignored_malformed");
    expect(await touch("c1")).toBeNull();
    const ev = await events("c1");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ decision: "ignored_malformed", code: null, source: "web" });
  });

  it("an unknown code is ignored and audited", async () => {
    expect((await rec("c1", "NOSUCH-CODE")).decision).toBe("ignored_unknown");
    expect(await touch("c1")).toBeNull();
    expect((await events("c1")).at(-1)).toMatchObject({ decision: "ignored_unknown", code: "NOSUCH-CODE" });
  });

  it("a partner who is not active earns no touch", async () => {
    expect((await rec("c1", "pfxr-c")).decision).toBe("ignored_inactive");
    expect(await touch("c1")).toBeNull();
  });

  it("a valid code, in any case, records the first touch with the configured window", async () => {
    const r = await rec("c2", "pfxr-b");
    expect(r.decision).toBe("recorded");
    const t = (await touch("c2"))!;
    expect(t).toMatchObject({ partnerProfileId: f.P.b, code: "PFXR-B", source: "web" });
    expect(t.touchedAt.getTime()).toBe(NOW.getTime());
    expect(t.expiresAt.getTime()).toBe(NOW.getTime() + 90 * DAY);
    expect((await events("c2")).map((e) => e.decision)).toEqual(["recorded"]);
  });

  it("the same code again is idempotent: no change, no new audit row", async () => {
    expect((await rec("c2", "PFXR-B", { now: new Date(NOW.getTime() + DAY) })).decision).toBe("kept_first_same");
    const t = (await touch("c2"))!;
    expect(t.expiresAt.getTime()).toBe(NOW.getTime() + 90 * DAY);
    expect(await events("c2")).toHaveLength(1);
  });

  it("another partner's code later does not take over: first touch wins, and the attempt is audited", async () => {
    expect((await rec("c2", "PFXR-E", { now: new Date(NOW.getTime() + 2 * DAY) })).decision).toBe("kept_first_other");
    expect((await touch("c2"))!.partnerProfileId).toBe(f.P.b);
    expect((await events("c2")).map((e) => e.decision)).toEqual(["recorded", "kept_first_other"]);
  });

  it("after the window lapses a new touch replaces the old one", async () => {
    const later = new Date(NOW.getTime() + 91 * DAY);
    expect((await rec("c2", "PFXR-E", { now: later })).decision).toBe("replaced_lapsed");
    const t = (await touch("c2"))!;
    expect(t).toMatchObject({ partnerProfileId: f.P.e });
    expect(t.expiresAt.getTime()).toBe(later.getTime() + 90 * DAY);
  });

  it("the app source is recorded as such", async () => {
    await rec("c3", "PFXR-A", { source: "app" });
    expect((await touch("c3"))!.source).toBe("app");
  });

  it("two simultaneous touches for a new person leave exactly one row and do not throw", async () => {
    const [x, y] = await Promise.all([rec("c4", "PFXR-A"), rec("c4", "PFXR-B")]);
    expect([x.decision, y.decision].sort()).toEqual(["kept_first_other", "recorded"]);
    expect(await f.db.partnerReferralTouch.count({ where: { clientId: f.C.c4 } })).toBe(1);
  });

  it("no code at all does nothing, not even an audit row", async () => {
    expect((await rec("c5", undefined)).decision).toBe("none");
    expect(await touch("c5")).toBeNull();
    expect(await events("c5")).toHaveLength(0);
  });
});
