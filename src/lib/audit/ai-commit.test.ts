import { describe, expect, it } from "vitest";

import { commitAiBatch, SCANNED_ACTION, SCHEMA_FAILED_ACTION } from "./ai-commit";
import type { FindingDraft } from "./findings";

const NOW = new Date("2026-10-13T10:00:00Z");
const draft = (key: string): FindingDraft => ({
  dedupeKey: key, clientId: "c1", subjectUserId: "rm1", source: "CALL", category: "POOR_CONVERSATION", severity: "LOW",
  summary: "A customer conversation may have been dismissive or left a question unanswered.", evidenceRef: "review:r1", detectedAt: NOW,
});

/**
 * In-memory database with interactive transactions: a transaction's writes are kept aside and applied only if the callback
 * resolves. A throw discards them, the way a database rolls back.
 */
function fakeDb(opts: { failMarkers?: boolean } = {}) {
  const findings: { dedupeKey: string }[] = [];
  const logs: { action: string; entityId: string; userId: string }[] = [];
  const db = {
    async $transaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      const stagedFindings: { dedupeKey: string }[] = [];
      const stagedLogs: { action: string; entityId: string; userId: string }[] = [];
      const tx = {
        auditFinding: {
          async createMany({ data }: { data: { dedupeKey: string }[] }) {
            let n = 0;
            for (const d of data) {
              if (findings.some((f) => f.dedupeKey === d.dedupeKey) || stagedFindings.some((f) => f.dedupeKey === d.dedupeKey)) continue;
              stagedFindings.push({ dedupeKey: d.dedupeKey });
              n += 1;
            }
            return { count: n };
          },
        },
        auditLog: {
          async createMany({ data }: { data: { action: string; entityId: string; userId: string }[] }) {
            if (opts.failMarkers) throw new Error("connection lost");
            stagedLogs.push(...data.map((d) => ({ action: d.action, entityId: d.entityId, userId: d.userId })));
            return { count: data.length };
          },
        },
      };
      const out = await fn(tx as never);
      findings.push(...stagedFindings);
      logs.push(...stagedLogs);
      return out;
    },
  };
  return { db, findings, logs };
}

describe("commitAiBatch: findings and markers in one transaction", () => {
  it("stores the findings, the scanned markers and the schema-failure rows together", async () => {
    const { db, findings, logs } = fakeDb();
    const created = await commitAiBatch(db, {
      drafts: [draft("CALL:r1:POOR_CONVERSATION")],
      scannedReviewIds: ["r1"],
      schemaFailures: [{ reviewId: "r2", attempt: 1 }],
      markerUserId: "sys",
      now: NOW,
    });
    expect(created).toBe(1);
    expect(findings.map((f) => f.dedupeKey)).toEqual(["CALL:r1:POOR_CONVERSATION"]);
    expect(logs).toEqual([
      { action: SCANNED_ACTION, entityId: "r1", userId: "sys" },
      { action: SCHEMA_FAILED_ACTION, entityId: "r2", userId: "sys" },
    ]);
  });

  it("when a marker write fails, no finding is kept either, so a review is never marked without its findings", async () => {
    const { db, findings, logs } = fakeDb({ failMarkers: true });
    await expect(
      commitAiBatch(db, { drafts: [draft("CALL:r1:POOR_CONVERSATION")], scannedReviewIds: ["r1"], schemaFailures: [], markerUserId: "sys", now: NOW }),
    ).rejects.toThrow("connection lost");
    expect(findings).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });

  it("a rerun of the same batch stores no duplicate findings", async () => {
    const { db, findings } = fakeDb();
    const input = { drafts: [draft("CALL:r1:POOR_CONVERSATION")], scannedReviewIds: [], schemaFailures: [], markerUserId: "sys", now: NOW };
    expect(await commitAiBatch(db, input)).toBe(1);
    expect(await commitAiBatch(db, input)).toBe(0);
    expect(findings).toHaveLength(1);
  });

  it("writes markers only when there are no drafts", async () => {
    const { db, findings, logs } = fakeDb();
    expect(await commitAiBatch(db, { drafts: [], scannedReviewIds: ["r9"], schemaFailures: [], markerUserId: "sys", now: NOW })).toBe(0);
    expect(findings).toHaveLength(0);
    expect(logs).toEqual([{ action: SCANNED_ACTION, entityId: "r9", userId: "sys" }]);
  });
});
