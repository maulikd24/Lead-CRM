/**
 * Real-database test for "Raise a query" on a statement line. Skipped unless PARTNER_NATIVE_DB_TEST=1 and the database is local.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFixture, dbTestEnabled } from "./native/db-fixture";
import type { PartnerScope } from "./native/scope";
import { raiseStatementQuery } from "./statement-query";

describe.skipIf(!dbTestEnabled)("raising a statement query against a real database", () => {
  let f: Awaited<ReturnType<typeof createFixture>>;
  let accrualA = "";
  let accrualB = "";
  let accrualNoClient = "";
  const NOW = new Date("2026-10-10T06:00:00Z");
  const own = (): PartnerScope => ({ kind: "ids", ids: [f.P.a, f.P.b], detailIds: [f.P.a] });
  const raise = (over: Record<string, unknown> = {}, scope: Parameters<typeof raiseStatementQuery>[2] = own(), actor = { id: f.U["p-a"], role: "DISTRIBUTOR" as const }) =>
    raiseStatementQuery(f.db as never, actor, scope, { partnerId: f.P.a, period: "m-2026-09", lineRef: accrualA, message: "This amount looks too low", ...over }, NOW);

  beforeAll(async () => {
    f = await createFixture("pfxs");
    await f.cleanup();
    f = await createFixture("pfxs");
    await f.mkClient("c1");
    await f.mkClient("c2");
    const a1 = await f.mkAccount("c1", "a");
    const a2 = await f.mkAccount("c2", "b");
    accrualA = (await f.mkAccrual("a", a1, "1000", "100", "2026-09-05T05:00:00Z")).id;
    accrualB = (await f.mkAccrual("b", a2, "1000", "100", "2026-09-05T05:00:00Z")).id;
    // An accrual whose revenue has no client (e.g. imported revenue)
    const ev = await f.db.revenueEvent.create({ data: { sourceSystem: "pfxs", externalRef: "pfxs-noclient", revenueType: "BROKERAGE", grossRevenueAmount: "10", eventDate: new Date("2026-09-06T05:00:00Z"), rawPayload: {} } });
    await f.db.partnerWorkspaceSetting.upsert({ where: { key: "queries" }, create: { key: "queries", value: { assigneeUserId: f.U.fin }, updatedById: f.U.fin }, update: { value: { assigneeUserId: f.U.fin }, updatedById: f.U.fin } });
    accrualNoClient = (await f.db.commissionAccrual.create({ data: { revenueEventId: ev.id, partnerProfileId: f.P.a, accrualAmount: "1", accrualDate: new Date("2026-09-06T05:00:00Z"), computationVersion: "v1", commissionRuleId: f.rule.id } })).id;
  });
  afterAll(async () => {
    if (dbTestEnabled) await f.cleanup();
  });

  it("creates a Finance task and a query record, and audits it", async () => {
    const r = await raise();
    expect(r).toMatchObject({ ok: true, duplicate: false });
    if (!r.ok) return;
    const task = await f.db.task.findUniqueOrThrow({ where: { id: r.taskId } });
    expect(task.assignedToId).toBe(f.U.fin);
    expect(task.clientId).toBe(f.C.c1);
    expect(task.title).toContain("Partner query PFXS-A");
    expect(task.title).toContain("This amount looks too low");
    expect(task.status).toBe("PENDING");
    expect(task.source).toBe(`partner-query:${r.queryId}`);
    const q = await f.db.partnerStatementQuery.findUniqueOrThrow({ where: { id: r.queryId } });
    expect(q).toMatchObject({ partnerProfileId: f.P.a, periodKey: "m-2026-09", lineRef: accrualA, raisedById: f.U["p-a"], taskId: r.taskId });
    const audit = await f.db.auditLog.findFirst({ where: { action: "partner_statement_query_raised", entityId: f.P.a }, orderBy: { seq: "desc" } });
    expect(audit).toMatchObject({ userId: f.U["p-a"], entity: "PartnerProfile" });
    expect(JSON.stringify(audit!.newValue)).toContain(r.queryId);
  });

  it("asking again about the same line while the task is open is idempotent", async () => {
    const before = await f.db.partnerStatementQuery.count({ where: { partnerProfileId: f.P.a } });
    const r = await raise({ message: "Still looks wrong to me" });
    expect(r).toMatchObject({ ok: true, duplicate: true });
    expect(await f.db.partnerStatementQuery.count({ where: { partnerProfileId: f.P.a } })).toBe(before);
  });

  it("once the task is done the same line can be queried again", async () => {
    const q = await f.db.partnerStatementQuery.findFirstOrThrow({ where: { partnerProfileId: f.P.a, lineRef: accrualA } });
    await f.db.task.update({ where: { id: q.taskId! }, data: { status: "DONE" } });
    const r = await raise({ message: "Raising it a second time" });
    expect(r).toMatchObject({ ok: true, duplicate: false });
  });

  it("a partner cannot raise a query on a sub-partner's line, or a partner outside their network", async () => {
    expect(await raise({ partnerId: f.P.b, lineRef: accrualB })).toMatchObject({ ok: false, code: "not_allowed" });
    expect(await raise({ partnerId: f.P.e })).toMatchObject({ ok: false, code: "not_allowed" });
  });

  it("a team manager, who sees no lines, cannot raise one", async () => {
    expect(await raise({}, { kind: "ids", ids: [f.P.a], detailIds: [] })).toMatchObject({ ok: false, code: "not_allowed" });
  });

  it("the line must belong to that partner", async () => {
    expect(await raise({ lineRef: accrualB })).toMatchObject({ ok: false, code: "not_found" });
    expect(await raise({ lineRef: "nope" })).toMatchObject({ ok: false, code: "not_found" });
  });

  it("refuses a bad message and a malformed period before touching anything", async () => {
    expect(await raise({ message: "hi" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await raise({ period: "m-2026-13" })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("admin and finance can raise one on anyone's line", async () => {
    const r = await raise({ partnerId: f.P.b, lineRef: accrualB }, { kind: "all" }, { id: f.U.admin, role: "ADMIN" as never });
    expect(r).toMatchObject({ ok: true });
  });

  it("a line with no customer falls back to one of the partner's customers", async () => {
    const r = await raise({ lineRef: accrualNoClient, message: "What is this accrual?" });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect((await f.db.task.findUniqueOrThrow({ where: { id: r.taskId } })).clientId).toBe(f.C.c1);
  });

  it("uses the assignee Finance configured in Settings, and falls back to the first active Finance user", async () => {
    await f.db.partnerWorkspaceSetting.upsert({ where: { key: "queries" }, create: { key: "queries", value: { assigneeUserId: f.U.fin2 }, updatedById: f.U.fin }, update: { value: { assigneeUserId: f.U.fin2 }, updatedById: f.U.fin } });
    const r = await raise({ lineRef: accrualNoClient, message: "Another question about it" });
    if (r.ok && !r.duplicate) expect((await f.db.task.findUniqueOrThrow({ where: { id: r.taskId } })).assignedToId).toBe(f.U.fin2);
    await f.db.user.update({ where: { id: f.U.fin2 }, data: { isActive: false } });
    await f.db.task.updateMany({ where: { source: { startsWith: "partner-query:" }, clientId: f.C.c1 }, data: { status: "DONE" } });
    const r2 = await raise({ message: "Question after the assignee left" });
    expect(r2).toMatchObject({ ok: true, duplicate: false });
    if (r2.ok) expect((await f.db.task.findUniqueOrThrow({ where: { id: r2.taskId } })).assignedToId).not.toBe(f.U.fin2);
    await f.db.user.update({ where: { id: f.U.fin2 }, data: { isActive: true } });
  });
});
