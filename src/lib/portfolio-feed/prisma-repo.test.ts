import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  clients: [] as { id: string; clientCode: string; pan: string | null; email: string | null }[],
  phones: [] as { id: string; key: string }[],
  where: undefined as unknown,
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    client: { findMany: vi.fn(async (args: { where: unknown }) => ((db.where = args.where), db.clients)) },
    $queryRaw: vi.fn(async () => db.phones),
  },
}));
vi.mock("@/lib/activity/log-user-event", () => ({ logUserEvent: vi.fn() }));

import { lookupCustomers } from "./prisma-repo";

beforeEach(() => {
  db.clients = [];
  db.phones = [];
  db.where = undefined;
});

describe("lookupCustomers", () => {
  it("returns EVERY client id for a shared phone key (no winner-takes-all)", async () => {
    db.phones = [{ id: "c1", key: "9000000001" }, { id: "c2", key: "9000000001" }];
    db.clients = [{ id: "c1", clientCode: "CL-1", pan: null, email: null }];
    const [hits] = await lookupCustomers([{ clientCode: "CL-1", phoneKey: "9000000001" }]);
    expect(hits).toEqual({ clientCode: ["c1"], phoneKey: ["c1", "c2"] });
  });
  it("returns an empty list for an identifier that matches nobody, and omits identifiers not supplied", async () => {
    const [hits] = await lookupCustomers([{ clientCode: "CL-9", pan: "ABCDE1234F" }]);
    expect(hits).toEqual({ clientCode: [], pan: [] });
  });
  it("matches clientCode case-insensitively as normalised, PAN exactly, and email case-insensitively", async () => {
    db.clients = [{ id: "c1", clientCode: "cl-1", pan: "ABCDE1234F", email: "A@Example.com" }];
    const [hits] = await lookupCustomers([{ clientCode: "CL-1", pan: "ABCDE1234F", email: "a@example.com" }]);
    expect(hits).toEqual({ clientCode: ["c1"], pan: ["c1"], email: ["c1"] });
  });
  it("only ever looks at active, unmerged customers and issues no write", async () => {
    await lookupCustomers([{ clientCode: "CL-1" }]);
    expect(db.where).toMatchObject({ isDeleted: false, mergedIntoId: null });
  });
  it("maps hits per identity in order, and does no query when nothing is supplied", async () => {
    db.clients = [{ id: "c1", clientCode: "CL-1", pan: null, email: null }, { id: "c2", clientCode: "CL-2", pan: null, email: null }];
    const res = await lookupCustomers([{ clientCode: "CL-2" }, { clientCode: "CL-1" }]);
    expect(res).toEqual([{ clientCode: ["c2"] }, { clientCode: ["c1"] }]);
  });
});
