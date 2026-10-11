import { describe, expect, it } from "vitest";

import { CUTOVER_CHECKS, autoResult, cutoverItemId, parseTickInput, setCutoverTick, type TickDb } from "./cutover-checks";
import type { SystemStatus } from "./status";

const good: SystemStatus = {
  generatedAt: "2026-10-12T04:00:00.000Z",
  app: { commit: "abc1234", shortCommit: "abc1234", branch: "main", deployEnv: "production", nodeEnv: "production" },
  database: { connected: true, name: "db", serverVersion: "16", latencyMs: 4 },
  migrations: { applied: 5, failed: [], latest: "x", pending: 0, onDisk: 5 },
  flags: { on: [], off: [], settings: [], check: { errors: 0, warnings: 0, findings: [] } },
  cron: { tick: { state: "ticking", minutesAgo: 2 }, jobs: [] },
  queues: [],
  integrations: [],
  env: [{ name: "CRON_SECRET", present: true, required: true, note: "" }],
  attention: [],
};

describe("the catalogue", () => {
  it("has unique ids, and every check says what to look at", () => {
    const ids = CUTOVER_CHECKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CUTOVER_CHECKS) { expect(c.title.length).toBeGreaterThan(5); expect(c.how.length).toBeGreaterThan(10); }
  });
  it("mixes automatic checks (computed from the status) and ones a person ticks", () => {
    expect(CUTOVER_CHECKS.some((c) => c.auto)).toBe(true);
    expect(CUTOVER_CHECKS.filter((c) => !c.auto).length).toBeGreaterThanOrEqual(6);
  });
  it("keeps internal names, hosts and credentials out of the wording", () => {
    const text = JSON.stringify(CUTOVER_CHECKS.map((c) => [c.title, c.how]));
    expect(text).not.toMatch(/https?:\/\/|@[a-z0-9-]+\.(com|co|in)\b|password|allvest/i);
  });
});

describe("automatic checks", () => {
  const byId = (id: string) => CUTOVER_CHECKS.find((c) => c.id === id)!;
  it("pass on a healthy status", () => {
    for (const c of CUTOVER_CHECKS.filter((x) => x.auto)) expect(autoResult(c, good).ok, c.id).toBe(true);
  });
  it("fail, with a reason, when the database is down, a migration failed, the scheduler is stale or a required variable is missing", () => {
    expect(autoResult(byId("db-connected"), { ...good, database: { ...good.database, connected: false } })).toMatchObject({ ok: false });
    expect(autoResult(byId("migrations-clean"), { ...good, migrations: { ...good.migrations!, failed: ["m1"] } })).toMatchObject({ ok: false });
    expect(autoResult(byId("migrations-clean"), { ...good, migrations: { ...good.migrations!, pending: 2 } })).toMatchObject({ ok: false });
    expect(autoResult(byId("migrations-clean"), { ...good, migrations: null })).toMatchObject({ ok: false });
    expect(autoResult(byId("scheduler-ticking"), { ...good, cron: { ...good.cron, tick: { state: "stale", minutesAgo: 50 } } })).toMatchObject({ ok: false });
    expect(autoResult(byId("required-env"), { ...good, env: [{ name: "CRON_SECRET", present: false, required: true, note: "" }] })).toMatchObject({ ok: false, note: expect.stringContaining("CRON_SECRET") });
  });
  it("an unknown pending count (folder not deployed) is not treated as a failure", () => {
    expect(autoResult(byId("migrations-clean"), { ...good, migrations: { ...good.migrations!, pending: null } }).ok).toBe(true);
  });
});

describe("ticking a manual check", () => {
  function fakeDb() {
    const rows = new Map<string, { done: boolean; note: string | null; doneById: string | null; doneAt: Date | null }>();
    const audit: Record<string, unknown>[] = [];
    const db: TickDb = {
      upsert: async (itemId, v) => { rows.set(itemId, v); },
      audit: async (e) => { audit.push(e); },
    };
    return { db, rows, audit };
  }
  const NOW = new Date("2026-10-12T05:00:00Z");

  it("stores who ticked it and when under a prefixed id that cannot clash with the go-live items", async () => {
    const t = fakeDb();
    const r = await setCutoverTick(t.db, { id: "ad1", role: "ADMIN" }, "login-admin", true, "  all good ", NOW);
    expect(r).toEqual({ ok: true });
    expect(cutoverItemId("login-admin")).toBe("cutover:login-admin");
    expect(t.rows.get("cutover:login-admin")).toEqual({ done: true, note: "all good", doneById: "ad1", doneAt: NOW });
    expect(t.audit[0]).toMatchObject({ userId: "ad1", entity: "CutoverCheck", entityId: "login-admin", action: "cutover_check_ticked" });
  });
  it("unticking clears who and when", async () => {
    const t = fakeDb();
    await setCutoverTick(t.db, { id: "ad1", role: "ADMIN" }, "login-admin", true, null, NOW);
    await setCutoverTick(t.db, { id: "ad1", role: "ADMIN" }, "login-admin", false, null, NOW);
    expect(t.rows.get("cutover:login-admin")).toEqual({ done: false, note: null, doneById: null, doneAt: null });
    expect(t.audit.at(-1)).toMatchObject({ action: "cutover_check_unticked" });
  });
  it("refuses a non-Admin, an unknown check, an automatic check and a long note", async () => {
    const t = fakeDb();
    expect((await setCutoverTick(t.db, { id: "x", role: "RM" }, "login-admin", true, null, NOW)).ok).toBe(false);
    expect((await setCutoverTick(t.db, { id: "ad1", role: "ADMIN" }, "nope", true, null, NOW)).ok).toBe(false);
    expect((await setCutoverTick(t.db, { id: "ad1", role: "ADMIN" }, "db-connected", true, null, NOW)).ok).toBe(false);
    expect((await setCutoverTick(t.db, { id: "ad1", role: "ADMIN" }, "login-admin", true, "x".repeat(400), NOW)).ok).toBe(false);
    expect(t.rows.size).toBe(0);
    expect(t.audit).toEqual([]);
  });
  it("parses the input strictly", () => {
    expect(parseTickInput("login-admin", true, undefined)).toMatchObject({ ok: true });
    expect(parseTickInput("login-admin", "yes", undefined).ok).toBe(false);
    expect(parseTickInput(5, true, undefined).ok).toBe(false);
    expect(parseTickInput("login-admin", true, 7).ok).toBe(false);
  });
});
