// Distribution OS demo seed data — Company -> Team -> Partner (Workstream 1) and
// Household -> TradingAccount -> Position/Transaction (Workstream 2).
//
// Phase 1 is idempotent (upsert-based, deterministic IDs for join rows), following
// prisma/seed.ts's convention exactly, and is runnable the moment Workstream 1's migration is
// applied. Phase 2 needs Workstream 2's schema (TradingAccount etc.) — guarded in main() below so
// this script never fails on a database that only has Workstream 1 applied; RevenueEvent
// (Workstream 3) still doesn't exist, so no revenue rows are seeded yet.
import "dotenv/config";
import bcrypt from "bcryptjs";

import { prisma } from "../src/lib/db/prisma";
import { generateHouseholdCode } from "../src/lib/policy/household-code";
import { computeAccrual, COMPUTATION_VERSION, type CommissionRuleInput } from "../src/lib/earnings/compute-accruals";
import { buildPayoutRun } from "../src/lib/earnings/build-payout-run";
import { requestApproval } from "../src/lib/policy/approvals/service";
// Side-effect import: populates the ApprovalDefinition registry (normally done once by the
// dashboard layout on app startup) — requestApproval() below needs it registered to work at all.
import "../src/lib/policy/approvals/registry-init";
import type { RevenueType, TransactionType } from "../src/generated/prisma/client";

async function seedPhase1OrgHierarchy() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const company = await prisma.company.upsert({
    where: { code: "ALLVEST" },
    update: {},
    create: { name: "Allvest Securities", code: "ALLVEST" },
  });

  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@supportify.local" } });

  const partnerTeamManager = await prisma.user.upsert({
    where: { email: "teammgr@supportify.local" },
    update: {},
    create: {
      name: "Team Manager Tara",
      email: "teammgr@supportify.local",
      passwordHash,
      role: "TEAM_MANAGER",
      managerId: admin.id,
    },
  });

  await prisma.user.upsert({
    where: { email: "finance@supportify.local" },
    update: {},
    create: {
      name: "Finance Fiona",
      email: "finance@supportify.local",
      passwordHash,
      role: "FINANCE",
      managerId: admin.id,
    },
  });

  const partnerTeam = await prisma.team.upsert({
    where: { code: "PTR-TEAM-01" },
    update: { teamManagerId: partnerTeamManager.id },
    create: {
      companyId: company.id,
      name: "North Partner Team",
      code: "PTR-TEAM-01",
      type: "PARTNER_TEAM",
      teamManagerId: partnerTeamManager.id,
    },
  });

  const distributorUser = await prisma.user.upsert({
    where: { email: "distributor1@supportify.local" },
    update: {},
    create: { name: "Distributor Deepak", email: "distributor1@supportify.local", passwordHash, role: "DISTRIBUTOR" },
  });
  const distributorProfile = await prisma.partnerProfile.upsert({
    where: { userId: distributorUser.id },
    update: {},
    create: {
      userId: distributorUser.id,
      partnerCode: "PTR-00001",
      partnerType: "DISTRIBUTOR",
      tier: "GOLD",
      empanelmentStatus: "ACTIVE",
      empanelmentDate: new Date(),
    },
  });

  await prisma.hierarchyAssignment.upsert({
    where: { id: "seed-team-member-distributor" },
    update: {},
    create: {
      id: "seed-team-member-distributor",
      relationType: "TEAM_MEMBER",
      assigneePartnerId: distributorProfile.id,
      teamId: partnerTeam.id,
      createdById: admin.id,
    },
  });

  const PARTNER_SEEDS = [
    { name: "Priya Partner", isAffiliate: false },
    { name: "Rahul Referrer", isAffiliate: false },
    { name: "Anita Affiliate", isAffiliate: true },
  ];

  for (const [i, seed] of PARTNER_SEEDS.entries()) {
    const email = `partner${i + 1}@supportify.local`;
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { name: seed.name, email, passwordHash, role: seed.isAffiliate ? "AFFILIATE" : "PARTNER" },
    });
    const profile = await prisma.partnerProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        partnerCode: `PTR-0000${i + 2}`,
        partnerType: seed.isAffiliate ? "AFFILIATE" : "PARTNER",
        tier: "SILVER",
        empanelmentStatus: "ACTIVE",
        empanelmentDate: new Date(),
        parentPartnerProfileId: seed.isAffiliate ? distributorProfile.id : null,
      },
    });

    await prisma.hierarchyAssignment.upsert({
      where: { id: `seed-team-member-${profile.id}` },
      update: {},
      create: {
        id: `seed-team-member-${profile.id}`,
        relationType: "TEAM_MEMBER",
        assigneePartnerId: profile.id,
        teamId: partnerTeam.id,
        createdById: admin.id,
      },
    });
  }

  console.log("Phase 1 seeded: Company, Team, Partner hierarchy (Workstream 1 only).");
  console.log("New logins (password: password123): teammgr@supportify.local, finance@supportify.local, distributor1@supportify.local, partner1@supportify.local, partner2@supportify.local, partner3@supportify.local");
}

const DEMO_PRODUCTS = [
  { productCode: "DEMO-EQ-01", name: "Demo Bluechip Equity Fund", category: "MUTUAL_FUND" as const },
  { productCode: "DEMO-EQ-02", name: "Demo Smallcap Growth Fund", category: "MUTUAL_FUND" as const },
];

async function seedPhase2ClientAccountsAndHoldings() {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@supportify.local" } });

  const clients = await prisma.client.findMany({
    where: { isDeleted: false },
    orderBy: { createdAt: "asc" },
    take: 4,
  });
  if (clients.length === 0) {
    console.log("Phase 2 skipped: no seeded clients found (run prisma/seed-perf.ts or create clients first).");
    return;
  }

  const products = await Promise.all(
    DEMO_PRODUCTS.map((p) =>
      prisma.product.upsert({
        where: { productCode: p.productCode },
        update: {},
        create: { ...p, sourceSystem: "seed", externalRef: p.productCode },
      }),
    ),
  );

  // Group the first two seeded clients into one demo household (a plausible "family" grouping);
  // every seeded client gets its own trading account regardless of household membership.
  if (clients.length >= 2) {
    const household = await prisma.household.upsert({
      where: { householdCode: "HH-00001" },
      update: {},
      create: { householdCode: await generateHouseholdCode(), name: `The ${clients[0].name.split(" ").pop()} Family` },
    });
    for (const [i, client] of clients.slice(0, 2).entries()) {
      await prisma.householdMember.upsert({
        where: { householdId_clientId: { householdId: household.id, clientId: client.id } },
        update: {},
        create: { householdId: household.id, clientId: client.id, isPrimary: i === 0, relationship: i === 0 ? "Self" : "Spouse" },
      });
    }
  }

  for (const [i, client] of clients.entries()) {
    const accountNumber = `SEED-ACC-${String(i + 1).padStart(3, "0")}`;
    const account = await prisma.tradingAccount.upsert({
      where: { accountNumber },
      update: {},
      create: {
        accountNumber,
        clientId: client.id,
        accountType: "MUTUAL_FUND",
        sourceSystem: "seed",
        externalRef: accountNumber,
        rmAtOpeningId: client.assignedToId ?? admin.id,
      },
    });

    const product = products[i % products.length];
    const positionRef = `seed-pos-${accountNumber}`;
    // Truncated to the calendar day (not new Date()'s current millisecond) so re-running this
    // script on the same day genuinely upserts the same Position row instead of creating a fresh
    // snapshot every run — asOfDate is part of Position's idempotency key.
    const asOfDate = new Date(new Date().toISOString().slice(0, 10));
    await prisma.position.upsert({
      where: { sourceSystem_externalRef_asOfDate: { sourceSystem: "seed", externalRef: positionRef, asOfDate } },
      update: {},
      create: {
        tradingAccountId: account.id,
        productId: product.id,
        quantity: 100 + i * 25,
        avgCost: 100,
        currentValue: (100 + i * 25) * 115, // a plausible mark-up over cost
        asOfDate,
        sourceSystem: "seed",
        externalRef: positionRef,
      },
    });

    const transactionRef = `seed-txn-${accountNumber}`;
    await prisma.transaction.upsert({
      where: { sourceSystem_externalRef: { sourceSystem: "seed", externalRef: transactionRef } },
      update: {},
      create: {
        tradingAccountId: account.id,
        productId: product.id,
        transactionType: "BUY",
        transactionDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        quantity: 100 + i * 25,
        price: 100,
        grossAmount: (100 + i * 25) * 100,
        netAmount: (100 + i * 25) * 100 + 50,
        brokerageAmount: 50,
        sourceSystem: "seed",
        externalRef: transactionRef,
      },
    });
  }

  console.log(`Phase 2 seeded: ${clients.length} trading accounts with holdings/transactions, 1 demo household.`);
}

/**
 * Wires one real commission plan/rule/assignment to the seeded Distributor and one seeded
 * TradingAccount, then runs the same sync-revenue -> recompute-accrual pipeline the real
 * /earnings actions use (duplicated here rather than imported, since syncRevenueFromTransactionsAction/
 * recomputeAccrualsAction are auth-gated Server Actions that can't run outside a request scope —
 * same precedent as the households import actions' auth-gated-wrapper-vs-core-logic split). Gives
 * every Workstream 3 verification step real data: a non-zero CommissionAccrual to build a payout
 * run from.
 */
async function seedPhase3EarningsEngine() {
  const distributorProfile = await prisma.partnerProfile.findUnique({ where: { partnerCode: "PTR-00001" } });
  if (!distributorProfile) {
    console.log("Phase 3 skipped: seed Distributor PartnerProfile not found (run Phase 1 first).");
    return;
  }
  const seedAccount = await prisma.tradingAccount.findUnique({ where: { accountNumber: "SEED-ACC-001" } });
  if (!seedAccount) {
    console.log("Phase 3 skipped: no seeded TradingAccount found (run Phase 2 first).");
    return;
  }
  await prisma.tradingAccount.update({ where: { id: seedAccount.id }, data: { sourcingPartnerId: distributorProfile.id } });

  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@supportify.local" } });

  const plan = await prisma.commissionPlan.upsert({
    where: { code: "SEED-PLAN-01" },
    update: {},
    create: { code: "SEED-PLAN-01", name: "Demo Standard Plan" },
  });

  const rule =
    (await prisma.commissionRule.findFirst({ where: { commissionPlanId: plan.id } })) ??
    (await prisma.commissionRule.create({
      data: {
        commissionPlanId: plan.id,
        rateType: "PERCENT_OF_GROSS",
        percentRate: 10,
        validFrom: new Date("2020-01-01"),
        createdById: admin.id,
      },
    }));

  await prisma.partnerCommissionAssignment.upsert({
    where: { id: `seed-assignment-${distributorProfile.id}` },
    update: {},
    create: {
      id: `seed-assignment-${distributorProfile.id}`,
      partnerProfileId: distributorProfile.id,
      commissionPlanId: plan.id,
      validFrom: new Date("2020-01-01"),
      assignedById: admin.id,
    },
  });

  // Sync BROKERAGE RevenueEvents from the seeded transactions — same idempotent
  // (sourceSystem, externalRef) upsert key as syncRevenueFromTransactionsAction.
  const transactions = await prisma.transaction.findMany({
    where: { sourceSystem: "seed", brokerageAmount: { not: null } },
    include: { tradingAccount: { select: { clientId: true } } },
  });
  for (const txn of transactions) {
    await prisma.revenueEvent.upsert({
      where: { sourceSystem_externalRef: { sourceSystem: "txn_sync", externalRef: txn.id } },
      update: {},
      create: {
        sourceSystem: "txn_sync",
        externalRef: txn.id,
        transactionId: txn.id,
        tradingAccountId: txn.tradingAccountId,
        clientId: txn.tradingAccount.clientId,
        revenueType: "BROKERAGE",
        grossRevenueAmount: txn.brokerageAmount!,
        eventDate: txn.transactionDate,
        rawPayload: { transactionId: txn.id, brokerageAmount: Number(txn.brokerageAmount) },
      },
    });
  }

  // Recompute accruals for every synced event whose account has a sourcing partner — same
  // computeAccrual() + @@unique upsert key as recomputeAccrualsAction.
  const events = await prisma.revenueEvent.findMany({
    where: { sourceSystem: "txn_sync" },
    include: {
      transaction: { select: { transactionType: true, product: { select: { category: true } } } },
      tradingAccount: { select: { sourcingPartnerId: true } },
    },
  });
  const ruleInputs: CommissionRuleInput[] = [
    {
      id: rule.id,
      productCategory: rule.productCategory,
      transactionType: rule.transactionType,
      rateType: rule.rateType,
      percentRate: rule.percentRate !== null ? Number(rule.percentRate) : null,
      flatRate: rule.flatRate !== null ? Number(rule.flatRate) : null,
      validFrom: rule.validFrom,
      validTo: rule.validTo,
      slabs: [],
    },
  ];

  let accrualCount = 0;
  for (const event of events) {
    const partnerProfileId = event.tradingAccount?.sourcingPartnerId;
    if (!partnerProfileId) continue;

    const result = computeAccrual(
      {
        grossRevenueAmount: Number(event.grossRevenueAmount),
        eventDate: event.eventDate,
        productCategory: event.transaction?.product?.category ?? null,
        transactionType: event.transaction?.transactionType ?? null,
      },
      ruleInputs,
    );
    if (!result) continue;

    await prisma.commissionAccrual.upsert({
      where: {
        revenueEventId_partnerProfileId_commissionRuleId: {
          revenueEventId: event.id,
          partnerProfileId,
          commissionRuleId: result.commissionRuleId,
        },
      },
      update: { accrualAmount: result.accrualAmount, computationVersion: COMPUTATION_VERSION },
      create: {
        revenueEventId: event.id,
        partnerProfileId,
        commissionRuleId: result.commissionRuleId,
        accrualAmount: result.accrualAmount,
        accrualDate: event.eventDate,
        computationVersion: COMPUTATION_VERSION,
      },
    });
    accrualCount++;
  }

  console.log(`Phase 3 seeded: 1 CommissionPlan/Rule/Assignment, ${transactions.length} revenue event(s) synced, ${accrualCount} accrual(s) computed.`);
}

/**
 * Removes two specific dead rows left over from earlier manual verification testing this session —
 * a PayoutRun permanently stuck in PENDING_APPROVAL (self-requested by the Admin user, which the
 * maker-checker rule means can never be approved by that same Admin) and an empty 0-payout DRAFT
 * run. Identified by their exact (periodStart, periodEnd) — deliberately NOT a generic "any stuck
 * approval" query, so this can never accidentally sweep up a real payout run an Admin creates later
 * through the actual app. Their CommissionAccruals were never flipped to INCLUDED_IN_PAYOUT (that
 * only happens on approval, which never happened for either), so they're safely still ACCRUED and
 * available to a fresh run — nothing about the real ledger is lost.
 */
async function cleanupStaleTestPayoutRuns() {
  const deadRunPeriods = [
    { periodStart: new Date("2026-01-01T00:00:00.000Z"), periodEnd: new Date("2026-12-31T00:00:00.000Z") },
    { periodStart: new Date("2026-09-01T00:00:00.000Z"), periodEnd: new Date("2026-09-30T00:00:00.000Z") },
  ];
  let removed = 0;
  for (const period of deadRunPeriods) {
    const run = await prisma.payoutRun.findFirst({ where: period });
    if (!run) continue;
    const payouts = await prisma.payout.findMany({ where: { payoutRunId: run.id }, select: { id: true } });
    const payoutIds = payouts.map((p) => p.id);
    await prisma.approvalRequest.deleteMany({ where: { entity: "PayoutRun", entityId: run.id } });
    await prisma.approvalRequest.deleteMany({ where: { entity: "Payout", entityId: { in: payoutIds } } });
    await prisma.commissionAdjustment.deleteMany({ where: { payoutId: { in: payoutIds } } });
    await prisma.payoutLine.deleteMany({ where: { payoutId: { in: payoutIds } } });
    await prisma.payout.deleteMany({ where: { payoutRunId: run.id } });
    await prisma.payoutRun.delete({ where: { id: run.id } });
    removed++;
  }
  if (removed > 0) console.log(`Cleanup: removed ${removed} stale test payout run(s) and their orphaned approval requests.`);

  // Any PENDING ApprovalRequest requested BY the Admin account is provably stuck forever — the
  // maker-checker rule means that same Admin can never be the one to decide it, and this seed
  // context only ever has the one Admin account. Every one still sitting here is leftover test
  // debris from earlier manual verification (e.g. "Clawback for verification test"), not
  // legitimate pending work, so it's always safe to clear.
  const admin = await prisma.user.findUnique({ where: { email: "admin@supportify.local" } });
  if (admin) {
    const stuckAdminRequests = await prisma.approvalRequest.deleteMany({ where: { status: "PENDING", requestedById: admin.id } });
    if (stuckAdminRequests.count > 0) console.log(`Cleanup: removed ${stuckAdminRequests.count} permanently-stuck Admin-self-requested approval request(s).`);
  }
}

const DEMO_CLIENTS = [
  { clientCode: "CL-DEMO-01", name: "Rohan Malhotra", mobile: "9810000001", household: "malhotra" as const, relationship: "Self", isPrimary: true },
  { clientCode: "CL-DEMO-02", name: "Sunita Malhotra", mobile: "9810000002", household: "malhotra" as const, relationship: "Spouse", isPrimary: false },
  { clientCode: "CL-DEMO-03", name: "Vikram Chopra", mobile: "9810000003", household: "chopra" as const, relationship: "Self", isPrimary: true },
  { clientCode: "CL-DEMO-04", name: "Ananya Chopra", mobile: "9810000004", household: "chopra" as const, relationship: "Spouse", isPrimary: false },
  { clientCode: "CL-DEMO-05", name: "Karan Chopra", mobile: "9810000005", household: "chopra" as const, relationship: "Child", isPrimary: false },
  { clientCode: "CL-DEMO-06", name: "Arjun Bhatia", mobile: "9810000006", household: null, relationship: null, isPrimary: false },
];

const DEMO_ACCOUNTS = [
  { accountNumber: "DEMO-ACC-01", clientCode: "CL-DEMO-01", accountType: "MUTUAL_FUND" as const, partnerCode: "PTR-00002" },
  { accountNumber: "DEMO-ACC-02", clientCode: "CL-DEMO-02", accountType: "EQUITY" as const, partnerCode: "PTR-00003" },
  { accountNumber: "DEMO-ACC-03", clientCode: "CL-DEMO-03", accountType: "MUTUAL_FUND" as const, partnerCode: "PTR-00004" },
  { accountNumber: "DEMO-ACC-04", clientCode: "CL-DEMO-04", accountType: "PMS" as const, partnerCode: "PTR-00005" },
  { accountNumber: "DEMO-ACC-05", clientCode: "CL-DEMO-05", accountType: "MUTUAL_FUND" as const, partnerCode: "PTR-00002" },
  { accountNumber: "DEMO-ACC-06", clientCode: "CL-DEMO-06", accountType: "EQUITY" as const, partnerCode: "PTR-00001" },
];

const DEMO_PRODUCTS_EXTRA = [
  { productCode: "DEMO-PMS-01", name: "Demo Multi-Cap PMS", category: "PMS" as const },
  { productCode: "DEMO-STOCK-01", name: "Demo Blue Chip Equity", category: "EQUITY" as const },
];

const DEMO_TXN_SPECS: { type: TransactionType; daysAgo: number; grossAmount: number; brokerage: number | null }[] = [
  { type: "BUY", daysAgo: 20, grossAmount: 15000, brokerage: 75 },
  { type: "SIP", daysAgo: 10, grossAmount: 5000, brokerage: 25 },
  { type: "DIVIDEND", daysAgo: 3, grossAmount: 400, brokerage: null }, // dividends don't carry brokerage — realistic, and proves the sync correctly skips them
];

/**
 * Stakeholder-demo enrichment: realistically-named clients/households (replacing reliance on
 * "Test Client One/Two" for this specific demo), a sourcing partner + commission activity spread
 * across all 5 partners (only 2 had any before), a SLAB and a FLAT_PER_TRANSACTION commission plan
 * alongside the existing flat-percent one so all three rate types are demonstrable, and — the part
 * that actually makes Approval Workflows demoable — one payout run plus two more approval requests,
 * all requested by Finance/Manager (never Admin), so logging in as Admin during the demo lets you
 * click Approve and watch it actually resolve, instead of repeating the "stuck forever" problem
 * cleaned up above. Idempotent throughout: every row is upserted by a fixed key, and every
 * "seed a pending approval" step is guarded so re-running never piles up duplicates.
 */
async function seedPhase4StakeholderDemo() {
  await cleanupStaleTestPayoutRuns();

  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@supportify.local" } });
  const finance = await prisma.user.findFirst({ where: { role: "FINANCE" } });
  const manager = await prisma.user.findFirst({ where: { role: "MANAGER" } });
  const rm = await prisma.user.findFirst({ where: { role: "RM", isActive: true } });
  const kycCompletedStage = await prisma.stage.findUnique({ where: { name: "KYC completed" } });

  if (!finance || !manager || !rm || !kycCompletedStage) {
    console.log("Phase 4 skipped: expected seed users/stage not found (run Phase 1 and the default seed first).");
    return;
  }

  const clientByCode = new Map<string, { id: string; assignedToId: string | null }>();
  for (const c of DEMO_CLIENTS) {
    const client = await prisma.client.upsert({
      where: { clientCode: c.clientCode },
      update: {},
      create: { clientCode: c.clientCode, name: c.name, mobile: c.mobile, currentStageId: kycCompletedStage.id, assignedToId: rm.id },
    });
    clientByCode.set(c.clientCode, client);
  }

  const households = {
    malhotra: await prisma.household.upsert({ where: { householdCode: "HH-DEMO-01" }, update: {}, create: { householdCode: "HH-DEMO-01", name: "The Malhotra Family" } }),
    chopra: await prisma.household.upsert({ where: { householdCode: "HH-DEMO-02" }, update: {}, create: { householdCode: "HH-DEMO-02", name: "The Chopra Family" } }),
  };
  for (const c of DEMO_CLIENTS) {
    if (!c.household) continue;
    const client = clientByCode.get(c.clientCode)!;
    const household = households[c.household];
    await prisma.householdMember.upsert({
      where: { householdId_clientId: { householdId: household.id, clientId: client.id } },
      update: {},
      create: { householdId: household.id, clientId: client.id, isPrimary: c.isPrimary, relationship: c.relationship ?? undefined },
    });
  }

  const allProducts = await Promise.all(
    [...DEMO_PRODUCTS, ...DEMO_PRODUCTS_EXTRA].map((p) =>
      prisma.product.upsert({ where: { productCode: p.productCode }, update: {}, create: { ...p, sourceSystem: "seed", externalRef: p.productCode } }),
    ),
  );

  const partnerByCode = new Map<string, { id: string }>();
  for (const code of new Set(DEMO_ACCOUNTS.map((a) => a.partnerCode))) {
    const partner = await prisma.partnerProfile.findUnique({ where: { partnerCode: code } });
    if (partner) partnerByCode.set(code, partner);
  }

  const asOfDate = new Date(new Date().toISOString().slice(0, 10));
  for (const [i, a] of DEMO_ACCOUNTS.entries()) {
    const client = clientByCode.get(a.clientCode)!;
    const sourcingPartnerId = partnerByCode.get(a.partnerCode)?.id ?? null;
    const account = await prisma.tradingAccount.upsert({
      where: { accountNumber: a.accountNumber },
      update: { sourcingPartnerId },
      create: {
        accountNumber: a.accountNumber,
        clientId: client.id,
        accountType: a.accountType,
        sourceSystem: "seed",
        externalRef: a.accountNumber,
        rmAtOpeningId: client.assignedToId ?? admin.id,
        sourcingPartnerId,
      },
    });

    for (let p = 0; p < 2; p++) {
      const product = allProducts[(i + p) % allProducts.length];
      const positionRef = `demo-pos-${a.accountNumber}-${p}`;
      const quantity = 50 + i * 10 + p * 20;
      await prisma.position.upsert({
        where: { sourceSystem_externalRef_asOfDate: { sourceSystem: "seed", externalRef: positionRef, asOfDate } },
        update: {},
        create: {
          tradingAccountId: account.id,
          productId: product.id,
          quantity,
          avgCost: 100 + p * 15,
          currentValue: quantity * (110 + p * 20),
          asOfDate,
          sourceSystem: "seed",
          externalRef: positionRef,
        },
      });
    }

    for (const [t, spec] of DEMO_TXN_SPECS.entries()) {
      const transactionRef = `demo-txn-${a.accountNumber}-${t}`;
      const product = allProducts[(i + t) % allProducts.length];
      const grossAmount = spec.grossAmount + i * 250;
      await prisma.transaction.upsert({
        where: { sourceSystem_externalRef: { sourceSystem: "seed", externalRef: transactionRef } },
        update: {},
        create: {
          tradingAccountId: account.id,
          productId: product.id,
          transactionType: spec.type,
          transactionDate: new Date(Date.now() - spec.daysAgo * 24 * 60 * 60 * 1000),
          grossAmount,
          netAmount: grossAmount - (spec.brokerage ?? 0),
          brokerageAmount: spec.brokerage,
          sourceSystem: "seed",
          externalRef: transactionRef,
        },
      });
    }
  }

  // Two more commission plans alongside Phase 3's flat-10% one, so the demo shows all three rate
  // types side by side: SLAB for the two PARTNER-type partners, FLAT_PER_TRANSACTION for the two
  // AFFILIATE-type partners.
  const slabPlan = await prisma.commissionPlan.upsert({ where: { code: "DEMO-PLAN-SLAB" }, update: {}, create: { code: "DEMO-PLAN-SLAB", name: "Demo Tiered Partner Plan" } });
  const slabRule =
    (await prisma.commissionRule.findFirst({ where: { commissionPlanId: slabPlan.id } })) ??
    (await prisma.commissionRule.create({ data: { commissionPlanId: slabPlan.id, rateType: "SLAB", validFrom: new Date("2020-01-01"), createdById: admin.id } }));
  if ((await prisma.commissionSlab.count({ where: { commissionRuleId: slabRule.id } })) === 0) {
    await prisma.commissionSlab.createMany({
      data: [
        { commissionRuleId: slabRule.id, minAmount: 0, maxAmount: 10000, rate: 5 },
        { commissionRuleId: slabRule.id, minAmount: 10000, maxAmount: null, rate: 8 },
      ],
    });
  }

  const flatPlan = await prisma.commissionPlan.upsert({ where: { code: "DEMO-PLAN-FLAT" }, update: {}, create: { code: "DEMO-PLAN-FLAT", name: "Demo Flat Affiliate Plan" } });
  const existingFlatRule = await prisma.commissionRule.findFirst({ where: { commissionPlanId: flatPlan.id } });
  if (!existingFlatRule) {
    await prisma.commissionRule.create({
      data: { commissionPlanId: flatPlan.id, rateType: "FLAT_PER_TRANSACTION", flatRate: 100, validFrom: new Date("2020-01-01"), createdById: admin.id },
    });
  }

  for (const { partnerCode, planId } of [
    { partnerCode: "PTR-00002", planId: slabPlan.id },
    { partnerCode: "PTR-00003", planId: slabPlan.id },
    { partnerCode: "PTR-00004", planId: flatPlan.id },
    { partnerCode: "PTR-00005", planId: flatPlan.id },
  ]) {
    const partner = partnerByCode.get(partnerCode) ?? (await prisma.partnerProfile.findUnique({ where: { partnerCode } }));
    if (!partner) continue;
    await prisma.partnerCommissionAssignment.upsert({
      where: { id: `demo-assignment-${partner.id}` },
      update: {},
      create: { id: `demo-assignment-${partner.id}`, partnerProfileId: partner.id, commissionPlanId: planId, validFrom: new Date("2020-01-01"), assignedById: admin.id },
    });
  }

  // Sync BROKERAGE RevenueEvents from the new demo transactions — same logic as
  // syncRevenueFromTransactionsAction.
  const demoTransactions = await prisma.transaction.findMany({
    where: { sourceSystem: "seed", externalRef: { startsWith: "demo-txn-" }, brokerageAmount: { not: null } },
    include: { tradingAccount: { select: { clientId: true } } },
  });
  for (const txn of demoTransactions) {
    await prisma.revenueEvent.upsert({
      where: { sourceSystem_externalRef: { sourceSystem: "txn_sync", externalRef: txn.id } },
      update: {},
      create: {
        sourceSystem: "txn_sync",
        externalRef: txn.id,
        transactionId: txn.id,
        tradingAccountId: txn.tradingAccountId,
        clientId: txn.tradingAccount.clientId,
        revenueType: "BROKERAGE",
        grossRevenueAmount: txn.brokerageAmount!,
        eventDate: txn.transactionDate,
        rawPayload: { transactionId: txn.id, brokerageAmount: Number(txn.brokerageAmount) },
      },
    });
  }

  // A couple of non-transaction revenue types, CSV-import style, to show revenue-type variety.
  const csvRevenueSpecs: { externalRef: string; accountNumber: string; revenueType: RevenueType; amount: number }[] = [
    { externalRef: "demo-csv-rev-01", accountNumber: "DEMO-ACC-01", revenueType: "TRAIL_COMMISSION", amount: 1200 },
    { externalRef: "demo-csv-rev-02", accountNumber: "DEMO-ACC-03", revenueType: "ADVISORY_FEE", amount: 800 },
  ];
  for (const spec of csvRevenueSpecs) {
    const account = await prisma.tradingAccount.findUnique({ where: { accountNumber: spec.accountNumber }, select: { id: true, clientId: true } });
    if (!account) continue;
    await prisma.revenueEvent.upsert({
      where: { sourceSystem_externalRef: { sourceSystem: "csv_import", externalRef: spec.externalRef } },
      update: {},
      create: {
        sourceSystem: "csv_import",
        externalRef: spec.externalRef,
        tradingAccountId: account.id,
        clientId: account.clientId,
        revenueType: spec.revenueType,
        grossRevenueAmount: spec.amount,
        eventDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        rawPayload: { note: "stakeholder demo seed" },
      },
    });
  }

  // Recompute accruals across every partner's active plan — same logic as recomputeAccrualsAction,
  // just with a per-partner rule cache since this pass spans far more partners than Phase 3 did.
  const allEvents = await prisma.revenueEvent.findMany({
    include: {
      transaction: { select: { transactionType: true, product: { select: { category: true } } } },
      tradingAccount: { select: { sourcingPartnerId: true } },
      accruals: { select: { status: true } },
    },
  });
  const ruleCache = new Map<string, CommissionRuleInput[]>();
  let newAccruals = 0;
  for (const event of allEvents) {
    if (event.accruals.some((a) => a.status === "INCLUDED_IN_PAYOUT")) continue;
    const partnerProfileId = event.tradingAccount?.sourcingPartnerId;
    if (!partnerProfileId) continue;

    let ruleInputs = ruleCache.get(partnerProfileId);
    if (!ruleInputs) {
      const assignment = await prisma.partnerCommissionAssignment.findFirst({
        where: { partnerProfileId, validFrom: { lte: event.eventDate }, OR: [{ validTo: null }, { validTo: { gt: event.eventDate } }] },
        orderBy: { validFrom: "desc" },
      });
      if (!assignment) {
        ruleCache.set(partnerProfileId, []);
        continue;
      }
      const rules = await prisma.commissionRule.findMany({ where: { commissionPlanId: assignment.commissionPlanId }, include: { slabs: true } });
      ruleInputs = rules.map((r) => ({
        id: r.id,
        productCategory: r.productCategory,
        transactionType: r.transactionType,
        rateType: r.rateType,
        percentRate: r.percentRate !== null ? Number(r.percentRate) : null,
        flatRate: r.flatRate !== null ? Number(r.flatRate) : null,
        validFrom: r.validFrom,
        validTo: r.validTo,
        slabs: r.slabs.map((s) => ({ minAmount: Number(s.minAmount), maxAmount: s.maxAmount !== null ? Number(s.maxAmount) : null, rate: Number(s.rate) })),
      }));
      ruleCache.set(partnerProfileId, ruleInputs);
    }
    if (ruleInputs.length === 0) continue;

    const result = computeAccrual(
      {
        grossRevenueAmount: Number(event.grossRevenueAmount),
        eventDate: event.eventDate,
        productCategory: event.transaction?.product?.category ?? null,
        transactionType: event.transaction?.transactionType ?? null,
      },
      ruleInputs,
    );
    if (!result) continue;

    await prisma.commissionAccrual.upsert({
      where: { revenueEventId_partnerProfileId_commissionRuleId: { revenueEventId: event.id, partnerProfileId, commissionRuleId: result.commissionRuleId } },
      update: { accrualAmount: result.accrualAmount, computationVersion: COMPUTATION_VERSION },
      create: { revenueEventId: event.id, partnerProfileId, commissionRuleId: result.commissionRuleId, accrualAmount: result.accrualAmount, accrualDate: event.eventDate, computationVersion: COMPUTATION_VERSION },
    });
    newAccruals++;
  }

  // One live, submittable payout run — a FIXED wide period (not relative to "today") so re-running
  // this script on a later day still finds the same row instead of creating a new one every day.
  // Requested by Finance, never Admin, specifically so logging in as Admin during the demo lets you
  // click Approve and watch it actually resolve.
  const demoPeriod = { periodStart: new Date("2020-01-01T00:00:00.000Z"), periodEnd: new Date("2030-01-01T00:00:00.000Z") };
  let demoRun = await prisma.payoutRun.findFirst({ where: demoPeriod });
  if (!demoRun) demoRun = await prisma.payoutRun.create({ data: { ...demoPeriod, createdById: finance.id } });

  if (demoRun.status === "DRAFT") {
    await buildPayoutRun(demoRun.id);
    const existingRequest = await prisma.approvalRequest.findFirst({ where: { entity: "PayoutRun", entityId: demoRun.id, status: "PENDING" } });
    if (!existingRequest) {
      await requestApproval(
        "PAYOUT_ADJUSTMENT",
        { entity: "PayoutRun", entityId: demoRun.id, payload: { payoutRunId: demoRun.id }, reason: "Quarterly partner payout ready for review" },
        { id: finance.id, role: finance.role },
      );
      await prisma.payoutRun.update({ where: { id: demoRun.id }, data: { status: "PENDING_APPROVAL" } });
    }
  }

  // A live commission-adjustment request, also Finance-requested — targets the LARGEST payout in
  // the run so a modest clawback reduces it without pushing it negative (which would look like a
  // data error rather than a realistic partial correction in a demo).
  if (!(await prisma.approvalRequest.findFirst({ where: { actionType: "COMMISSION_ADJUSTMENT", status: "PENDING" } }))) {
    const demoPayout = await prisma.payout.findFirst({ where: { payoutRunId: demoRun.id }, orderBy: { netPayableAmount: "desc" } });
    if (demoPayout) {
      await requestApproval(
        "COMMISSION_ADJUSTMENT",
        {
          entity: "Payout",
          entityId: demoPayout.id,
          payload: { partnerProfileId: demoPayout.partnerProfileId, payoutId: demoPayout.id, amount: -50, reason: "Referral fee correction — duplicate revenue entry reversed" },
          reason: "Referral fee correction — duplicate revenue entry reversed",
        },
        { id: finance.id, role: finance.role },
      );
    }
  }

  // A live stage-override request, Manager-requested (the original Workstream 1 maker-checker
  // feature) — shown alongside the Earnings-related requests so the queue demonstrates more than
  // one action type.
  if (!(await prisma.approvalRequest.findFirst({ where: { actionType: "STAGE_OVERRIDE", status: "PENDING" } }))) {
    const introStage = await prisma.stage.findUnique({ where: { name: "Introduction with Dealer" } });
    const targetClient = clientByCode.get("CL-DEMO-06");
    if (introStage && targetClient) {
      await requestApproval(
        "STAGE_OVERRIDE",
        {
          entity: "Client",
          entityId: targetClient.id,
          payload: { clientId: targetClient.id, toStageId: introStage.id, reason: "Client funded outside the normal flow — advancing directly to dealer introduction" },
          reason: "Client funded outside the normal flow — advancing directly to dealer introduction",
        },
        { id: manager.id, role: manager.role },
      );
    }
  }

  console.log(
    `Phase 4 seeded: 6 demo clients, 2 households, 6 trading accounts, 2 new commission plans, ${newAccruals} new/updated accrual(s), 1 live payout run + up to 2 more live approval requests ready for Admin to approve.`,
  );
}

async function main() {
  await seedPhase1OrgHierarchy();

  // Workstream 2/3 models (e.g. TradingAccount) don't exist on the generated client until their
  // own migration lands — guard synchronously against that rather than assuming the property is
  // always a callable model delegate.
  const canRunPhase2 = typeof (prisma as unknown as Record<string, unknown>).tradingAccount !== "undefined";

  if (!canRunPhase2) {
    console.warn("Phase 2 skipped: Workstream 2 tables don't exist yet — run its migration first.");
    return;
  }
  await seedPhase2ClientAccountsAndHoldings();

  const canRunPhase3 = typeof (prisma as unknown as Record<string, unknown>).commissionPlan !== "undefined";
  if (!canRunPhase3) {
    console.warn("Phase 3 skipped: Workstream 3 tables don't exist yet — run its migration first.");
    return;
  }
  await seedPhase3EarningsEngine();
  await seedPhase4StakeholderDemo();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
