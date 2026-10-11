/**
 * Real-database checks of the control plane against a freshly migrated scratch Postgres: the latest-per-job query, retention (newest row
 * per job and open alerts survive), the "tables missing" path, alert reconciliation and notifications, and that no row can ever
 * reference a customer. Skipped unless CONTROLPLANE_DB_TEST=1 and DATABASE_URL is local. Run it on its own (it shares the database):
 *   CONTROLPLANE_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<wt_cp_scratch> npx vitest run src/lib/system/job-run.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")), cache: <T,>(fn: T) => fn }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.CONTROLPLANE_DB_TEST === "1" && local && /\/wt_[a-z0-9_]+$/.test(url);

const MIN = 60_000;
const DAY = 86_400_000;

describe.skipIf(!enabled)("control plane (real database)", { timeout: 60_000 }, () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  const now = new Date();
  const ago = (ms: number) => new Date(now.getTime() - ms);
  let adminId = "";

  beforeAll(async () => {
    db = (await import("@/lib/db/prisma")).basePrisma;
    await db.jobRun.deleteMany({});
    await db.controlPlaneAlert.deleteMany({});
    const admin = await db.user.upsert({ where: { email: "cp-db-admin@example.test" }, update: { isActive: true }, create: { email: "cp-db-admin@example.test", name: "CP DB Admin", passwordHash: "x", role: "ADMIN" } });
    adminId = admin.id;
  });
  afterAll(async () => {
    await db.notification.deleteMany({ where: { userId: adminId } });
    await db.user.deleteMany({ where: { id: adminId } });
    await db.jobRun.deleteMany({});
    await db.controlPlaneAlert.deleteMany({});
  });

  it("stores and reads runs through the real store: latest per job with DISTINCT ON, and the per-job stats", async () => {
    const { jobRunStore } = await import("@/lib/system/job-run-db");
    const { createRecorder } = await import("@/lib/system/job-run");
    const { jobSpec } = await import("@/lib/system/job-registry");
    const { latestPerJob, statsPerJob, recentPerJob } = await import("@/lib/system/control-plane-db");
    const rec = createRecorder({ store: jobRunStore, tickId: "dbtick1", trigger: "test", env: {} });
    await rec.startTick();
    await rec.run(jobSpec("checkStageSla")!, async () => ({ updated: 2 }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await rec.run(jobSpec("checkFundingSla")!, async () => { throw new Error("boom"); });
    spy.mockRestore();
    await rec.flush();
    await rec.finishTick();
    const latest = await latestPerJob(now);
    expect(latest.get("checkStageSla")?.status).toBe("OK");
    expect(latest.get("checkFundingSla")).toMatchObject({ status: "FAILED", errorClass: "Error" });
    const stats = await statsPerJob(now);
    expect(stats.get("checkStageSla")).toMatchObject({ ok24: 1, bad24: 0, ok7: 1 });
    const recent = await recentPerJob(["checkFundingSla"]);
    expect(recent.get("checkFundingSla")?.[0].status).toBe("FAILED");
    const tick = await db.jobRun.findUnique({ where: { id: "dbtick1" } });
    expect(tick?.status).toBe("OK");
    expect(tick?.summary).toMatchObject({ jobs: 2, ok: 1, failed: 1 });
  });

  it("retention deletes old rows by tier but always keeps the newest row of every job and every open alert", async () => {
    const { runPruneJobRuns } = await import("@/lib/system/job-retention-db");
    await db.jobRun.deleteMany({});
    const mk = (job: string, status: string, kind: string, age: number, id: string) => ({ id, job, status, kind, startedAt: ago(age), attempt: 1 });
    await db.jobRun.createMany({ data: [
      mk("a", "SKIPPED", "CRON", 5 * DAY, "a-old-skip"), mk("a", "SKIPPED", "CRON", 1 * DAY, "a-new-skip"),
      mk("b", "OK", "CRON", 20 * DAY, "b-old-ok"), mk("b", "OK", "CRON", 15 * DAY, "b-mid-ok"),
      mk("webhook:x", "OK", "WEBHOOK", 9 * DAY, "w-old"), mk("webhook:x", "OK", "WEBHOOK", 8 * DAY, "w-newest-but-old"),
      mk("c", "FAILED", "CRON", 100 * DAY, "c-old-fail"), mk("c", "FAILED", "CRON", 95 * DAY, "c-newer-fail"),
      mk("d", "FAILED", "CRON", 50 * DAY, "d-fail-keep"), mk("e", "RUNNING", "CRON", 40 * DAY, "e-running"),
    ] });
    await db.controlPlaneAlert.createMany({ data: [
      { key: "open", severity: "WARN", title: "open", firstRaisedAt: ago(300 * DAY) },
      { key: "old-resolved", severity: "WARN", title: "r", firstRaisedAt: ago(300 * DAY), resolvedAt: ago(200 * DAY) },
      { key: "new-resolved", severity: "WARN", title: "r2", firstRaisedAt: ago(10 * DAY), resolvedAt: ago(5 * DAY) },
    ] });
    const out = await runPruneJobRuns(now);
    const left = (await db.jobRun.findMany({ select: { id: true } })).map((r) => r.id).sort();
    expect(left).toEqual(["a-new-skip", "b-mid-ok", "c-newer-fail", "d-fail-keep", "e-running", "w-newest-but-old"].sort());
    expect(out.runs).toBe(4);
    const alerts = (await db.controlPlaneAlert.findMany({ select: { key: true } })).map((a) => a.key).sort();
    expect(alerts).toEqual(["new-resolved", "open"]);
  });

  it("a missing JobRun table never breaks a tick: the recorder swallows it and the job result is unchanged", async () => {
    const { jobRunStore } = await import("@/lib/system/job-run-db");
    const { createRecorder } = await import("@/lib/system/job-run");
    const { jobSpec } = await import("@/lib/system/job-registry");
    const { isMissingTable, safeErrorClass } = await import("@/lib/system/control-plane-db");
    await db.$executeRawUnsafe('ALTER TABLE "JobRun" RENAME TO "JobRun_hidden"');
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const rec = createRecorder({ store: jobRunStore, tickId: "t-missing", env: {} });
      await rec.startTick();
      const result = await rec.run(jobSpec("checkStageSla")!, async () => ({ ok: 1 }));
      await rec.flush();
      await rec.finishTick();
      expect(result).toEqual({ ok: 1 });
      expect(rec.persistFailed).toBe(true);
      let caught: unknown;
      try { await db.jobRun.findMany({ take: 1 }); } catch (e) { caught = e; }
      expect(isMissingTable(caught)).toBe(true);
      expect(safeErrorClass(caught)).toBe("TablesMissing");
    } finally {
      spy.mockRestore();
      await db.$executeRawUnsafe('ALTER TABLE "JobRun_hidden" RENAME TO "JobRun"');
    }
  });

  it("raises one open alert per key, notifies each ADMIN once, honours acknowledge, and resolves when the condition clears", async () => {
    const { runAlertEvaluation, acknowledgeAlert } = await import("@/lib/system/alerts-db");
    await db.jobRun.deleteMany({});
    await db.controlPlaneAlert.deleteMany({});
    await db.notification.deleteMany({ where: { userId: adminId } });
    await db.systemHeartbeat.upsert({ where: { key: "cron_tick" }, update: { lastAt: ago(40 * MIN) }, create: { key: "cron_tick", lastAt: ago(40 * MIN) } });

    const first = await runAlertEvaluation(now, {});
    expect(first.raised).toBeGreaterThanOrEqual(1);
    const second = await runAlertEvaluation(now, {});
    expect(second.raised).toBe(0);
    const open = await db.controlPlaneAlert.findMany({ where: { resolvedAt: null, key: "heartbeat-stale" } });
    expect(open).toHaveLength(1);
    expect(open[0].severity).toBe("CRITICAL");
    const notes = await db.notification.findMany({ where: { userId: adminId, type: "control_plane_alert" } });
    expect(notes.filter((n) => (n.payload as { key: string }).key === "heartbeat-stale")).toHaveLength(1);
    expect(JSON.stringify(notes.map((n) => n.payload))).not.toMatch(/@|postgres/);

    expect(await acknowledgeAlert(open[0].id, adminId, now)).toBe(true);
    expect(await acknowledgeAlert(open[0].id, adminId, now)).toBe(false);
    await runAlertEvaluation(new Date(now.getTime() + 30 * 3_600_000), {});
    expect((await db.notification.findMany({ where: { userId: adminId, type: "control_plane_alert" } })).filter((n) => (n.payload as { key: string }).key === "heartbeat-stale")).toHaveLength(1);

    await db.systemHeartbeat.update({ where: { key: "cron_tick" }, data: { lastAt: new Date() } });
    await runAlertEvaluation(new Date(), {});
    expect(await db.controlPlaneAlert.count({ where: { key: "heartbeat-stale", resolvedAt: null } })).toBe(0);
  });

  it("carries no reference to a customer: no foreign key on either table, and erasing a client leaves every row untouched", async () => {
    const fks = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM information_schema.table_constraints WHERE constraint_type = 'FOREIGN KEY' AND table_name IN ('JobRun','ControlPlaneAlert')`;
    expect(fks[0].n).toBe(0);
    const cols = await db.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name IN ('JobRun','ControlPlaneAlert') AND column_name ILIKE ANY (ARRAY['%client%','%customer%','%phone%','%email%'])`;
    expect(cols).toEqual([]);
    await db.jobRun.create({ data: { job: "keep-me", kind: "CRON", status: "OK" } });
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "S", sequence: 1 } as never }));
    const c = await db.client.create({ data: { clientCode: "CP-ERASE-1", name: "Synthetic Erasure", mobile: "9000000001", currentStageId: stage.id } });
    const before = await db.jobRun.count();
    await db.client.delete({ where: { id: c.id } });
    expect(await db.jobRun.count()).toBe(before);
  });

  it("builds the Failures list from the real tables: failed jobs grouped, failed lead intakes with a retry, no error text selected", async () => {
    const { loadFailureItems } = await import("@/lib/system/failures-sources");
    const { groupFailures } = await import("@/lib/system/failures");
    await db.jobRun.deleteMany({});
    await db.leadIntake.deleteMany({ where: { externalId: { startsWith: "cp-db-" } } });
    await db.jobRun.createMany({ data: [
      { id: "f1", job: "meta-ads-sync", kind: "CRON", status: "FAILED", errorClass: "Http429", startedAt: ago(60 * MIN), attempt: 1 },
      { id: "f2", job: "meta-ads-sync", kind: "CRON", status: "FAILED", errorClass: "Http429", startedAt: ago(30 * MIN), attempt: 1 },
      { id: "f3", job: "webhook:meta-leads", kind: "WEBHOOK", status: "FAILED", errorClass: "Http500", startedAt: ago(10 * MIN), attempt: 1 },
      { id: "f4", job: "agent-nudger", kind: "CRON", status: "FAILED", errorClass: "Error", startedAt: ago(5 * MIN), attempt: 1 },
    ] });
    await db.leadIntake.create({ data: { source: "web", externalId: "cp-db-1", status: "ERROR", rawPayload: { normalized: {} }, error: "SECRET-ERROR-TEXT", attempts: 1, receivedAt: ago(20 * MIN) } });
    const groups = groupFailures(await loadFailureItems(now));
    const meta = groups.find((g) => g.group === "meta-ads-sync")!;
    expect(meta).toMatchObject({ count: 2, errorClass: "Http429", stillFailing: true, dataRisk: "none" });
    expect(meta.retry).toEqual({ kind: "job", targetIds: ["f2"] });
    expect(groups.find((g) => g.group === "webhook:meta-leads")).toMatchObject({ source: "webhook", retry: null, dataRisk: "at-risk" });
    expect(groups.find((g) => g.group === "agent-nudger")?.retry).toBeNull();
    const lead = groups.find((g) => g.source === "lead-intake")!;
    expect(lead.retry?.kind).toBe("lead-intake");
    expect(JSON.stringify(groups)).not.toContain("SECRET-ERROR-TEXT");
    await db.leadIntake.deleteMany({ where: { externalId: { startsWith: "cp-db-" } } });
  });

  it("retrying one failed lead twice (and at once) creates exactly one customer", async () => {
    const { retryLeadIntake } = await import("@/lib/leads/retry");
    await (await import("@/lib/system/system-actor")).seedSystemActor();
    const phone = `9${String(Date.now()).slice(-9)}`; // unique per run: a client cannot be deleted once it has history
    const input = { source: "web", externalId: "cp-db-retry-1", leadSource: "Contact Form", name: "Retry Once", phone };
    await db.leadIntake.deleteMany({ where: { externalId: "cp-db-retry-1" } });
    const row = await db.leadIntake.create({ data: { source: "web", externalId: "cp-db-retry-1", status: "ERROR", rawPayload: { normalized: input }, error: "x", attempts: 1, receivedAt: ago(60 * MIN) } });
    const results = await Promise.all([retryLeadIntake(row.id), retryLeadIntake(row.id)]);
    const again = await retryLeadIntake(row.id);
    expect(results.map((r) => r.outcome)).toContain("recovered");
    expect(again.outcome).toBe("not-failed");
    expect(await db.client.count({ where: { mobile: { contains: phone } } })).toBe(1);
    const final = await db.leadIntake.findUnique({ where: { id: row.id } });
    expect(final?.status).toBe("CREATED");
    await db.leadIntake.deleteMany({ where: { externalId: "cp-db-retry-1" } });
  });
});
