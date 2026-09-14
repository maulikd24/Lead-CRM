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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
