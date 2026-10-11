import { describe, expect, it, vi } from "vitest";

import { jobSpec } from "./job-registry";
import { createRecorder, errorClassOf, recordRun, scrubMessage, summarizeResult, type RunRow, type RunStore } from "./job-run";

function fakeStore(opts: { failInsert?: boolean; failCreateMany?: boolean; slow?: boolean } = {}) {
  const rows: RunRow[] = [];
  const calls: string[] = [];
  const store: RunStore = {
    async insert(row) { calls.push("insert"); if (opts.failInsert) throw new Error("connection refused postgresql://u:p@h/db"); rows.push({ ...row }); },
    async update(id, patch) { calls.push("update"); const r = rows.find((x) => x.id === id); if (r) Object.assign(r, patch); },
    async createMany(batch) {
      calls.push("createMany");
      if (opts.slow) await new Promise((r) => setTimeout(r, 50));
      if (opts.failCreateMany) throw new Error("table missing");
      rows.push(...batch.map((b) => ({ ...b })));
    },
  };
  return { store, rows, calls };
}

let clock = 1_000_000;
const now = () => new Date(clock);
let n = 0;
const newId = () => `id${++n}`;
const base = (store: RunStore, extra: Record<string, unknown> = {}) => createRecorder({ store, now, newId, tickId: "tick1", trigger: "cron-job.org", deployRef: "abc1234", env: {}, ...extra });
const spec = (key: string) => jobSpec(key)!;

describe("scrubMessage", () => {
  it("removes URLs, emails, long numbers, connection strings, bearer tokens and key-like strings", () => {
    const raw = "fetch https://api.example.com/x?token=abc failed for a.b@example.com phone 9123456789 using postgresql://u:pw@host:5432/db with Bearer abcdef123456 and sk_live_ABCDEFGH12345678";
    const out = scrubMessage(raw);
    for (const leak of ["api.example.com", "a.b@example.com", "9123456789", "postgresql://", "pw@host", "abcdef123456", "sk_live_ABCDEFGH12345678"]) expect(out, leak).not.toContain(leak);
    expect(out).toContain("[redacted]");
  });
  it("truncates to 300 characters", () => expect(scrubMessage("x".repeat(900)).length).toBeLessThanOrEqual(300));
});

describe("errorClassOf", () => {
  it("uses the constructor name and a code when present", () => {
    class Boom extends Error { code = "P2002"; constructor() { super("Unique constraint failed on the fields: (`email`)"); this.name = "PrismaClientKnownRequestError"; } }
    expect(errorClassOf(new Boom())).toBe("PrismaClientKnownRequestError:P2002");
    expect(errorClassOf(new TypeError("x"))).toBe("TypeError");
  });
  it("never trusts a non-Error throw", () => expect(errorClassOf("secret text")).toBe("NonErrorThrown"));
});

describe("summarizeResult", () => {
  it("keeps numeric and boolean leaves, drops strings, arrays and rows", () => {
    expect(summarizeResult({ processed: 12, ok: true, name: "Asha Rao", rows: [{ a: 1 }], nested: { sent: 3, who: "x" } })).toEqual({ processed: 12, ok: true, "nested.sent": 3 });
  });
  it("caps the stored summary at 2 KB", () => {
    const big = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`key_number_${i}`, i]));
    expect(JSON.stringify(summarizeResult(big)).length).toBeLessThanOrEqual(2048);
  });
  it("returns null for a non-object", () => { expect(summarizeResult(undefined)).toBeNull(); expect(summarizeResult("text")).toBeNull(); });
});

describe("the recorder classifies a run", () => {
  it("records OK with duration and counts, and returns the job's own result untouched", async () => {
    const { store, rows } = fakeStore();
    const rec = base(store);
    const result = await rec.run(spec("checkOverdueTasks"), async () => { clock += 40; return { updated: 4 }; });
    expect(result).toEqual({ updated: 4 });
    await rec.flush();
    expect(rows[0]).toMatchObject({ job: "checkOverdueTasks", kind: "CRON", status: "OK", tickId: "tick1", durationMs: 40, summary: { updated: 4 }, trigger: "cron-job.org", deployRef: "abc1234", attempt: 1 });
  });
  it("maps a returned { skipped } to SKIPPED with the reason", async () => {
    const { store, rows } = fakeStore(); const rec = base(store);
    await rec.run(spec("sendDailyReportEmail"), async () => ({ skipped: "already-sent" as const }));
    await rec.flush();
    expect(rows[0]).toMatchObject({ status: "SKIPPED", skipReason: "already-sent" });
  });
  it("records SKIPPED 'flag off' for a flagged job while its flag is not 1, without changing what runs", async () => {
    const { store, rows } = fakeStore(); const rec = base(store, { env: { META_ADS_SYNC_ENABLED: "0" } });
    const job = vi.fn(async () => ({ synced: 0 }));
    await rec.run(spec("meta-ads-sync"), job);
    await rec.flush();
    expect(job).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ status: "SKIPPED", skipReason: "flag off" });
  });
  it("records OK for a flagged job while its flag is 1", async () => {
    const { store, rows } = fakeStore(); const rec = base(store, { env: { META_ADS_SYNC_ENABLED: "1" } });
    await rec.run(spec("meta-ads-sync"), async () => ({ synced: 5 }));
    await rec.flush();
    expect(rows[0].status).toBe("OK");
  });
  it("a thrown error returns { error } exactly as before, records FAILED with a scrubbed message, and later jobs still run", async () => {
    const { store, rows } = fakeStore(); const rec = base(store);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = await rec.run(spec("checkStageSla"), async () => { throw new Error("boom for a.b@example.com"); });
    const b = await rec.run(spec("checkFundingSla"), async () => ({ ok: 1 }));
    spy.mockRestore();
    expect(a).toEqual({ error: "boom for a.b@example.com" });
    expect(b).toEqual({ ok: 1 });
    await rec.flush();
    expect(rows[0]).toMatchObject({ status: "FAILED", errorClass: "Error" });
    expect(rows[0].errorMessage).not.toContain("a.b@example.com");
    expect(rows[1].status).toBe("OK");
  });
  it("stores only the class for a database error and for a non-Error throw", async () => {
    const { store, rows } = fakeStore(); const rec = base(store);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    class DbErr extends Error { code = "P2021"; constructor() { super("Invalid `prisma.x.create()` invocation: email: 'a@b.co'"); this.name = "PrismaClientKnownRequestError"; } }
    await rec.run(spec("checkStageSla"), async () => { throw new DbErr(); });
    await rec.run(spec("checkFundingSla"), async () => { throw "token=abc"; });
    spy.mockRestore();
    await rec.flush();
    expect(rows[0]).toMatchObject({ errorClass: "PrismaClientKnownRequestError:P2021", errorMessage: null });
    expect(rows[1]).toMatchObject({ errorClass: "NonErrorThrown", errorMessage: null });
  });
  it("treats a returned { error } as a failure and keeps only a short code", async () => {
    const { store, rows } = fakeStore(); const rec = base(store);
    await rec.run(spec("sendDailyReportEmail"), async () => ({ error: "send-failed" as const, detail: "smtp said asha@example.com bounced" }));
    await rec.flush();
    expect(rows[0]).toMatchObject({ status: "FAILED", errorClass: "send-failed", errorMessage: null });
  });
  it("reports a run over 3x its expected time as TIMEOUT but still waits for it and returns its result", async () => {
    const { store, rows } = fakeStore(); const rec = base(store);
    const result = await rec.run(spec("checkWhatsAppAccountHealth"), async () => { clock += 31_000; return { n: 1 }; });
    expect(result).toEqual({ n: 1 });
    await rec.flush();
    expect(rows[0]).toMatchObject({ status: "TIMEOUT", durationMs: 31_000, errorClass: "ExceededBudget" });
  });
});

describe("persistence never breaks the tick", () => {
  it("swallows a failing store, never throws, and marks persistFailed", async () => {
    const { store } = fakeStore({ failInsert: true, failCreateMany: true });
    const rec = base(store);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await rec.startTick();
    const result = await rec.run(spec("checkOverdueTasks"), async () => ({ updated: 1 }));
    await expect(rec.flush()).resolves.toBeUndefined();
    await expect(rec.finishTick()).resolves.toBeUndefined();
    spy.mockRestore();
    expect(result).toEqual({ updated: 1 });
    expect(rec.persistFailed).toBe(true);
  });
  it("gives up on a store that takes longer than its timeout", async () => {
    const { store } = fakeStore({ slow: true });
    const rec = base(store, { storeTimeoutMs: 5 });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await rec.run(spec("checkOverdueTasks"), async () => ({}));
    await rec.flush();
    spy.mockRestore();
    expect(rec.persistFailed).toBe(true);
  });
  it("uses at most 4 store statements for a full 30-job tick", async () => {
    const { store, calls } = fakeStore(); const rec = base(store);
    await rec.startTick();
    for (let i = 0; i < 30; i++) await rec.run(spec("checkOverdueTasks"), async () => ({ n: 1 }));
    await rec.flush();
    await rec.finishTick();
    expect(calls.length).toBeLessThanOrEqual(4);
    expect(calls[0]).toBe("insert");
    expect(calls.at(-1)).toBe("update");
  });
  it("flushes every 15 jobs so a killed function loses a bounded number of rows", async () => {
    const { store, rows } = fakeStore(); const rec = base(store);
    for (let i = 0; i < 16; i++) await rec.run(spec("checkOverdueTasks"), async () => ({}));
    expect(rows.length).toBe(15);
  });
});

describe("the tick envelope", () => {
  it("inserts a RUNNING __tick row whose id is the tick id, then finishes it with counts", async () => {
    const { store, rows } = fakeStore(); const rec = base(store);
    await rec.startTick();
    expect(rows[0]).toMatchObject({ id: "tick1", job: "__tick", status: "RUNNING", kind: "CRON" });
    await rec.run(spec("checkOverdueTasks"), async () => ({}));
    await rec.run(spec("checkStageSla"), async () => { throw new Error("x"); }).catch(() => {});
    clock += 1000;
    await rec.flush();
    await rec.finishTick();
    const tick = rows.find((r) => r.id === "tick1")!;
    expect(tick.status).toBe("OK");
    expect(tick.summary).toMatchObject({ jobs: 2, ok: 1, failed: 1 });
    expect(tick.finishedAt).toBeInstanceOf(Date);
  });
  it("records a skipped tick when the lease is held", async () => {
    const { store, rows } = fakeStore(); const rec = base(store);
    await rec.recordSkippedTick("lease held");
    expect(rows.find((r) => r.job === "__tick")).toMatchObject({ id: "tick1", status: "SKIPPED", skipReason: "lease held" });
  });
});

describe("recordRun (single shot: webhooks, manual runs)", () => {
  it("writes the row straight away", async () => {
    const { store, rows } = fakeStore();
    const out = await recordRun(spec("webhook:app-signup"), { store, now, newId, trigger: "provider" }, async () => ({ accepted: 1 }));
    expect(out).toEqual({ accepted: 1 });
    expect(rows[0]).toMatchObject({ job: "webhook:app-signup", kind: "WEBHOOK", status: "OK" });
  });
  it("carries kind, attempt and retryOfId for a retry", async () => {
    const { store, rows } = fakeStore();
    await recordRun(spec("retryFailedLeads"), { store, now, newId, kind: "RETRY", attempt: 2, retryOfId: "r0", trigger: "admin:u1" }, async () => ({ retried: 0 }));
    expect(rows[0]).toMatchObject({ kind: "RETRY", attempt: 2, retryOfId: "r0", trigger: "admin:u1" });
  });
});
