/**
 * Real-database checks of the Attention Engine: every source against real rows, role scoping end to end (an RM never sees another RM's
 * customer, MARKETING sees campaign anomalies and nothing else), capacity inputs, hard overrides, and dismiss and snooze with their
 * audit rows and rules. Skipped unless W2C_DB_TEST=1 and DATABASE_URL is a local wt_ scratch database. Run it on its own:
 *   W2C_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/wt_w2c_main npx vitest run src/lib/attention/attention.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")), cache: <T,>(fn: T) => fn }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.W2C_DB_TEST === "1" && local && /\/wt_[a-z0-9_]+$/.test(url);

const DAY = 86_400_000;

describe.skipIf(!enabled)("attention engine (real database)", { timeout: 90_000 }, () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let feed: typeof import("./feed");
  let extra: readonly import("./sources").ExtraSource[] = [];
  const now = new Date("2027-05-10T05:30:00Z"); // Monday 11:00 IST
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const ids: Record<string, string> = {};
  const clients: Record<string, string> = {};

  beforeAll(async () => {
    db = (await import("@/lib/db/prisma")).basePrisma;
    feed = await import("./feed");
    extra = [(await import("@/lib/marketing/campaign-attention")).campaignAttentionSource];
    const mk = (key: string, role: "ADMIN" | "MANAGER" | "RM" | "MARKETING", managerId?: string) =>
      db.user.upsert({ where: { email: `att-${key}@example.test` }, update: { role, managerId: managerId ?? null }, create: { email: `att-${key}@example.test`, name: `Att ${key}`, passwordHash: "x", role, managerId } });
    ids.admin = (await mk("admin", "ADMIN")).id;
    ids.mgr = (await mk("mgr", "MANAGER")).id;
    ids.rm1 = (await mk("rm1", "RM", ids.mgr)).id;
    ids.rm2 = (await mk("rm2", "RM")).id;
    ids.mkt = (await mk("mkt", "MARKETING")).id;
    const stage = await db.stage.upsert({ where: { name: "Att test stage" }, update: {}, create: { name: "Att test stage", sequence: 9100, slaHours: 24 } });
    const mkClient = async (key: string, rm: string, extra: Record<string, unknown> = {}) => {
      const c = await db.client.create({ data: { clientCode: `ATT-${key}`, name: `Customer ${key}`, currentStageId: stage.id, assignedToId: rm, ...extra } });
      clients[key] = c.id;
      return c;
    };
    await mkClient("A1", ids.rm1);
    await mkClient("B1", ids.rm2);
    await mkClient("H1", ids.rm1, { priority: "HIGH", createdAt: ago(2 * DAY) });
    await db.conversationInsight.create({ data: { clientId: clients.A1, kind: "COMPLAINT", text: "SECRET RAW COMPLAINT TEXT", severity: "high", sourceType: "NOTE", sourceRef: "n1", dedupeKey: "att-d1", occurredAt: ago(2 * DAY) } });
    await db.conversationInsight.create({ data: { clientId: clients.B1, kind: "COMPLAINT", text: "other rm complaint", severity: "low", sourceType: "NOTE", sourceRef: "n2", dedupeKey: "att-d2", occurredAt: ago(DAY) } });
    await db.conversationInsight.create({ data: { clientId: clients.A1, kind: "COMMITMENT", text: "promised callback", dueAt: ago(3 * DAY), sourceType: "CALL", sourceRef: "n3", dedupeKey: "att-d3", occurredAt: ago(5 * DAY) } });
    await db.task.create({ data: { clientId: clients.A1, assignedToId: ids.rm1, title: "Send KYC form", dueAt: ago(DAY) } });
    await db.task.create({ data: { clientId: clients.B1, assignedToId: ids.rm2, title: "Other RM task", dueAt: ago(DAY) } });
    await db.exception.create({ data: { clientId: clients.A1, stageId: stage.id, reason: "Docs missing", status: "OPEN", createdAt: ago(3 * DAY) } });
    await db.opportunity.create({ data: { clientId: clients.A1, product: "PMS", estimatedValue: 5_000_000, stage: "DECISION_PENDING", stageEnteredAt: ago(9 * DAY), ownerId: ids.rm1 } });
    await db.controlPlaneAlert.create({ data: { key: "att-heartbeat", severity: "CRITICAL", title: "Scheduler stopped", firstRaisedAt: ago(DAY) } });
    await db.approvalRequest.create({ data: { actionType: "BULK_REASSIGN", entity: "Client", entityId: clients.A1, payload: {}, requestedById: ids.mgr, requestedAt: ago(2 * DAY) } });
    for (let i = 1; i <= 7; i++) {
      const date = new Date(Date.UTC(2027, 4, 10 - i));
      await db.adCampaignDaily.create({ data: { provider: "meta", accountId: "att", campaignId: "att-camp", campaignName: "Att campaign", date, spendMinor: BigInt(i === 1 ? 900_000 : 100_000), currency: "INR", impressions: 1000, clicks: 10, reach: 900, leads: 5, syncedAt: now } });
    }
  });
  afterAll(async () => {
    await db.attentionDismissal.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await db.auditLog.deleteMany({ where: { entity: "AttentionItem", userId: { in: Object.values(ids) } } }).catch(() => {});
    await db.adCampaignDaily.deleteMany({ where: { accountId: "att" } });
    await db.approvalRequest.deleteMany({ where: { requestedById: ids.mgr } });
    await db.controlPlaneAlert.deleteMany({ where: { key: "att-heartbeat" } });
    await db.opportunity.deleteMany({ where: { clientId: { in: Object.values(clients) } } });
    await db.exception.deleteMany({ where: { clientId: { in: Object.values(clients) } } });
    await db.task.deleteMany({ where: { clientId: { in: Object.values(clients) } } });
    await db.conversationInsight.deleteMany({ where: { clientId: { in: Object.values(clients) } } });
    await db.client.deleteMany({ where: { id: { in: Object.values(clients) } } });
  });

  it("an RM sees only their own customers' items, ranked with the complaint on top, and never a system item", async () => {
    const f = await feed.loadAttentionFeed(ids.rm1, "RM", now, { extraSources: extra });
    const kinds = f.items.map((i) => i.kind);
    expect(kinds[0]).toBe("complaint");
    expect(kinds).toEqual(expect.arrayContaining(["overdue_commitment", "kyc_blocker", "task", "customer_opportunity", "hot_lead"]));
    expect(kinds).not.toContain("failed_integration");
    expect(kinds).not.toContain("approval");
    expect(kinds).not.toContain("campaign_anomaly");
    expect(f.items.some((i) => i.subject.label === "Customer B1")).toBe(false);
    expect(f.items.every((i) => i.ownerUserId === ids.rm1)).toBe(true);
  });

  it("never copies raw conversation text into an item", async () => {
    const f = await feed.loadAttentionFeed(ids.rm1, "RM", now);
    expect(JSON.stringify(f)).not.toContain("SECRET RAW COMPLAINT TEXT");
  });

  it("a manager sees the team (own RMs), not an RM outside the team", async () => {
    const f = await feed.loadAttentionFeed(ids.mgr, "MANAGER", now);
    expect(f.items.some((i) => i.subject.label === "Customer A1")).toBe(true);
    expect(f.items.some((i) => i.subject.label === "Customer B1")).toBe(false);
    expect(f.items.some((i) => i.kind === "failed_integration")).toBe(false);
  });

  it("an admin sees everything, system items first when critical", async () => {
    const f = await feed.loadAttentionFeed(ids.admin, "ADMIN", now, { extraSources: extra });
    expect(f.items[0]).toMatchObject({ kind: "failed_integration", override: "critical_incident" });
    const kinds = f.items.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(["approval", "campaign_anomaly", "complaint"]));
    expect(f.items.some((i) => i.subject.label === "Customer B1")).toBe(true);
  });

  it("MARKETING sees campaign anomalies and nothing else", async () => {
    const f = await feed.loadAttentionFeed(ids.mkt, "MARKETING", now, { extraSources: extra });
    expect(f.items.length).toBeGreaterThan(0);
    expect(new Set(f.items.map((i) => i.kind))).toEqual(new Set(["campaign_anomaly"]));
    expect(JSON.stringify(f)).not.toMatch(/Customer A1|Customer B1|Send KYC/);
  });

  it("roles with no feed get nothing", async () => {
    expect((await feed.loadAttentionFeed(ids.rm1, "FINANCE", now)).items).toEqual([]);
  });

  it("dismiss hides an item for that person only, is audited, can be restored; a complaint cannot be dismissed, only snoozed 24h with a reason", async () => {
    const before = await feed.loadAttentionFeed(ids.rm1, "RM", now);
    const task = before.items.find((i) => i.kind === "task")!;
    expect(await feed.setDismissal({ userId: ids.rm1, role: "RM", itemId: task.id, status: "DISMISSED", snoozeUntil: null, reason: null, now })).toEqual({ ok: true });
    expect((await feed.loadAttentionFeed(ids.rm1, "RM", now)).items.some((i) => i.id === task.id)).toBe(false);
    expect((await feed.loadAttentionFeed(ids.admin, "ADMIN", now)).items.some((i) => i.id === task.id)).toBe(true); // someone else still sees it
    expect(await db.auditLog.count({ where: { entity: "AttentionItem", entityId: task.id, action: "attention.dismissed", userId: ids.rm1 } })).toBe(1);
    expect(await feed.restoreItem(ids.rm1, task.id)).toEqual({ ok: true });
    expect((await feed.loadAttentionFeed(ids.rm1, "RM", now)).items.some((i) => i.id === task.id)).toBe(true);

    const complaint = before.items.find((i) => i.kind === "complaint")!;
    expect(await feed.setDismissal({ userId: ids.rm1, role: "RM", itemId: complaint.id, status: "DISMISSED", snoozeUntil: null, reason: "x", now })).toMatchObject({ ok: false });
    expect(await feed.setDismissal({ userId: ids.rm1, role: "RM", itemId: complaint.id, status: "SNOOZED", snoozeUntil: new Date(now.getTime() + 3 * DAY), reason: "x", now })).toMatchObject({ ok: false });
    expect(await feed.setDismissal({ userId: ids.rm1, role: "RM", itemId: complaint.id, status: "SNOOZED", snoozeUntil: new Date(now.getTime() + 3_600_000), reason: "Calling back after lunch", now })).toEqual({ ok: true });
    expect((await feed.loadAttentionFeed(ids.rm1, "RM", now)).items.some((i) => i.id === complaint.id)).toBe(false);
    expect((await feed.loadAttentionFeed(ids.rm1, "RM", new Date(now.getTime() + 2 * 3_600_000))).items.some((i) => i.id === complaint.id)).toBe(true); // snooze ended
  });

  it("an item that is not in your own feed cannot be dismissed (a made-up or another RM's id does nothing)", async () => {
    const other = (await feed.loadAttentionFeed(ids.rm2, "RM", now)).items[0];
    expect(await feed.setDismissal({ userId: ids.rm1, role: "RM", itemId: other.id, status: "DISMISSED", snoozeUntil: null, reason: null, now })).toMatchObject({ ok: false });
    expect(await feed.setDismissal({ userId: ids.rm1, role: "RM", itemId: "task:nope", status: "DISMISSED", snoozeUntil: null, reason: null, now })).toMatchObject({ ok: false });
    expect(await feed.setDismissal({ userId: ids.mkt, role: "MARKETING", itemId: other.id, status: "DISMISSED", snoozeUntil: null, reason: null, now })).toMatchObject({ ok: false });
  });

  it("workload feeds capacity: open tasks are counted per owner", async () => {
    const f = await feed.loadAttentionFeed(ids.rm1, "RM", now);
    expect(f.capacity[ids.rm1].openWorkload).toBe(1);
    expect(f.capacity[ids.rm1].nowBudget).toBeGreaterThanOrEqual(1);
  });
});
