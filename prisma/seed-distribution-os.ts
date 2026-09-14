// Distribution OS demo seed data — Company -> Team -> Partner hierarchy (Workstream 1).
//
// Phase 1 (below) is idempotent (upsert-based, deterministic IDs for join rows), following
// prisma/seed.ts's convention exactly, and is runnable the moment Workstream 1's migration is
// applied. Phase 2 (Client -> Transaction -> Revenue) needs Workstream 2/3 schema that doesn't
// exist yet — see the guard in main() below.
import "dotenv/config";
import bcrypt from "bcryptjs";

import { prisma } from "../src/lib/db/prisma";

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

async function main() {
  await seedPhase1OrgHierarchy();

  // Workstream 2/3 models (e.g. TradingAccount) don't exist on the generated client until their
  // own migration lands — guard synchronously against that rather than assuming the property is
  // always a callable model delegate.
  const canRunPhase2 = typeof (prisma as unknown as Record<string, unknown>).tradingAccount !== "undefined";

  if (process.env.SEED_PHASE === "2" && !canRunPhase2) {
    console.warn("SEED_PHASE=2 requested but Workstream 2/3 tables don't exist yet — run their migrations first.");
  } else if (process.env.SEED_PHASE !== "2") {
    console.log("Skipping Phase 2 (set SEED_PHASE=2 once Workstream 2/3 migrations are applied).");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
