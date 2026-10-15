/**
 * Real-database check of the idempotency rule: a finding for the same record and category is stored once, however many runs.
 * Skipped unless DATABASE_URL is a local scratch database named wt_*. Run it alone:
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55432/wt_gap_audit_scratch npx vitest run src/lib/audit/finding-store.db.test.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";

import { type FindingDraft } from "./findings";
import { recordFindings, getClientQualitySummary } from "./finding-store";
import { prismaFindingPort } from "./finding-store.prisma";

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.QUALITY_AUDIT_DB_TEST === "1" && url !== "" && local && /\/wt_[a-z0-9_]+$/.test(url);

const RUN = `dbaudit-${Date.now().toString(36)}`;
const ON = { QUALITY_AUDIT_ENABLED: "1" };
const NOW = new Date("2026-10-13T10:00:00Z");

describe.skipIf(!enabled)("audit findings (real database)", { timeout: 90_000 }, () => {
  let db: PrismaClient;
  let clientId: string;

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: `${RUN}-stage`, sequence: Math.floor(Math.random() * 1e9) + 1e9, slaHours: 24 } }));
    const client = await db.client.create({ data: { clientCode: `RG-${RUN}`, name: `${RUN} customer`, currentStageId: stage.id } });
    clientId = client.id;
  });

  afterAll(async () => {
    await db.auditFinding.deleteMany({ where: { dedupeKey: { startsWith: RUN } } });
    await db.client.deleteMany({ where: { id: clientId } });
    await db.$disconnect();
  });

  const drafts = (tag: string): FindingDraft[] => [
    {
      dedupeKey: `${RUN}:${tag}:MISSED_FOLLOW_UP`,
      clientId,
      subjectUserId: null,
      source: "COMMITMENT",
      category: "MISSED_FOLLOW_UP",
      severity: "MEDIUM",
      summary: "Commitment still open and past due by 2 days.",
      evidenceRef: `commitment:${tag}`,
      detectedAt: NOW,
    },
  ];

  it("stores a finding once: the second run creates nothing and the unique key holds", async () => {
    const port = prismaFindingPort(db);
    const first = await recordFindings(drafts("c-once"), port, ON);
    const second = await recordFindings(drafts("c-once"), port, ON);
    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(await db.auditFinding.count({ where: { dedupeKey: `${RUN}:c-once:MISSED_FOLLOW_UP` } })).toBe(1);
  });

  it("the read model counts the stored open finding for the client", async () => {
    const port = prismaFindingPort(db);
    const s = await getClientQualitySummary(clientId, port, ON);
    expect(s?.openCount).toBeGreaterThanOrEqual(1);
    expect(s?.byCategory.MISSED_FOLLOW_UP).toBeGreaterThanOrEqual(1);
  });

  it("writes nothing with the flag off", async () => {
    const port = prismaFindingPort(db);
    const before = await db.auditFinding.count({ where: { dedupeKey: { startsWith: RUN } } });
    const out = await recordFindings(drafts("c-off"), port, {});
    expect(out.enabled).toBe(false);
    expect(await db.auditFinding.count({ where: { dedupeKey: { startsWith: RUN } } })).toBe(before);
  });
});
