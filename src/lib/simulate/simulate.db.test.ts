/**
 * Real-database checks of simulate() and its first use, bulk follow-up tasks: the facts loader against real rows (consent, do-not-contact,
 * complaints, recent contact, frequency cap), the scope rule (an RM cannot preview or create tasks for another RM's customers), that the
 * preview writes nothing, and that Create makes tasks only for the eligible. Skipped unless W2C_DB_TEST=1 and DATABASE_URL is a local
 * wt_ scratch database. Run it on its own:
 *   W2C_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/wt_w2c_main npx vitest run src/lib/simulate/simulate.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = { user: { id: "", role: "RM" as string } };
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/auth/require-role", () => ({ requireAccess: vi.fn(async () => session) }));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")), cache: <T,>(fn: T) => fn }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.W2C_DB_TEST === "1" && local && /\/wt_[a-z0-9_]+$/.test(url);
const DAY = 86_400_000;

describe.skipIf(!enabled)("simulate (real database)", { timeout: 60_000 }, () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  const ids: Record<string, string> = {};
  const clients: Record<string, string> = {};

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SIMULATE = "1";
    db = (await import("@/lib/db/prisma")).basePrisma;
    const mk = (key: string, role: "RM" | "MANAGER") => db.user.upsert({ where: { email: `sim-${key}@example.test` }, update: {}, create: { email: `sim-${key}@example.test`, name: `Sim ${key}`, passwordHash: "x", role } });
    ids.rm1 = (await mk("rm1", "RM")).id;
    ids.rm2 = (await mk("rm2", "RM")).id;
    const stage = await db.stage.upsert({ where: { name: "Sim test stage" }, update: {}, create: { name: "Sim test stage", sequence: 9200, slaHours: 24 } });
    const mkClient = async (key: string, rm: string, extra: Record<string, unknown> = {}) => {
      clients[key] = (await db.client.create({ data: { clientCode: `SIM-${key}`, name: `Sim ${key}`, currentStageId: stage.id, assignedToId: rm, mobile: `98${Math.floor(10000000 + Math.random() * 89999999)}`, email: `${key}@sim.example.test`, ...extra } })).id;
    };
    await mkClient("ok", ids.rm1);
    await mkClient("dnd", ids.rm1);
    await mkClient("complaint", ids.rm1);
    await mkClient("recent", ids.rm1);
    await mkClient("capped", ids.rm1);
    await mkClient("other", ids.rm2);
    await db.consentRecord.create({ data: { clientId: clients.dnd, purpose: "DO_NOT_CONTACT", channel: null, status: "GRANTED", source: "RM_RECORDED", capturedAt: new Date(Date.now() - DAY) } });
    await db.conversationInsight.create({ data: { clientId: clients.complaint, kind: "COMPLAINT", text: "t", status: "OPEN", severity: "low", sourceType: "NOTE", sourceRef: "s", dedupeKey: "sim-d1", occurredAt: new Date(Date.now() - DAY) } });
    await db.activity.create({ data: { clientId: clients.recent, type: "CALL", payload: {}, createdAt: new Date(Date.now() - 3_600_000) } });
    for (let i = 0; i < 3; i++) await db.activity.create({ data: { clientId: clients.capped, type: "MESSAGE", payload: {}, createdAt: new Date(Date.now() - (3 + i) * DAY) } });
  });
  afterAll(async () => {
    const cids = Object.values(clients);
    await db.task.deleteMany({ where: { clientId: { in: cids } } });
    await db.auditLog.deleteMany({ where: { entity: "Task", entityId: "bulk-follow-up", userId: { in: Object.values(ids) } } }).catch(() => {});
    await db.activity.deleteMany({ where: { clientId: { in: cids } } });
    await db.conversationInsight.deleteMany({ where: { clientId: { in: cids } } });
    await db.consentRecord.deleteMany({ where: { clientId: { in: cids } } });
    await db.client.deleteMany({ where: { id: { in: cids } } });
  });

  it("the facts and the rules agree on real rows: who is eligible, who is held back and why", async () => {
    const { loadTargetFacts } = await import("./facts-db");
    const { simulate } = await import("./engine");
    const { bulkFollowUpAction } = await import("./bulk-tasks");
    const action = bulkFollowUpAction({ title: "t", channel: "any", kind: "sales", dueInDays: 2 });
    const facts = await loadTargetFacts(Object.values(clients), new Date(), { recentContactHours: action.recentContactHours, windowDays: action.frequencyCap.windowDays });
    const r = simulate(action, facts, new Date());
    // Sales needs an opt-in: nobody here has one, so EVERYONE is held back for consent; the other reasons are listed alongside it.
    expect(r.eligible).toEqual([]);
    const by = (k: string) => r.suppressed.find((s) => s.label === `Sim ${k}`)?.reasons ?? [];
    expect(by("ok")).toContain("consent");
    expect(by("dnd")).toContain("do_not_contact");
    expect(by("complaint")).toContain("open_complaint");
    expect(by("recent")).toContain("recent_contact");
    expect(by("capped")).toContain("frequency_cap");

    const service = simulate(bulkFollowUpAction({ title: "t", channel: "call", kind: "service", dueInDays: 2 }), facts, new Date());
    expect(service.eligible.map((e) => e.label).sort()).toEqual(["Sim complaint", "Sim ok", "Sim other"].sort()); // service contact: complaint does not block it
  });

  it("the preview writes nothing; Create makes tasks only for the eligible; it never doubles a task; an RM cannot reach another RM's customer", async () => {
    session.user = { id: ids.rm1, role: "RM" };
    const actions = await import("@/app/(dashboard)/clients/simulate-actions");
    const params = { title: "Documents follow-up", channel: "call" as const, kind: "service" as const, dueInDays: 2 };
    const all = Object.values(clients);
    const before = await db.task.count({ where: { clientId: { in: all } } });
    const preview = await actions.simulateBulkFollowUpAction(all, params);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.outOfScope).toBe(1); // the other RM's customer
    expect(preview.result.total).toBe(5);
    expect(await db.task.count({ where: { clientId: { in: all } } })).toBe(before); // a dry run changes nothing

    const created = await actions.createBulkFollowUpTasksAction(all, params);
    expect(created).toMatchObject({ ok: true, created: 2 }); // ok + complaint (service); dnd, recent and capped are held back
    const tasks = await db.task.findMany({ where: { clientId: { in: all }, source: "bulk-follow-up" }, select: { clientId: true, assignedToId: true } });
    expect(new Set(tasks.map((t) => t.clientId))).toEqual(new Set([clients.ok, clients.complaint]));
    expect(tasks.every((t) => t.assignedToId === ids.rm1)).toBe(true);
    expect(tasks.some((t) => t.clientId === clients.other)).toBe(false);
    expect(await db.auditLog.count({ where: { entity: "Task", entityId: "bulk-follow-up", action: "bulk_follow_up_tasks", userId: ids.rm1 } })).toBe(1);

    const again = await actions.createBulkFollowUpTasksAction(all, params);
    expect(again).toMatchObject({ ok: true, created: 0, alreadyOpen: 2 });
  });

  it("is refused while the flag is off", async () => {
    process.env.NEXT_PUBLIC_SIMULATE = "0";
    session.user = { id: ids.rm1, role: "RM" };
    const actions = await import("@/app/(dashboard)/clients/simulate-actions");
    expect(await actions.simulateBulkFollowUpAction([clients.ok], { title: "t", channel: "call", kind: "service", dueInDays: 2 })).toMatchObject({ ok: false });
    process.env.NEXT_PUBLIC_SIMULATE = "1";
  });
});
