import { describe, expect, it } from "vitest";

import { type FindingDraft, detectFindings } from "./findings";
import {
  type FindingDbPort,
  type FindingRow,
  type StoredFinding,
  getClientQualitySummary,
  qualityAuditEnabled,
  recordFindings,
  summariseFindings,
} from "./finding-store";

const ON = { QUALITY_AUDIT_ENABLED: "1" };
const OFF = {};
const NOW = new Date("2026-10-13T10:00:00Z");
const DAY = 86_400_000;

/** In-memory port: the unique dedupeKey is enforced the way the database does it (second insert of a key is skipped). */
function fakePort(seed: FindingRow[] = []) {
  const rows = new Map<string, FindingRow>(seed.map((r) => [r.dedupeKey, r]));
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
    async openForClient(clientId) {
      return [...rows.values()]
        .filter((r) => r.clientId === clientId)
        .map((r): StoredFinding => ({ category: r.category, severity: r.severity, detectedAt: r.detectedAt }));
    },
  };
  return { port, rows };
}

const draft = (over: Partial<FindingDraft> = {}): FindingDraft => ({
  dedupeKey: "COMMITMENT:c1:MISSED_FOLLOW_UP",
  clientId: "client-1",
  subjectUserId: "rm-1",
  source: "COMMITMENT",
  category: "MISSED_FOLLOW_UP",
  severity: "MEDIUM",
  summary: "Commitment still open and past due by 2 days.",
  evidenceRef: "commitment:c1",
  detectedAt: NOW,
  ...over,
});

describe("the flag", () => {
  it("is on only for exactly \"1\"", () => {
    expect(qualityAuditEnabled(ON)).toBe(true);
    expect(qualityAuditEnabled({ QUALITY_AUDIT_ENABLED: "true" })).toBe(false);
    expect(qualityAuditEnabled(OFF)).toBe(false);
  });
});

describe("recordFindings", () => {
  it("writes nothing while the flag is off", async () => {
    const { port, rows } = fakePort();
    const out = await recordFindings([draft()], port, OFF);
    expect(out).toEqual({ enabled: false, attempted: 0, created: 0 });
    expect(rows.size).toBe(0);
  });

  it("stores each finding once: a second run over the same record and category creates nothing", async () => {
    const { port, rows } = fakePort();
    const first = await recordFindings([draft()], port, ON);
    const second = await recordFindings([draft({ summary: "same record, later run" })], port, ON);
    expect(first).toEqual({ enabled: true, attempted: 1, created: 1 });
    expect(second).toEqual({ enabled: true, attempted: 1, created: 0 });
    expect(rows.size).toBe(1);
    expect(rows.get("COMMITMENT:c1:MISSED_FOLLOW_UP")?.summary).toBe("Commitment still open and past due by 2 days.");
  });

  it("the same record with a different category is a different finding", async () => {
    const { port, rows } = fakePort();
    await recordFindings([draft(), draft({ dedupeKey: "COMMITMENT:c1:COMMITMENT_NOT_COMPLETED", category: "COMMITMENT_NOT_COMPLETED" })], port, ON);
    expect(rows.size).toBe(2);
  });

  it("collapses duplicates inside one batch before writing", async () => {
    const { port } = fakePort();
    const out = await recordFindings([draft(), draft({ summary: "dup" })], port, ON);
    expect(out).toEqual({ enabled: true, attempted: 1, created: 1 });
  });

  it("a full detector run stored twice yields the same rows once", async () => {
    const { port, rows } = fakePort();
    const records = {
      commitments: [
        { id: "c1", clientId: "client-1", ownerId: "rm-1", status: "OPEN" as const, dueAt: new Date(NOW.getTime() - 2 * DAY), keptAt: null, confirmedAt: new Date(NOW.getTime() - 9 * DAY) },
      ],
      complaints: [
        { id: "k1", clientId: "client-1", ownerId: null, severity: "HIGH" as const, status: "OPEN" as const, slaDueAt: new Date(NOW.getTime() - DAY), resolvedAt: null, closedAt: null },
      ],
    };
    await recordFindings(detectFindings(records, NOW), port, ON);
    const again = await recordFindings(detectFindings(records, new Date(NOW.getTime() + DAY)), port, ON);
    expect(again.created).toBe(0);
    expect(rows.size).toBe(2);
  });
});

describe("getClientQualitySummary", () => {
  it("is null while the flag is off", async () => {
    const { port } = fakePort([draft()]);
    expect(await getClientQualitySummary("client-1", port, OFF)).toBeNull();
  });

  it("counts open findings for the client only, by severity and category", async () => {
    const { port } = fakePort([
      draft(),
      draft({ dedupeKey: "COMPLAINT:k1:CUSTOMER_DISSATISFACTION", category: "CUSTOMER_DISSATISFACTION", source: "COMPLAINT", severity: "HIGH", evidenceRef: "complaint:k1", detectedAt: new Date(NOW.getTime() + 1000) }),
      draft({ dedupeKey: "COMMITMENT:other:MISSED_FOLLOW_UP", clientId: "client-2" }),
    ]);
    const s = await getClientQualitySummary("client-1", port, ON);
    expect(s).not.toBeNull();
    expect(s).toMatchObject({ clientId: "client-1", openCount: 2, bySeverity: { LOW: 0, MEDIUM: 1, HIGH: 1 } });
    expect(s?.byCategory.MISSED_FOLLOW_UP).toBe(1);
    expect(s?.byCategory.CUSTOMER_DISSATISFACTION).toBe(1);
    expect(s?.byCategory.POTENTIAL_COMPLIANCE_ISSUE).toBe(0);
    expect(s?.lastDetectedAt?.getTime()).toBe(NOW.getTime() + 1000);
  });

  it("an empty client has zero counts and no last detection", () => {
    expect(summariseFindings("nobody", [])).toEqual({
      clientId: "nobody",
      openCount: 0,
      bySeverity: { LOW: 0, MEDIUM: 0, HIGH: 0 },
      byCategory: {
        INCORRECT_COMMUNICATION: 0,
        POOR_CONVERSATION: 0,
        MISSED_FOLLOW_UP: 0,
        MISSED_OPPORTUNITY: 0,
        CUSTOMER_DISSATISFACTION: 0,
        COMMITMENT_NOT_COMPLETED: 0,
        POTENTIAL_COMPLIANCE_ISSUE: 0,
      },
      lastDetectedAt: null,
    });
  });
});
