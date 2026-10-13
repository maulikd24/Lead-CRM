import { describe, expect, it } from "vitest";

import { type AutoResolveTx, autoResolveMissedFollowUp, missedFollowUpKey, SYSTEM_NOTE } from "./auto-resolve";
import type { FindingDbStatus } from "./finding-actions";

const NOW = new Date("2026-10-13T10:00:00Z");

/** In-memory findings and audit rows. The status guard works the way the database's updateMany does. */
function fakeTx(seed: { id: string; dedupeKey: string; status: FindingDbStatus }[]) {
  const rows = seed.map((r) => ({ ...r, resolvedAt: null as Date | null, resolvedById: null as string | null }));
  const logs: { userId: string; action: string; reason: string; entityId: string }[] = [];
  const tx: AutoResolveTx = {
    auditFinding: {
      async findFirst({ where }) {
        const r = rows.find((x) => x.dedupeKey === where.dedupeKey && where.status.in.includes(x.status));
        return r ? { id: r.id, status: r.status } : null;
      },
      async updateMany({ where, data }) {
        const r = rows.find((x) => x.id === where.id && where.status.in.includes(x.status));
        if (!r) return { count: 0 };
        r.status = data.status;
        r.resolvedAt = data.resolvedAt;
        r.resolvedById = data.resolvedById;
        return { count: 1 };
      },
    },
    auditLog: {
      async create({ data }) {
        logs.push({ userId: data.userId, action: data.action, reason: data.reason, entityId: data.entityId });
        return {};
      },
    },
  };
  return { tx, rows, logs };
}

describe("auto-resolve of a missed follow-up when the commitment is kept", () => {
  it("resolves an OPEN missed-follow-up finding, sets resolvedAt, and writes a system note to the audit log", async () => {
    const { tx, rows, logs } = fakeTx([{ id: "f1", dedupeKey: missedFollowUpKey("c1"), status: "OPEN" }]);
    const r = await autoResolveMissedFollowUp(tx, { commitmentId: "c1", actorId: "rm1", now: NOW });
    expect(r).toBe("resolved");
    expect(rows[0]).toMatchObject({ status: "RESOLVED", resolvedAt: NOW, resolvedById: null });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ userId: "rm1", action: "audit_finding.auto_resolved", entityId: "f1", reason: SYSTEM_NOTE });
  });

  it("also resolves an ACKNOWLEDGED finding", async () => {
    const { tx, rows } = fakeTx([{ id: "f1", dedupeKey: missedFollowUpKey("c1"), status: "ACKNOWLEDGED" }]);
    expect(await autoResolveMissedFollowUp(tx, { commitmentId: "c1", actorId: "rm1", now: NOW })).toBe("resolved");
    expect(rows[0].status).toBe("RESOLVED");
  });

  it("leaves a finding a person already dismissed or resolved untouched, and writes nothing", async () => {
    const { tx, rows, logs } = fakeTx([{ id: "f1", dedupeKey: missedFollowUpKey("c1"), status: "DISMISSED" }]);
    expect(await autoResolveMissedFollowUp(tx, { commitmentId: "c1", actorId: "rm1", now: NOW })).toBe("none");
    expect(rows[0]).toMatchObject({ status: "DISMISSED", resolvedAt: null });
    expect(logs).toHaveLength(0);
  });

  it("does nothing when the commitment has no missed-follow-up finding", async () => {
    const { tx, logs } = fakeTx([{ id: "f2", dedupeKey: "COMMITMENT:c9:COMMITMENT_NOT_COMPLETED", status: "OPEN" }]);
    expect(await autoResolveMissedFollowUp(tx, { commitmentId: "c1", actorId: "rm1", now: NOW })).toBe("none");
    expect(logs).toHaveLength(0);
  });

  it("does not resolve a different commitment's finding", async () => {
    const { tx, rows } = fakeTx([{ id: "f1", dedupeKey: missedFollowUpKey("c2"), status: "OPEN" }]);
    await autoResolveMissedFollowUp(tx, { commitmentId: "c1", actorId: "rm1", now: NOW });
    expect(rows[0].status).toBe("OPEN");
  });
});
