import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GatewayResult } from "@/lib/ai/gateway/types";

import type { CallFn, ReviewText } from "./ai-detectors";
import type { CommitmentRecord, ComplaintRecord } from "./findings";
import { type FindingDbPort, type FindingRow, type StoredFinding } from "./finding-store";
import { runQualityAuditJob, type StoredRecords } from "./job";

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
    const markScanned = vi.fn(async () => {});
    const r = await runQualityAuditJob({
      env: ON, now: NOW, port, loadRecords: async () => ({ commitments: [], complaints: [] }), hasKey: true, call,
      loadReviews: async () => ({ markerUserId: "sys", reviews: [review()] }), markScanned,
    });
    expect(call).toHaveBeenCalledTimes(4);
    expect(r).toMatchObject({ ai: { scanned: 1, drafted: 4, created: 4 } });
    expect(markScanned).toHaveBeenCalledWith("sys", ["r1"], NOW);
    expect(rows.has("CALL:r1:MISSED_OPPORTUNITY")).toBe(true);
  });

  it("does not repeat AI findings on a rerun", async () => {
    const { port } = fakePort();
    const call: CallFn = async () => ok({ flagged: true, severity: "LOW", summary: "x" });
    const args = { env: ON, now: NOW, port, loadRecords: async () => ({ commitments: [], complaints: [] }), hasKey: true, call, loadReviews: async () => ({ markerUserId: "sys", reviews: [review()] }), markScanned: async () => {} };
    await runQualityAuditJob(args);
    const second = await runQualityAuditJob(args);
    expect(second).toMatchObject({ ai: { created: 0 } });
  });

  it("a failing deterministic pass does not stop the AI pass", async () => {
    const { port } = fakePort();
    const call: CallFn = async () => ok({ flagged: false, severity: "LOW", summary: "" });
    const r = await runQualityAuditJob({
      env: ON, now: NOW, port, loadRecords: async () => { throw new Error("db down"); }, hasKey: true, call,
      loadReviews: async () => ({ markerUserId: "sys", reviews: [review()] }), markScanned: async () => {},
    });
    expect(r).toMatchObject({ deterministic: { recordsLoaded: 0 }, ai: { scanned: 1 } });
  });
});
