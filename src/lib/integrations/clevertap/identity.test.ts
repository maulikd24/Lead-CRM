import { describe, expect, it, vi } from "vitest";
import { APP_SIGNUP_SOURCE, appIdLinkingEnabled, classifyAppIds, distinctAppUserIds, findClientIdByAppUserId, loadAppUserId, resolveAppUserId, resolveLiveClientId, type IdentityDb } from "./identity";

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

describe("appIdLinkingEnabled", () => {
  it("is off unless the value is exactly 1", () => {
    expect(appIdLinkingEnabled({})).toBe(false);
    expect(appIdLinkingEnabled({ APP_USER_ID_LINKING: "true" })).toBe(false);
    expect(appIdLinkingEnabled({ APP_USER_ID_LINKING: "1" })).toBe(true);
  });
});

describe("findClientIdByAppUserId", () => {
  const dbWith = (row: { clientId: string | null; status: string } | null) => {
    const findUnique = vi.fn(async () => row);
    return { db: { leadIntake: { findUnique } }, findUnique };
  };
  it("looks the id up in the app-signup ledger by its unique key", async () => {
    const { db, findUnique } = dbWith({ clientId: "c1", status: "CREATED" });
    expect(await findClientIdByAppUserId(db, " sub-1 ")).toBe("c1");
    expect(findUnique).toHaveBeenCalledWith({ where: { source_externalId: { source: APP_SIGNUP_SOURCE, externalId: "sub-1" } }, select: { clientId: true, status: true } });
  });
  it("returns null for an unknown id, a row that never reached a customer, and blank or over-long ids (no query)", async () => {
    expect(await findClientIdByAppUserId(dbWith(null).db, "x")).toBeNull();
    expect(await findClientIdByAppUserId(dbWith({ clientId: null, status: "CREATED" }).db, "x")).toBeNull();
    expect(await findClientIdByAppUserId(dbWith({ clientId: "c1", status: "FAILED" }).db, "x")).toBeNull();
    const { db, findUnique } = dbWith({ clientId: "c1", status: "CREATED" });
    expect(await findClientIdByAppUserId(db, "  ")).toBeNull();
    expect(await findClientIdByAppUserId(db, "x".repeat(201))).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe("resolveLiveClientId", () => {
  const dbOf = (rows: Record<string, { mergedIntoId: string | null; isDeleted: boolean }>) => ({
    client: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows[where.id] ?? null) },
  });
  it("returns a live customer as is", async () => {
    expect(await resolveLiveClientId(dbOf({ a: { mergedIntoId: null, isDeleted: false } }), "a")).toBe("a");
  });
  it("follows a merged-away customer to the survivor (also across two merges)", async () => {
    const db = dbOf({ a: { mergedIntoId: "b", isDeleted: false }, b: { mergedIntoId: "c", isDeleted: false }, c: { mergedIntoId: null, isDeleted: false } });
    expect(await resolveLiveClientId(db, "a")).toBe("c");
  });
  it("returns null for a deleted or missing customer and gives up on a merge loop", async () => {
    expect(await resolveLiveClientId(dbOf({ a: { mergedIntoId: null, isDeleted: true } }), "a")).toBeNull();
    expect(await resolveLiveClientId(dbOf({}), "zzz")).toBeNull();
    expect(await resolveLiveClientId(dbOf({ a: { mergedIntoId: "b", isDeleted: false }, b: { mergedIntoId: "a", isDeleted: false } }), "a")).toBeNull();
  });
});

describe("distinctAppUserIds", () => {
  it("trims, drops blank and over-long ids and de-duplicates", () => {
    expect(distinctAppUserIds([{ externalId: " a" }, { externalId: "a" }, { externalId: "" }, { externalId: "x".repeat(201) }, { externalId: "b" }])).toEqual(["a", "b"]);
  });
});

describe("classifyAppIds", () => {
  it("none when neither customer has an app user id", () => expect(classifyAppIds([], [])).toBe("none"));
  it("single when the merged customer would carry exactly one id (one side, or the same id on both)", () => {
    expect(classifyAppIds(["a"], [])).toBe("single");
    expect(classifyAppIds([], ["a"])).toBe("single");
    expect(classifyAppIds(["a"], ["a"])).toBe("single");
  });
  it("conflict when the merged customer would carry two different ids", () => {
    expect(classifyAppIds(["a"], ["b"])).toBe("conflict");
    expect(classifyAppIds(["a", "b"], [])).toBe("conflict");
  });
});
