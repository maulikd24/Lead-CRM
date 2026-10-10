/**
 * Test-only helper for the real-database tests of the Partner workspace: a small synthetic network (a distributor with two
 * levels below it, plus a separate partner), clients with sourced accounts, revenue and accruals. Every row carries a tag
 * so a run can remove exactly what it made. Local databases only; the caller checks `dbTestEnabled`.
 */
export const dbUrl = process.env.DATABASE_URL ?? "";
export const dbLocal = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(dbUrl);
export const dbTestEnabled = process.env.PARTNER_NATIVE_DB_TEST === "1" && dbLocal;

type Db = typeof import("@/lib/db/prisma").basePrisma;
type PType = "DISTRIBUTOR" | "PARTNER" | "AFFILIATE";
type PStatus = "ACTIVE" | "ONBOARDING" | "SUSPENDED" | "TERMINATED";

export type NodeSpec = { key: string; parent: string | null; type: PType; status?: PStatus; pan?: boolean; gstin?: boolean; bank?: boolean };

export const DEFAULT_NODES: NodeSpec[] = [
  { key: "a", parent: null, type: "DISTRIBUTOR", pan: true, gstin: true, bank: true },
  { key: "b", parent: "a", type: "PARTNER", pan: true, bank: true },
  { key: "c", parent: "a", type: "AFFILIATE" },
  { key: "d", parent: "b", type: "AFFILIATE", pan: true, bank: true },
  { key: "e", parent: null, type: "PARTNER", pan: true, bank: true },
];

export async function createFixture(tag: string, nodes: NodeSpec[] = DEFAULT_NODES) {
  const { basePrisma: db } = await import("@/lib/db/prisma");
  const P: Record<string, string> = {};
  const U: Record<string, string> = {};
  const C: Record<string, string> = {};

  const user = async (key: string, role: "ADMIN" | "FINANCE" | "TEAM_MANAGER" | "PARTNER" | "AFFILIATE" | "DISTRIBUTOR" | "RM") => {
    const email = `${tag}-${key}@example.test`;
    const found = await db.user.findUnique({ where: { email } });
    const u = found ?? (await db.user.create({ data: { name: `Test ${key}`, email, passwordHash: "x", role } }));
    U[key] = u.id;
    return u;
  };

  const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Partner fix test stage", sequence: 9102, slaHours: 24 } }));
  await user("fin", "FINANCE");
  await user("fin2", "FINANCE");
  await user("admin", "ADMIN");
  await user("admin2", "ADMIN");

  for (const n of nodes) {
    const u = await user(`p-${n.key}`, n.type === "DISTRIBUTOR" ? "DISTRIBUTOR" : n.type === "PARTNER" ? "PARTNER" : "AFFILIATE");
    const existing = await db.partnerProfile.findUnique({ where: { userId: u.id } });
    const p =
      existing ??
      (await db.partnerProfile.create({
        data: {
          userId: u.id,
          partnerCode: `${tag.toUpperCase()}-${n.key.toUpperCase()}`,
          partnerType: n.type,
          empanelmentStatus: n.status ?? "ACTIVE",
          parentPartnerProfileId: n.parent ? P[n.parent] : null,
          panNumber: n.pan ? `SECRETPAN-${n.key}` : null,
          gstin: n.gstin ? `SECRETGST-${n.key}` : null,
          bankAccountLast4: n.bank ? "4321" : null,
          bankVerifiedAt: n.bank ? new Date("2026-08-01T00:00:00Z") : null,
        },
      }));
    P[n.key] = p.id;
  }

  const plan = (await db.commissionPlan.findUnique({ where: { code: `${tag}-plan` } })) ?? (await db.commissionPlan.create({ data: { code: `${tag}-plan`, name: "Fixture plan" } }));
  const rule = (await db.commissionRule.findFirst({ where: { commissionPlanId: plan.id } })) ?? (await db.commissionRule.create({ data: { commissionPlanId: plan.id, rateType: "PERCENT_OF_GROSS", percentRate: 10, createdById: U.fin, validFrom: new Date("2026-01-01T00:00:00Z") } }));

  const mkClient = async (key: string, extra: Record<string, unknown> = {}) => {
    const c = await db.client.create({ data: { clientCode: `${tag.toUpperCase()}-${key}`, name: `Client ${key}`, currentStageId: stage.id, ...extra } });
    C[key] = c.id;
    return c;
  };
  let seq = 0;
  const mkAccount = async (clientKey: string, partnerKey: string | null) => {
    const a = await db.tradingAccount.create({ data: { accountNumber: `${tag.toUpperCase()}-ACC-${++seq}`, clientId: C[clientKey], accountType: "EQUITY", status: "ACTIVE", sourcingPartnerId: partnerKey ? P[partnerKey] : null } });
    return a;
  };
  /** One revenue event and its commission accrual for a partner. */
  const mkAccrual = async (partnerKey: string, account: { id: string; clientId: string }, gross: string, amount: string, date: string, extra: Record<string, unknown> = {}) => {
    const ev = await db.revenueEvent.create({ data: { sourceSystem: tag, externalRef: `${tag}-${++seq}`, tradingAccountId: account.id, clientId: account.clientId, revenueType: "BROKERAGE", grossRevenueAmount: gross, eventDate: new Date(date), rawPayload: {} } });
    return db.commissionAccrual.create({ data: { revenueEventId: ev.id, partnerProfileId: P[partnerKey], commissionRuleId: rule.id, accrualAmount: amount, accrualDate: new Date(date), computationVersion: "v1", ...extra } });
  };

  async function cleanup() {
    const pids = Object.values(P);
    const payouts = await db.payout.findMany({ where: { partnerProfileId: { in: pids } }, select: { id: true, payoutRunId: true } });
    const queries = await db.partnerStatementQuery.findMany({ where: { partnerProfileId: { in: pids } }, select: { taskId: true } });
    const clients = await db.client.findMany({ where: { clientCode: { startsWith: `${tag.toUpperCase()}-` } }, select: { id: true } });
    const cids = clients.map((c) => c.id);
    await db.task.deleteMany({ where: { OR: [{ id: { in: queries.map((q) => q.taskId).filter((x): x is string => !!x) } }, { clientId: { in: cids } }] } });
    await db.partnerStatementQuery.deleteMany({ where: { partnerProfileId: { in: pids } } });
    await db.partnerReferralTouch.deleteMany({ where: { OR: [{ partnerProfileId: { in: pids } }, { clientId: { in: cids } }] } });
    await db.partnerAttributionEvent.deleteMany({ where: { OR: [{ partnerProfileId: { in: pids } }, { clientId: { in: cids } }, { code: { startsWith: tag.toUpperCase() } }] } });
    await db.payoutLine.deleteMany({ where: { payoutId: { in: payouts.map((p) => p.id) } } });
    await db.commissionAdjustment.deleteMany({ where: { partnerProfileId: { in: pids } } });
    await db.payout.deleteMany({ where: { id: { in: payouts.map((p) => p.id) } } });
    await db.payoutRun.deleteMany({ where: { OR: [{ id: { in: payouts.map((p) => p.payoutRunId) } }, { createdById: U.fin }] } });
    await db.commissionAccrual.deleteMany({ where: { partnerProfileId: { in: pids } } });
    await db.revenueEvent.deleteMany({ where: { sourceSystem: tag } });
    await db.tradingAccount.deleteMany({ where: { accountNumber: { startsWith: `${tag.toUpperCase()}-ACC-` } } });
    await db.client.deleteMany({ where: { id: { in: cids } } });
    await db.partnerTaxRule.deleteMany({ where: { createdById: { in: [U.fin, U.fin2, U.admin, U.admin2] } } });
    await db.partnerOverrideRule.deleteMany({ where: { createdById: { in: [U.fin, U.fin2, U.admin, U.admin2] } } });
    await db.partnerWorkspaceSetting.deleteMany({ where: { updatedById: { in: [U.fin, U.fin2, U.admin, U.admin2] } } });
    await db.approvalRequest.deleteMany({ where: { requestedById: { in: [U.fin, U.fin2, U.admin, U.admin2] } } });
    await db.partnerCommissionAssignment.deleteMany({ where: { partnerProfileId: { in: pids } } });
    await db.commissionRule.deleteMany({ where: { commissionPlan: { code: `${tag}-plan` } } });
    await db.commissionPlan.deleteMany({ where: { code: `${tag}-plan` } });
    for (const id of [...pids].reverse()) await db.partnerProfile.update({ where: { id }, data: { parentPartnerProfileId: null } }).catch(() => {});
    await db.partnerProfile.deleteMany({ where: { id: { in: pids } } });
    // Users that have audit rows cannot be deleted (the audit log is append-only); they are reused by the next run.
    await db.user.deleteMany({ where: { email: { startsWith: `${tag}-` } } }).catch(() => {});
  }

  return { db: db as Db, P, U, C, stage, rule, mkClient, mkAccount, mkAccrual, cleanup };
}
