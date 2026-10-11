import { Prisma } from "@/generated/prisma/client";
import { basePrisma as db } from "@/lib/db/prisma";
import { eventDef, registeredTypes } from "@/lib/events/registry";
import { ERASED_NAME } from "@/lib/privacy/merged-duplicates";
import { RELATIONSHIPS } from "@/lib/relationships/registry";

import { CHECKS, lifecycleViolations, type CheckKey, type Finding } from "./model";

/**
 * The data-health queries. Every check is bounded (at most LIMIT findings, one query or two), read-only, and reports a customer by id and customer
 * code only. A check that fails is skipped (and its open items are left alone), never reported as "all clear".
 */
const LIMIT = 500;
const DAY = 86_400_000;
const LIVE = { isDeleted: false, mergedIntoId: null } as const;

export type CheckResult = { total: number; findings: Finding[] };
type Run = (now: Date) => Promise<CheckResult>;

const client = (checkKey: CheckKey, c: { id: string; clientCode: string }, detail: Finding["detail"] = {}): Finding => ({
  checkKey, subjectType: "client", subjectId: c.id, clientId: c.id, severity: CHECKS[checkKey].severity, title: CHECKS[checkKey].title, detail: { code: c.clientCode, ...detail },
});
const system = (checkKey: CheckKey, subjectId: string, detail: Finding["detail"]): Finding => ({ checkKey, subjectType: "system", subjectId, severity: CHECKS[checkKey].severity, title: CHECKS[checkKey].title, detail });

const noIdentityKeys: Run = async () => {
  const where = { ...LIVE, status: { not: "NOT_PROCEEDING" as const }, OR: [{ mobileKey: null }, { mobileKey: "" }], AND: [{ OR: [{ emailKey: null }, { emailKey: "" }] }] };
  const [total, rows] = await Promise.all([db.client.count({ where }), db.client.findMany({ where, select: { id: true, clientCode: true }, orderBy: { createdAt: "desc" }, take: LIMIT })]);
  return { total, findings: rows.map((c) => client("no_identity_keys", c)) };
};

const unassignedLeads: Run = async (now) => {
  const where = { ...LIVE, status: "ACTIVE" as const, assignedToId: null, createdAt: { lt: new Date(now.getTime() - DAY) } };
  const [total, rows] = await Promise.all([db.client.count({ where }), db.client.findMany({ where, select: { id: true, clientCode: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: LIMIT })]);
  return { total, findings: rows.map((c) => client("unassigned_lead", c, { waitingDays: Math.floor((now.getTime() - c.createdAt.getTime()) / DAY) })) };
};

/** Freshness policy: intelligence older than 7 days is stale (data_stale), never presented as current. */
const STALE_AFTER_DAYS = 7;
const staleIntelligence: Run = async (now) => {
  const where = { computedAt: { lt: new Date(now.getTime() - STALE_AFTER_DAYS * DAY) }, client: { ...LIVE, status: "ACTIVE" as const } };
  const [total, rows] = await Promise.all([db.customerIntelligence.count({ where }), db.customerIntelligence.findMany({ where, select: { clientId: true, computedAt: true, client: { select: { clientCode: true } } }, orderBy: { computedAt: "asc" }, take: LIMIT })]);
  return { total, findings: rows.map((r) => client("stale_intelligence", { id: r.clientId, clientCode: r.client.clientCode }, { staleDays: Math.floor((now.getTime() - r.computedAt.getTime()) / DAY), policyDays: STALE_AFTER_DAYS })) };
};

const impossibleLifecycle: Run = async () => {
  const findings: Finding[] = [];
  const funded = await db.fundingRecord.findMany({
    where: { status: { in: ["FULLY_FUNDED", "PARTIALLY_FUNDED"] }, client: { ...LIVE, OR: [{ kycRecord: null }, { kycRecord: { status: { not: "APPROVED" } } }] } },
    select: { status: true, client: { select: { id: true, clientCode: true, status: true, completedAt: true, kycRecord: { select: { status: true } } } } }, take: LIMIT,
  });
  for (const f of funded) for (const code of lifecycleViolations({ status: f.client.status, completedAt: f.client.completedAt, kycStatus: f.client.kycRecord?.status ?? null, fundingStatus: f.status, mergedIntoId: null, mergeTargetState: "none" })) if (code === "funded_without_kyc") findings.push(client("impossible_lifecycle", f.client, { code: "funded_without_kyc" }));
  const completion = await db.client.findMany({
    where: { ...LIVE, OR: [{ status: "COMPLETED", completedAt: null }, { status: { not: "COMPLETED" }, completedAt: { not: null } }] },
    select: { id: true, clientCode: true }, take: LIMIT,
  });
  for (const c of completion) findings.push(client("impossible_lifecycle", c, { code: "status_completed_mismatch" }));
  const orphans = await db.$queryRaw<{ id: string; clientCode: string }[]>`SELECT c."id", c."clientCode" FROM "Client" c WHERE c."mergedIntoId" IS NOT NULL AND c."name" <> ${ERASED_NAME} AND NOT EXISTS (SELECT 1 FROM "Client" t WHERE t."id" = c."mergedIntoId") LIMIT ${LIMIT}`;
  for (const c of orphans) findings.push(client("impossible_lifecycle", c, { code: "merge_target_invalid" }));
  return { total: findings.length, findings: findings.slice(0, LIMIT) };
};

type Row = { name: string; model: string };
/** Tables the registry says a merge re-points (unconditionally) and tables it says stay behind. */
const mergeTables = (kind: "reparent" | "stay"): Row[] => RELATIONSHIPS.filter((r) => r.merge.kind === kind && r.kind === "direct_fk" && r.paths.length === 1 && r.paths[0].via.length === 0 && r.paths[0].column === "clientId").map((r) => ({ name: r.model, model: r.model }));
const onMergedAway = async (table: string) => {
  // Table names come from the registry (trusted constants), never from input.
  const rows = await db.$queryRawUnsafe<{ rows: bigint; clients: bigint }[]>(`SELECT count(*) AS rows, count(DISTINCT t."clientId") AS clients FROM "${table}" t JOIN "Client" c ON c."id" = t."clientId" WHERE c."mergedIntoId" IS NOT NULL AND c."name" <> '${ERASED_NAME}'`);
  return { rows: Number(rows[0]?.rows ?? 0), clients: Number(rows[0]?.clients ?? 0) };
};
const rowsOnMerged: Run = async () => {
  const findings: Finding[] = [];
  for (const t of mergeTables("reparent")) { const c = await onMergedAway(t.name); if (c.rows > 0) findings.push(system("rows_on_merged_client", t.name, { table: t.name, rows: c.rows, customers: c.clients })); }
  return { total: findings.length, findings };
};
const leftOnArchived: Run = async () => {
  const findings: Finding[] = [];
  for (const t of mergeTables("stay")) { const c = await onMergedAway(t.name); if (c.rows > 0) findings.push(system("left_on_archived_duplicate", t.name, { table: t.name, rows: c.rows, customers: c.clients })); }
  return { total: findings.length, findings };
};

const duplicateKeys: Run = async () => {
  const rows = await db.$queryRaw<{ id: string; clientCode: string; kind: string; size: bigint }[]>`
    SELECT c."id", c."clientCode", 'mobile' AS kind, g.n AS size FROM "Client" c JOIN (SELECT "mobileKey", count(*) AS n FROM "Client" WHERE "isDeleted" = false AND "mergedIntoId" IS NULL AND "mobileKey" IS NOT NULL AND "mobileKey" <> '' GROUP BY "mobileKey" HAVING count(*) > 1) g ON g."mobileKey" = c."mobileKey" WHERE c."isDeleted" = false AND c."mergedIntoId" IS NULL
    UNION ALL
    SELECT c."id", c."clientCode", 'email' AS kind, g.n AS size FROM "Client" c JOIN (SELECT "emailKey", count(*) AS n FROM "Client" WHERE "isDeleted" = false AND "mergedIntoId" IS NULL AND "emailKey" IS NOT NULL AND "emailKey" <> '' GROUP BY "emailKey" HAVING count(*) > 1) g ON g."emailKey" = c."emailKey" WHERE c."isDeleted" = false AND c."mergedIntoId" IS NULL
    LIMIT ${LIMIT}`;
  const seen = new Set<string>();
  const findings = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true))).map((r) => client("duplicate_identity_key", r, { sharedKey: r.kind, group: Number(r.size) }));
  return { total: findings.length, findings };
};

const orphanedEvents: Run = async () => {
  const rows = await db.$queryRaw<{ id: string; eventType: string }[]>`
    SELECT e."id", e."eventType" FROM "CustomerEvent" e
    WHERE e."clientId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "Client" c WHERE c."id" = e."clientId")
      AND NOT EXISTS (SELECT 1 FROM "CustomerEvent" x WHERE x."clientId" = e."clientId" AND x."eventType" = 'customer.erased')
    LIMIT ${LIMIT}`;
  return { total: rows.length, findings: rows.map((r) => ({ checkKey: "orphaned_event" as const, subjectType: "event" as const, subjectId: r.id, severity: CHECKS.orphaned_event.severity, title: CHECKS.orphaned_event.title, detail: { eventType: r.eventType } })) };
};

const emitFailures: Run = async (now) => {
  const [open, oldest] = await Promise.all([db.eventEmitFailure.count({ where: { status: "OPEN" } }), db.eventEmitFailure.findFirst({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } })]);
  return { total: open, findings: open > 0 ? [system("emit_failures_open", "emit_failures", { open, oldestDays: oldest ? Math.floor((now.getTime() - oldest.createdAt.getTime()) / DAY) : 0 })] : [] };
};

const consentMissing: Run = async (now) => {
  const types = registeredTypes().filter((t) => eventDef(t)?.consentRequired);
  const groups = await db.customerEvent.groupBy({ by: ["eventType"], where: { eventType: { in: types }, consentContext: { equals: Prisma.DbNull }, receivedAt: { gte: new Date(now.getTime() - 7 * DAY) } }, _count: { _all: true } });
  const findings = groups.map((g) => system("consent_context_missing", g.eventType, { eventType: g.eventType, last7Days: g._count._all }));
  return { total: findings.length, findings };
};

export const CHECK_RUNNERS: Record<CheckKey, Run> = {
  orphaned_event: orphanedEvents,
  no_identity_keys: noIdentityKeys,
  stale_intelligence: staleIntelligence,
  unassigned_lead: unassignedLeads,
  impossible_lifecycle: impossibleLifecycle,
  rows_on_merged_client: rowsOnMerged,
  left_on_archived_duplicate: leftOnArchived,
  duplicate_identity_key: duplicateKeys,
  emit_failures_open: emitFailures,
  consent_context_missing: consentMissing,
};
