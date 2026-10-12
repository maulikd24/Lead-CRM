import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ config: null as { mapping: unknown } | null, runCount: 0, where: undefined as unknown, created: undefined as unknown }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    backOfficeImportConfig: {
      findUnique: vi.fn(async () => db.config),
      upsert: vi.fn(async (a: { create: { mapping: unknown } }) => ((db.config = { mapping: a.create.mapping }), db.config)),
    },
    backOfficeImportRun: {
      count: vi.fn(async (a: { where: unknown }) => ((db.where = a.where), db.runCount)),
      create: vi.fn(async (a: { data: unknown }) => ((db.created = a.data), { id: "r1", seq: 4 })),
      update: vi.fn(async () => ({})),
    },
  },
}));
vi.mock("@/lib/activity/log-user-event", () => ({ logUserEvent: vi.fn() }));
vi.mock("@/lib/portfolio-feed/prisma-repo", () => ({ lookupCustomers: vi.fn(), prismaFeedRepo: {} }));

import { DEFAULT_MAPPING } from "./mapping";
import { loadMapping, prismaRunsRepo, saveMapping } from "./prisma-deps";

beforeEach(() => {
  db.config = null;
  db.runCount = 0;
});

describe("mapping store", () => {
  it("falls back to the documented default when nothing is stored or the stored value is invalid", async () => {
    expect(await loadMapping()).toEqual(DEFAULT_MAPPING);
    db.config = { mapping: { nonsense: true } };
    expect(await loadMapping()).toEqual(DEFAULT_MAPPING);
  });
  it("refuses to save an invalid mapping and stores a valid one", async () => {
    expect(await saveMapping({ nope: 1 }, "u1")).toMatchObject({ ok: false });
    expect(db.config).toBeNull();
    const custom = { ...DEFAULT_MAPPING, dateFormat: "dmy" as const };
    expect(await saveMapping(custom, "u1")).toEqual({ ok: true });
    expect(await loadMapping()).toEqual(custom);
  });
});

describe("runs repo", () => {
  it("only completed real runs count as imported", async () => {
    db.runCount = 1;
    expect(await prismaRunsRepo.hasCompleted("abc", "HOLDINGS")).toBe(true);
    expect(db.where).toMatchObject({ checksum: "abc", kind: "HOLDINGS", dryRun: false, status: { in: ["SUCCESS", "PARTIAL"] } });
  });
  it("a running run only blocks for a short window, so a crashed run cannot block forever", async () => {
    await prismaRunsRepo.hasRunning("abc", "HOLDINGS");
    expect(db.where).toMatchObject({ status: "RUNNING", dryRun: false, startedAt: { gte: expect.any(Date) } });
  });
  it("start returns id and seq", async () => {
    expect(await prismaRunsRepo.start({ kind: "CLIENTS", fileName: "clients.csv", checksum: "x", dryRun: false, trigger: "CRON", userId: null })).toEqual({ id: "r1", seq: 4 });
  });
});
