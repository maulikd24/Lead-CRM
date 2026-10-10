import { describe, expect, it, vi } from "vitest";
import { APP_SIGNUP_SOURCE, loadAppUserId, resolveAppUserId, type IdentityDb } from "./identity";

const fakeDb = (rows: { externalId: string }[]) => {
  const findMany = vi.fn(async () => rows);
  return { db: { leadIntake: { findMany } } as unknown as IdentityDb, findMany };
};

describe("resolveAppUserId", () => {
  it("uses the app user id and nothing else", () => {
    expect(resolveAppUserId([{ externalId: "sub-123" }])).toEqual({ identity: "sub-123" });
  });
  it("skips, with a reason, a customer that has no app user id", () => {
    expect(resolveAppUserId([])).toEqual({ identity: null, reason: expect.stringMatching(/no app user id/i) });
  });
  it("skips blank ids and over-long ids", () => {
    expect(resolveAppUserId([{ externalId: "   " }])).toMatchObject({ identity: null });
    expect(resolveAppUserId([{ externalId: "x".repeat(201) }])).toMatchObject({ identity: null });
  });
  it("skips, rather than guesses, when one customer has two different app user ids", () => {
    expect(resolveAppUserId([{ externalId: "a" }, { externalId: "b" }])).toEqual({ identity: null, reason: expect.stringMatching(/more than one/i) });
  });
  it("treats repeated rows for the same id as one id", () => {
    expect(resolveAppUserId([{ externalId: "a" }, { externalId: "a " }])).toEqual({ identity: "a" });
  });
});

describe("loadAppUserId", () => {
  it("reads only app-signup intake rows that reached a customer", async () => {
    const { db, findMany } = fakeDb([{ externalId: "sub-1" }]);
    expect(await loadAppUserId(db, "client-1")).toEqual({ identity: "sub-1" });
    expect(findMany).toHaveBeenCalledWith({
      where: { source: APP_SIGNUP_SOURCE, clientId: "client-1", status: { in: ["CREATED", "DUPLICATE"] } },
      select: { externalId: true },
      orderBy: { receivedAt: "asc" },
      take: 5,
    });
  });
  it("the same customer always maps to the same identity, whatever email or mobile it has and however often it is asked", async () => {
    const rows = [{ externalId: "sub-stable" }];
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await loadAppUserId(fakeDb(rows).db, "client-1"));
    expect(new Set(results.map((r) => r.identity))).toEqual(new Set(["sub-stable"]));
  });
  it("two customers with different app user ids never share an identity", async () => {
    const a = await loadAppUserId(fakeDb([{ externalId: "sub-a" }]).db, "c-a");
    const b = await loadAppUserId(fakeDb([{ externalId: "sub-b" }]).db, "c-b");
    expect(a.identity).not.toBe(b.identity);
  });
});
