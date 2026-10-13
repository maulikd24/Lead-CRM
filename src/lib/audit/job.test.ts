import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GatewayResult } from "@/lib/ai/gateway/types";

import type { CallFn, ReviewText } from "./ai-detectors";
import type { CommitmentRecord, ComplaintRecord } from "./findings";
import { type FindingDbPort, type FindingRow, type StoredFinding } from "./finding-store";
import { loadRecentReviews, runQualityAuditJob, type ReviewLoaderDb, type StoredRecords, WHATSAPP_WINDOW_MS, CALL_WINDOW_MS } from "./job";
import type { AiCommitInput } from "./ai-commit";
import { SCANNED_ACTION, SCHEMA_FAILED_ACTION } from "./ai-commit";
import { SYSTEM_ACTOR_EMAIL } from "../system/system-actor-email";

const NOW = new Date("2026-10-13T10:00:00Z");
const DAY = 86_400_000;
const ON = { QUALITY_AUDIT_ENABLED: "1" };

/** In-memory port: the unique dedupeKey is enforced the way the database does it. */
function fakePort() {
  const rows = new Map<string, FindingRow>();
  const port: FindingDbPort = {
    async insertIfAbsent(input) {
      let created = 0;
      for (const r of input) {
        if (rows.has(r.dedupeKey)) continue;
        rows.set(r.dedupeKey, r);
        created += 1;
      }
      return created;
    },
    async openForClient(): Promise<StoredFinding[]> {
      return [];
    },
  };
  return { port, rows };
}

const records = (): StoredRecords => {
  const commitments: CommitmentRecord[] = [
    { id: "c-late", clientId: "k1", ownerId: "rm1", status: "OPEN", dueAt: new Date(NOW.getTime() - 3 * DAY), keptAt: null, confirmedAt: NOW },
    { id: "c-kept-late", clientId: "k1", ownerId: "rm1", status: "KEPT", dueAt: new Date(NOW.getTime() - DAY), keptAt: NOW, confirmedAt: NOW },
  ];
  const complaints: ComplaintRecord[] = [
    { id: "k-1", clientId: "k2", ownerId: "rm2", severity: "HIGH", status: "OPEN", slaDueAt: new Date(NOW.getTime() - DAY), resolvedAt: null, closedAt: null },
  ];
  return { commitments, complaints };
};

const review = (over: Partial<ReviewText> = {}): ReviewText => ({ id: "r1", clientId: "k1", sourceType: "CALL", assignedRmId: "rm1", transcript: "Customer asked for a callback.", ...over });
/** Stores an AI pass's findings through the same in-memory port, as the transactional commit would. */
const aiCommit = (port: FindingDbPort, seen: AiCommitInput[] = []) => async (input: AiCommitInput) => {
  seen.push(input);
  return port.insertIfAbsent(input.drafts);
};
const PROD_NO_BUDGET = { QUALITY_AUDIT_ENABLED: "1", NODE_ENV: "production" };

/** In-memory review table and audit log. Evaluates only the Prisma operators the loader uses. */
type Row = Record<string, unknown>;
const toTime = (x: unknown) => (x instanceof Date ? x.getTime() : (x as number));
function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [k, cond] of Object.entries(where)) {
    if (k === "OR") { if (!(cond as Row[]).some((w) => matches(row, w))) return false; continue; }
    if (k === "AND") { if (!(cond as Row[]).every((w) => matches(row, w))) return false; continue; }
    const v = row[k];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ("not" in c && (c.not === null ? v === null : v === c.not)) return false;
      if ("gte" in c && !(toTime(v) >= toTime(c.gte))) return false;
      if ("in" in c && !(c.in as unknown[]).includes(v)) return false;
      if ("notIn" in c && (c.notIn as unknown[]).includes(v)) return false;
      continue;
    }
    if (v !== cond) return false;
  }
  return true;
}
function fakeReviewDb(reviews: Row[], logs: Row[] = []): ReviewLoaderDb {
  return {
    user: { async findUnique({ where }) { return where.email === SYSTEM_ACTOR_EMAIL ? { id: "sys" } : null; } },
    auditLog: { async findMany({ where, select }) { return logs.filter((l) => matches(l, where)).map((l) => ({ entityId: l.entityId as string })); } },
    conversationReview: {
      async findMany({ where, orderBy, take, select }) {
        const picked = reviews.filter((r) => matches(r, where)).sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt)).slice(0, take);
        void orderBy;
        return picked.map((r) => Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])) as never);
      },
    },
  };
}
const row = (id: string, createdAt: Date, over: Row = {}): Row => ({ id, clientId: "k1", sourceType: "WHATSAPP_THREAD", assignedRmId: "rm1", status: "ANALYZED", transcript: "text", createdAt, ...over });
const ok = (input: unknown) => ({ kind: "ok", runId: null, correlationId: "x", text: "", toolUses: [{ id: "t", name: "submit_quality_flag", input }], blocks: [], provider: "fake", model: "fake", usage: { inputTokens: 0, outputTokens: 0, costUsdEstimate: 0 } }) as unknown as GatewayResult;

let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
});

describe("runQualityAuditJob", () => {
  it("does nothing while QUALITY_AUDIT_ENABLED is not 1", async () => {
    const { port, rows } = fakePort();
    const loadRecords = vi.fn(async () => records());
    const r = await runQualityAuditJob({ env: {}, now: NOW, port, loadRecords, hasKey: false });
    expect(r).toEqual({ skipped: "flag off" });
    expect(loadRecords).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  });

  it("records the deterministic findings", async () => {
    const { port, rows } = fakePort();
    const r = await runQualityAuditJob({ env: ON, now: NOW, port, loadRecords: async () => records(), hasKey: false });
    expect(r).toMatchObject({ deterministic: { recordsLoaded: 3, created: 3 } });
    expect([...rows.keys()].sort()).toEqual(["COMMITMENT:c-kept-late:COMMITMENT_NOT_COMPLETED", "COMMITMENT:c-late:MISSED_FOLLOW_UP", "COMPLAINT:k-1:CUSTOMER_DISSATISFACTION"]);
  });

  it("is idempotent: a rerun creates no duplicates", async () => {
    const { port, rows } = fakePort();
    const args = { env: ON, now: NOW, port, loadRecords: async () => records(), hasKey: false };
    await runQualityAuditJob(args);
    const second = await runQualityAuditJob(args);
    expect(second).toMatchObject({ deterministic: { created: 0 } });
    expect(rows.size).toBe(3);
  });

  it("logs counts only, never record text", async () => {
    const { port } = fakePort();
    records().complaints[0].severity = "HIGH";
    await runQualityAuditJob({ env: ON, now: NOW, port, loadRecords: async () => records(), hasKey: false });
    const logged = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(logged).toContain("quality_audit_run");
    expect(logged).not.toMatch(/Customer asked|transcript|summary"/);
  });

  it("skips the AI pass without an AI key, makes no call, and reports it as skipped", async () => {
    const { port } = fakePort();
    const call = vi.fn<CallFn>();
    const r = await runQualityAuditJob({ env: ON, now: NOW, port, loadRecords: async () => records(), hasKey: false, call, loadReviews: async () => ({ markerUserId: "sys", reviews: [review()] }) });
    expect(r).toMatchObject({ ai: { skipped: "no_ai_key" } });
    expect(call).not.toHaveBeenCalled();
  });

  it("runs the AI pass with a key, stores its flags, and marks the conversation scanned", async () => {
    const { port, rows } = fakePort();
    const call = vi.fn<CallFn>(async () => ok({ flagged: true, severity: "MEDIUM", summary: "Callback request not acted on." }));
    const seen: AiCommitInput[] = [];
    const r = await runQualityAuditJob({
      env: ON, now: NOW, port, loadRecords: async () => ({ commitments: [], complaints: [] }), hasKey: true, call,
      loadReviews: async () => ({ markerUserId: "sys", reviews: [review()] }), commitAi: aiCommit(port, seen),
    });
    expect(call).toHaveBeenCalledTimes(4);
    expect(r).toMatchObject({ ai: { scanned: 1, drafted: 4, created: 4, schemaFailures: 0 } });
    expect(seen[0]).toMatchObject({ markerUserId: "sys", scannedReviewIds: ["r1"], schemaFailures: [] });
    expect(rows.has("CALL:r1:MISSED_OPPORTUNITY")).toBe(true);
  });

  it("does not repeat AI findings on a rerun", async () => {
    const { port } = fakePort();
    const call: CallFn = async () => ok({ flagged: true, severity: "LOW", summary: "x" });
    const args = { env: ON, now: NOW, port, loadRecords: async () => ({ commitments: [], complaints: [] }), hasKey: true, call, loadReviews: async () => ({ markerUserId: "sys", reviews: [review()] }), commitAi: aiCommit(port) };
    await runQualityAuditJob(args);
    const second = await runQualityAuditJob(args);
    expect(second).toMatchObject({ ai: { created: 0 } });
  });

  it("a failing deterministic pass does not stop the AI pass", async () => {
    const { port } = fakePort();
    const call: CallFn = async () => ok({ flagged: false, severity: "LOW", summary: "" });
    const r = await runQualityAuditJob({
      env: ON, now: NOW, port, loadRecords: async () => { throw new Error("db down"); }, hasKey: true, call,
      loadReviews: async () => ({ markerUserId: "sys", reviews: [review()] }), commitAi: aiCommit(port),
    });
    expect(r).toMatchObject({ deterministic: { recordsLoaded: 0 }, ai: { scanned: 1 } });
  });
});

describe("runQualityAuditJob: production budget", () => {
  it("in production with no budget for audit.flags, skips the AI pass before loading reviews and makes no call", async () => {
    const { port } = fakePort();
    const call = vi.fn<CallFn>();
    const loadReviews = vi.fn(async () => ({ markerUserId: "sys", reviews: [review()] }));
    const r = await runQualityAuditJob({ env: { ...PROD_NO_BUDGET, AI_BUDGET_DEFAULT_USD: "" }, now: NOW, port, loadRecords: async () => records(), hasKey: true, call, loadReviews });
    expect(r).toMatchObject({ ai: { skipped: "no_budget" }, deterministic: { created: 3 } });
    expect(loadReviews).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it("in production with a budget for audit.flags, runs the AI pass", async () => {
    const { port } = fakePort();
    const call = vi.fn<CallFn>(async () => ok({ flagged: false, severity: "LOW" }));
    const r = await runQualityAuditJob({
      env: { ...PROD_NO_BUDGET, AI_PURPOSE_BUDGETS_USD: "audit.flags=2" }, now: NOW, port, loadRecords: async () => ({ commitments: [], complaints: [] }), hasKey: true, call,
      loadReviews: async () => ({ markerUserId: "sys", reviews: [review()] }), commitAi: aiCommit(port),
    });
    expect(call).toHaveBeenCalledTimes(4);
    expect(r).toMatchObject({ ai: { scanned: 1 } });
  });

  it("outside production, no budget is not a skip (the gateway warns instead)", async () => {
    const { port } = fakePort();
    const call = vi.fn<CallFn>(async () => ok({ flagged: false, severity: "LOW" }));
    const r = await runQualityAuditJob({
      env: ON, now: NOW, port, loadRecords: async () => ({ commitments: [], complaints: [] }), hasKey: true, call,
      loadReviews: async () => ({ markerUserId: "sys", reviews: [review()] }), commitAi: aiCommit(port),
    });
    expect(r).toMatchObject({ ai: { scanned: 1 } });
  });
});

describe("loadRecentReviews: which reviews the AI pass reads", () => {
  it("reaches older unscanned reviews even when 60 newer ones are already scanned (no starvation)", async () => {
    const reviews: Row[] = [];
    const logs: Row[] = [];
    for (let i = 0; i < 60; i++) {
      const id = `new-${i}`;
      reviews.push(row(id, new Date(NOW.getTime() - (i + 1) * 60_000)));
      logs.push({ action: SCANNED_ACTION, entity: "ConversationReview", entityId: id, timestamp: new Date(NOW.getTime() - 30 * 60_000) });
    }
    reviews.push(row("old", new Date(NOW.getTime() - 20 * 3_600_000)));
    const w = await loadRecentReviews(NOW, fakeReviewDb(reviews, logs));
    expect(w.reviews.map((r) => r.id)).toEqual(["old"]);
    expect(w.markerUserId).toBe("sys");
  });

  it("a late CALL transcript (created 3 days ago) is read, but a WhatsApp thread that old is not", async () => {
    const threeDays = new Date(NOW.getTime() - 3 * 86_400_000);
    const reviews = [
      row("late-call", threeDays, { sourceType: "CALL", status: "ANALYZING" }),
      row("old-chat", threeDays, { sourceType: "WHATSAPP_THREAD" }),
    ];
    const w = await loadRecentReviews(NOW, fakeReviewDb(reviews));
    expect(w.reviews.map((r) => r.id)).toEqual(["late-call"]);
    expect(threeDays.getTime()).toBeGreaterThanOrEqual(NOW.getTime() - CALL_WINDOW_MS);
    expect(threeDays.getTime()).toBeLessThan(NOW.getTime() - WHATSAPP_WINDOW_MS);
  });

  it("a call created more than a week ago is not read, and a pending call transcript is not read", async () => {
    const reviews = [
      row("too-old-call", new Date(NOW.getTime() - 8 * 86_400_000), { sourceType: "CALL" }),
      row("pending", new Date(NOW.getTime() - 60_000), { sourceType: "CALL", status: "PENDING_TRANSCRIPT", transcript: null }),
    ];
    const w = await loadRecentReviews(NOW, fakeReviewDb(reviews));
    expect(w.reviews).toEqual([]);
  });

  it("carries the number of malformed replies already recorded for each review", async () => {
    const reviews = [row("bad", new Date(NOW.getTime() - 60_000))];
    const logs: Row[] = [
      { action: SCHEMA_FAILED_ACTION, entity: "ConversationReview", entityId: "bad", timestamp: NOW },
      { action: SCHEMA_FAILED_ACTION, entity: "ConversationReview", entityId: "bad", timestamp: NOW },
    ];
    const w = await loadRecentReviews(NOW, fakeReviewDb(reviews, logs));
    expect(w.reviews[0].schemaFailures).toBe(2);
  });
});

