/**
 * Synthetic partner-programme data for the layout-budget test (scripts/layout-budget/run.mjs): a four-level partner network,
 * clients and leads, eight months of revenue and accruals (computed by the real rule engine), payout runs in every state, tax and
 * override rules, a pending rule proposal, statement branding and the users the partner screens are checked as:
 * ui-fin@ / ui-fin2@ (Finance), ui-tm@ (team manager), ui-dist@ (distributor), syn-partner-NN@ (partners). Password password123.
 *
 * Local database only (the import below refuses anything else). Nothing here is a real person or firm. Idempotent: it removes
 * its own earlier rows (codes PTR-S*, clients SYN-P*, source "syn-seed") first.
 *
 *   npm run layout-budget:seed      (after `npx tsx prisma/seed.ts`)
 */
import "dotenv/config";
import "../../src/lib/safety/assert-local-db";
import bcrypt from "bcryptjs";

import { prisma } from "../../src/lib/db/prisma";
import { buildPayoutRun } from "../../src/lib/earnings/build-payout-run";
import { computeAccrual, COMPUTATION_VERSION, type CommissionRuleInput } from "../../src/lib/earnings/compute-accruals";

// Deterministic randomness, so reruns look the same.
let seed = 20261010;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const between = (lo: number, hi: number) => Math.floor(lo + rnd() * (hi - lo + 1));

const IST = 5.5 * 3600 * 1000;
const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m, 1) - IST);
const NOW = new Date("2026-10-10T06:00:00Z");

const FIRST = ["Sunrise", "Maple", "Harbour", "Lotus", "Cedar", "Orion", "Pioneer", "Summit", "Anchor", "Beacon", "Crest", "Delta", "Evergreen", "Falcon", "Granite", "Horizon", "Ivory", "Juniper", "Keystone", "Lantern", "Meridian", "Nimbus", "Oakridge", "Prairie", "Quartz", "Riverbend", "Sterling", "Trident", "Umber", "Vantage", "Willow", "Zenith"];
const LAST = ["Advisory", "Wealth", "Capital", "Partners", "Distribution", "Associates", "Financial", "Investments"];
const GIVEN = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Sara", "Vikram", "Zoya", "Ishaan", "Naina", "Arjun", "Tara", "Neel", "Anika", "Yash", "Riya", "Dev", "Kiara", "Om", "Esha"];
const FAMILY = ["Rao", "Iyer", "Nair", "Menon", "Shah", "Kapoor", "Bose", "Das", "Pillai", "Reddy", "Gill", "Sethi", "Joshi", "Kulkarni", "Banerjee", "Chopra"];

async function cleanup() {
  await prisma.approvalRequest.deleteMany({ where: { id: "vol-run-approval" } });
  await prisma.partnerStatementQuery.deleteMany({});
  await prisma.partnerReferralTouch.deleteMany({ where: { client: { clientCode: { startsWith: "SYN-P" } } } });
  await prisma.partnerAttributionEvent.deleteMany({});
  await prisma.commissionAccrual.deleteMany({ where: { overrideKey: { not: null } } });
  const partners = await prisma.partnerProfile.findMany({ where: { partnerCode: { startsWith: "PTR-S" } }, select: { id: true, userId: true } });
  const pids = partners.map((p) => p.id);
  const payouts = await prisma.payout.findMany({ where: { partnerProfileId: { in: pids } }, select: { id: true, payoutRunId: true } });
  await prisma.payoutLine.deleteMany({ where: { payoutId: { in: payouts.map((p) => p.id) } } });
  await prisma.commissionAdjustment.deleteMany({ where: { partnerProfileId: { in: pids } } });
  await prisma.payout.deleteMany({ where: { id: { in: payouts.map((p) => p.id) } } });
  const runIds = [...new Set(payouts.map((p) => p.payoutRunId))];
  await prisma.payoutRun.deleteMany({ where: { id: { in: runIds }, payouts: { none: {} } } });
  await prisma.commissionAccrual.deleteMany({ where: { OR: [{ partnerProfileId: { in: pids } }, { revenueEvent: { sourceSystem: "syn-seed" } }] } });
  await prisma.revenueEvent.deleteMany({ where: { sourceSystem: "syn-seed" } });
  await prisma.tradingAccount.deleteMany({ where: { accountNumber: { startsWith: "SYN-P-" } } });
  await prisma.client.deleteMany({ where: { clientCode: { startsWith: "SYN-P" } } });
  await prisma.partnerCommissionAssignment.deleteMany({ where: { partnerProfileId: { in: pids } } });
  for (const id of pids.reverse()) await prisma.partnerProfile.update({ where: { id }, data: { parentPartnerProfileId: null } });
  await prisma.partnerProfile.deleteMany({ where: { id: { in: pids } } });
  await prisma.user.deleteMany({ where: { id: { in: partners.map((p) => p.userId) } } });
  await prisma.commissionSlab.deleteMany({ where: { commissionRule: { commissionPlan: { code: { startsWith: "SYN-P-" } } } } });
  await prisma.commissionRule.deleteMany({ where: { commissionPlan: { code: { startsWith: "SYN-P-" } } } });
  await prisma.commissionPlan.deleteMany({ where: { code: { startsWith: "SYN-P-" } } });
}

async function main() {
  await cleanup();
  const passwordHash = await bcrypt.hash("password123", 10);
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@supportify.local" } });
  const stage = await prisma.stage.findFirstOrThrow({ orderBy: { sequence: "asc" } });

  // Plans: percent, tiered, flat.
  const mkPlan = async (code: string, name: string, rule: { rateType: "PERCENT_OF_GROSS" | "SLAB" | "FLAT_PER_TRANSACTION"; percentRate?: number; flatRate?: number; slabs?: { min: number; max: number | null; rate: number }[] }) => {
    const plan = await prisma.commissionPlan.create({ data: { code, name } });
    const r = await prisma.commissionRule.create({ data: { commissionPlanId: plan.id, rateType: rule.rateType, percentRate: rule.percentRate, flatRate: rule.flatRate, createdById: admin.id, validFrom: new Date("2026-01-01T00:00:00Z") } });
    for (const s of rule.slabs ?? []) await prisma.commissionSlab.create({ data: { commissionRuleId: r.id, minAmount: s.min, maxAmount: s.max, rate: s.rate } });
    return { plan, rule: r };
  };
  const plans = [
    await mkPlan("SYN-P-PCT", "Standard 25% of brokerage", { rateType: "PERCENT_OF_GROSS", percentRate: 25 }),
    await mkPlan("SYN-P-SLAB", "Tiered by trade size", { rateType: "SLAB", slabs: [{ min: 0, max: 5000, rate: 20 }, { min: 5000, max: 25000, rate: 30 }, { min: 25000, max: null, rate: 40 }] }),
    await mkPlan("SYN-P-FLAT", "Flat 75 per trade", { rateType: "FLAT_PER_TRANSACTION", flatRate: 75 }),
  ];

  // Partners: the demo distributor (from the repo's own demo seed) roots a branch; three more distributors root others.
  const staff = async (key: string, name: string, role: "FINANCE" | "TEAM_MANAGER" | "DISTRIBUTOR") => prisma.user.upsert({ where: { email: `ui-${key}@example.test` }, update: { passwordHash }, create: { name, email: `ui-${key}@example.test`, passwordHash, role } });
  const finUser = await staff("fin", "Fiona Finance", "FINANCE");
  await staff("fin2", "Farid Finance", "FINANCE");
  const tmUser = await staff("tm", "Tara Team Manager", "TEAM_MANAGER");
  const distUser = await staff("dist", "Deepak Distributor", "DISTRIBUTOR");
  const demoDist = (await prisma.partnerProfile.findUnique({ where: { userId: distUser.id } })) ?? (await prisma.partnerProfile.create({ data: { userId: distUser.id, partnerCode: "PTR-S9000", partnerType: "DISTRIBUTOR", tier: "PLATINUM", empanelmentStatus: "ACTIVE", empanelmentDate: new Date("2026-01-05T00:00:00Z"), bankAccountLast4: "5521", bankVerifiedAt: new Date("2026-02-01T00:00:00Z"), panNumber: "x", region: "West" } }));
  await prisma.partnerCommissionAssignment.deleteMany({ where: { partnerProfileId: demoDist.id } });
  await prisma.partnerCommissionAssignment.create({ data: { partnerProfileId: demoDist.id, commissionPlanId: plans[0].plan.id, validFrom: new Date("2026-01-01T00:00:00Z"), assignedById: admin.id } });
  type P = { id: string; code: string; planIdx: number; status: string; bank: boolean };
  const made: P[] = [];
  let n = 0;
  const mk = async (parentId: string | null, type: "DISTRIBUTOR" | "PARTNER" | "AFFILIATE", tier: "PLATINUM" | "GOLD" | "SILVER" | "BRONZE", status: "ACTIVE" | "ONBOARDING" | "SUSPENDED" | "TERMINATED") => {
    n++;
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const u = await prisma.user.create({ data: { name, email: `syn-partner-${String(n).padStart(2, "0")}@example.test`, passwordHash, role: type, isActive: status !== "TERMINATED" } });
    const bank = status === "ACTIVE" ? rnd() > 0.12 : rnd() > 0.7;
    const code = `PTR-S${String(n).padStart(4, "0")}`;
    const p = await prisma.partnerProfile.create({
      data: {
        userId: u.id, partnerCode: code, partnerType: type, tier, empanelmentStatus: status, empanelmentDate: status === "ONBOARDING" ? null : new Date(NOW.getTime() - between(60, 400) * 86400000),
        parentPartnerProfileId: parentId, bankAccountLast4: bank || rnd() > 0.5 ? String(between(1000, 9999)) : null, bankVerifiedAt: bank ? new Date(NOW.getTime() - between(10, 200) * 86400000) : null,
        createdAt: new Date(NOW.getTime() - between(80, 420) * 86400000), region: pick(["North", "South", "West", "East"]),
      },
    });
    const planIdx = between(0, 2);
    await prisma.partnerCommissionAssignment.create({ data: { partnerProfileId: p.id, commissionPlanId: plans[planIdx].plan.id, validFrom: new Date("2026-01-01T00:00:00Z"), assignedById: admin.id } });
    const row = { id: p.id, code, planIdx, status, bank };
    made.push(row);
    return row;
  };
  const roots: (string | null)[] = [demoDist.id];
  for (let i = 0; i < 3; i++) roots.push((await mk(null, "DISTRIBUTOR", pick(["PLATINUM", "GOLD"]), "ACTIVE")).id);
  for (const root of roots) {
    const kids = between(3, 5);
    for (let k = 0; k < kids; k++) {
      const status = pick(["ACTIVE", "ACTIVE", "ACTIVE", "ONBOARDING", "SUSPENDED"] as const);
      const mid = await mk(root, "PARTNER", pick(["GOLD", "SILVER", "SILVER", "BRONZE"]), status);
      for (let a = between(0, 3); a > 0; a--) {
        const leaf = await mk(mid.id, "AFFILIATE", pick(["SILVER", "BRONZE", "BRONZE"]), pick(["ACTIVE", "ACTIVE", "ONBOARDING", "TERMINATED"] as const));
        if (rnd() > 0.7) await mk(leaf.id, "AFFILIATE", "BRONZE", "ACTIVE"); // a fourth level
      }
    }
  }
  for (const p of made) if (rnd() > 0.85) await prisma.partnerProfile.update({ where: { id: p.id }, data: { empanelmentStatus: "ACTIVE" } });
  made.unshift({ id: demoDist.id, code: "PTR-S9000", planIdx: 0, status: "ACTIVE", bank: true });
  const earners = made.filter((p) => p.status === "ACTIVE" || p.status === "SUSPENDED");

  // Customers: some have an account sourced by a partner, some are leads that carry a partner's code.
  let c = 0;
  const mkClient = (extra: Record<string, unknown> = {}) => {
    c++;
    return prisma.client.create({ data: { clientCode: `SYN-P${String(c).padStart(4, "0")}`, name: `${pick(GIVEN)} ${pick(FAMILY)}`, currentStageId: stage.id, leadSource: pick(["Web", "Referral", "App", "Partner"]), createdAt: new Date(NOW.getTime() - between(2, 240) * 86400000), ...extra } });
  };
  const accounts: { id: string; clientId: string; partner: P }[] = [];
  for (let i = 0; i < 170; i++) {
    const partner = i < 18 ? earners[0] : pick(earners.concat(earners.slice(0, 6))); // the distributor sources a few clients of their own
    const cl = await mkClient();
    const acc = await prisma.tradingAccount.create({ data: { accountNumber: `SYN-P-${String(i + 1).padStart(4, "0")}`, clientId: cl.id, accountType: "EQUITY", status: pick(["ACTIVE", "ACTIVE", "ACTIVE", "DORMANT", "CLOSED"] as const), sourcingPartnerId: partner.id, openedAt: cl.createdAt } });
    accounts.push({ id: acc.id, clientId: cl.id, partner });
  }
  for (let i = 0; i < 45; i++) {
    const partner = pick(made);
    const viaText = rnd() > 0.6;
    const lead = await mkClient(viaText ? { referralSource: partner.code.toLowerCase() } : { leadAttribution: { campaign: pick(["diwali", "sip-push", "app-launch"]) } });
    if (!viaText) {
      const lapsed = rnd() > 0.8;
      await prisma.partnerReferralTouch.create({ data: { clientId: lead.id, partnerProfileId: partner.id, code: partner.code, source: rnd() > 0.5 ? "web" : "app", touchedAt: new Date(NOW.getTime() - (lapsed ? 120 : between(1, 80)) * 86400000), expiresAt: new Date(NOW.getTime() + (lapsed ? -30 : between(5, 80)) * 86400000) } });
    }
  }
  for (let i = 0; i < 25; i++) await mkClient(); // unattributed: must never appear in the workspace

  // Revenue and accruals over the last eight months, computed by the real rule engine.
  const ruleInputs = async (planIdx: number): Promise<CommissionRuleInput[]> => {
    const rules = await prisma.commissionRule.findMany({ where: { commissionPlanId: plans[planIdx].plan.id }, include: { slabs: true } });
    return rules.map((r) => ({ id: r.id, productCategory: r.productCategory, transactionType: r.transactionType, rateType: r.rateType, percentRate: r.percentRate === null ? null : Number(r.percentRate), flatRate: r.flatRate === null ? null : Number(r.flatRate), validFrom: r.validFrom, validTo: r.validTo, slabs: r.slabs.map((s) => ({ minAmount: Number(s.minAmount), maxAmount: s.maxAmount === null ? null : Number(s.maxAmount), rate: Number(s.rate) })) }));
  };
  const rulesByPlan = [await ruleInputs(0), await ruleInputs(1), await ruleInputs(2)];
  let ev = 0;
  for (const a of accounts) {
    for (let k = between(2, 9); k > 0; k--) {
      const eventDate = new Date(NOW.getTime() - between(1, 225) * 86400000);
      const gross = Math.round((300 + rnd() * rnd() * 60000) * 100) / 100;
      const e = await prisma.revenueEvent.create({ data: { sourceSystem: "syn-seed", externalRef: `ev-${++ev}`, tradingAccountId: a.id, clientId: a.clientId, revenueType: pick(["BROKERAGE", "BROKERAGE", "TRAIL_COMMISSION"] as const), grossRevenueAmount: gross, eventDate, rawPayload: {} } });
      const res = computeAccrual({ grossRevenueAmount: gross, eventDate, productCategory: null, transactionType: null }, rulesByPlan[a.partner.planIdx]);
      if (res) await prisma.commissionAccrual.create({ data: { revenueEventId: e.id, partnerProfileId: a.partner.id, commissionRuleId: res.commissionRuleId, accrualAmount: res.accrualAmount, accrualDate: eventDate, computationVersion: COMPUTATION_VERSION } });
    }
  }
  // A few reversals (negative accruals).
  const some = await prisma.commissionAccrual.findMany({ where: { revenueEvent: { sourceSystem: "syn-seed" } }, take: 6, orderBy: { accrualAmount: "desc" }, include: { revenueEvent: true } });
  for (const s of some) {
    const rev = await prisma.revenueEvent.create({ data: { sourceSystem: "syn-seed", externalRef: `rev-${s.id}`, tradingAccountId: s.revenueEvent.tradingAccountId, clientId: s.revenueEvent.clientId, revenueType: "BROKERAGE", grossRevenueAmount: -Number(s.revenueEvent.grossRevenueAmount) / 4, eventDate: new Date(s.accrualDate.getTime() + 5 * 86400000), rawPayload: {}, reversesEventId: null } });
    await prisma.commissionAccrual.create({ data: { revenueEventId: rev.id, partnerProfileId: s.partnerProfileId, commissionRuleId: s.commissionRuleId, accrualAmount: -Number(s.accrualAmount) / 4, accrualDate: rev.eventDate, computationVersion: COMPUTATION_VERSION } });
  }

  // Payout runs: April to September approved or finalised (the oldest reconciled outside), October a draft.
  const maker = finUser;
  const periods: [number, number][] = [[2026, 3], [2026, 4], [2026, 5], [2026, 6], [2026, 7], [2026, 8], [2026, 9]];
  for (const [y, m] of periods) {
    const start = monthStart(y, m);
    const end = monthStart(y, m + 1);
    const state = m === 9 ? "DRAFT" : m === 8 ? "PENDING_APPROVAL" : m === 7 ? "APPROVED" : "FINALIZED";
    const run = await prisma.payoutRun.create({ data: { periodStart: start, periodEnd: end, createdById: maker.id } });
    await buildPayoutRun(run.id);
    if (state === "DRAFT") continue;
    await prisma.payoutRun.update({ where: { id: run.id }, data: { status: state, ...(state === "APPROVED" || state === "FINALIZED" ? { approvedById: admin.id, approvedAt: new Date(end.getTime() + 2 * 86400000) } : {}), ...(state === "FINALIZED" ? { finalizedAt: new Date(end.getTime() + 4 * 86400000) } : {}) } });
    if (state === "PENDING_APPROVAL") continue;
    const payouts = await prisma.payout.findMany({ where: { payoutRunId: run.id } });
    for (const p of payouts) {
      const recon = state === "FINALIZED" && m <= 5;
      await prisma.payout.update({ where: { id: p.id }, data: { status: recon ? "RECONCILED_EXTERNALLY" : "APPROVED", ...(recon ? { externalPayoutRef: `UTR${between(10000000, 99999999)}`, reconciledAt: new Date(end.getTime() + 6 * 86400000) } : {}) } });
      await prisma.commissionAccrual.updateMany({ where: { payoutLines: { some: { payoutId: p.id } } }, data: { status: "INCLUDED_IN_PAYOUT" } });
      if (rnd() > 0.82) {
        const amount = -Math.round(rnd() * 400 * 100) / 100;
        await prisma.commissionAdjustment.create({ data: { partnerProfileId: p.partnerProfileId, payoutId: p.id, amount, reason: pick(["Clawback: client reversed trade", "Correction: duplicate brokerage entry", "Goodwill adjustment agreed with the partner"]), approvalRequestId: rnd() > 0.2 ? `ar-${between(1000, 9999)}` : null, createdById: admin.id } });
        await prisma.payout.update({ where: { id: p.id }, data: { adjustmentAmount: amount, netPayableAmount: Number(p.totalAccrualAmount) + amount } });
      }
    }
  }

  // Team manager sees a few partners of the first branch.
  const mgrPartners = made.slice(2, 7);
  await prisma.hierarchyAssignment.deleteMany({ where: { parentUserId: tmUser.id } });
  for (const p of mgrPartners) await prisma.hierarchyAssignment.create({ data: { relationType: "MANAGES_TEAM", parentUserId: tmUser.id, assigneePartnerId: p.id, createdById: admin.id } });

  // Tax rules (as if approved by a second person), an override rule, branding, referral link.
  const fin2 = await prisma.user.findUniqueOrThrow({ where: { email: "ui-fin2@example.test" } });
  await prisma.partnerTaxRule.deleteMany({});
  await prisma.partnerOverrideRule.deleteMany({});
  await prisma.partnerTaxRule.createMany({ data: [
    { kind: "TDS", label: "Section 194-H (sample)", ratePercent: 5, thresholdAmount: 20000, partnerTypes: [], panStatus: "PRESENT", effectiveFrom: new Date("2026-03-31T18:30:00Z"), createdById: finUser.id, approvedById: fin2.id },
    { kind: "TDS", label: "Section 206-AA (sample)", ratePercent: 20, thresholdAmount: null, partnerTypes: [], panStatus: "ABSENT", effectiveFrom: new Date("2026-03-31T18:30:00Z"), createdById: finUser.id, approvedById: fin2.id },
    { kind: "GST", label: "GST (sample)", ratePercent: 18, partnerTypes: [], gstRegistration: "UNREGISTERED", gstMode: "REVERSE_CHARGE", effectiveFrom: new Date("2026-03-31T18:30:00Z"), createdById: finUser.id, approvedById: fin2.id },
  ] });
  await prisma.partnerOverrideRule.create({ data: { level: 1, ratePercent: 2, capPerAccrual: 250, effectiveFrom: new Date("2026-03-31T18:30:00Z"), createdById: finUser.id, approvedById: fin2.id } });
  const setting = (key: string, value: object) => prisma.partnerWorkspaceSetting.upsert({ where: { key }, update: { value, updatedById: finUser.id }, create: { key, value, updatedById: finUser.id } });
  await setting("letterhead", { lines: ["Sample Wealth Partners Pvt Ltd", "12 Example Street, Sampletown 400001"] });
  await setting("registration", { text: "Sample registration no. SR-000000 (synthetic text for a screenshot)" });
  await setting("referral", { linkBase: "https://forms.example.test/join", lapseDays: 90 });
  // Pending proposal from Finance, waiting for a second person.
  await prisma.approvalRequest.deleteMany({ where: { actionType: { in: ["PARTNER_TAX_RULE_CHANGE", "PARTNER_OVERRIDE_RULE_CHANGE"] } } });
  await prisma.approvalRequest.create({ data: { actionType: "PARTNER_TAX_RULE_CHANGE", entity: "PartnerTaxRule", entityId: "new", payload: { op: "create", rule: { kind: "TDS", label: "Section X (proposed)", ratePercent: "10", thresholdAmount: "30000", effectiveFrom: "2026-11-01" } }, reason: "Add tax rule: Section X (proposed): 10% on the financial year's total once it passes ₹30,000. Applies to every partner. Effective 1 Nov 2026", requestedById: finUser.id } });
  // Override accruals from the rule (the real generator).
  const { generateOverrideAccruals } = await import("../../src/lib/partners/overrides/generate");
  console.log("overrides", await generateOverrideAccruals(prisma as never));

  const counts = {
    partners: await prisma.partnerProfile.count({ where: { partnerCode: { startsWith: "PTR-S" } } }),
    clients: await prisma.client.count({ where: { clientCode: { startsWith: "SYN-P" } } }),
    accruals: await prisma.commissionAccrual.count({ where: { revenueEvent: { sourceSystem: "syn-seed" } } }),
    runs: await prisma.payoutRun.count(),
    adjustments: await prisma.commissionAdjustment.count(),
  };
  console.log("Synthetic partner data ready:", counts);
}

main().finally(() => prisma.$disconnect());
