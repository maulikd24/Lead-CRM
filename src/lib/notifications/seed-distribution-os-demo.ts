import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/db/prisma";
import { generatePartnerCode } from "@/lib/policy/partner-code";
import { Prisma } from "@/generated/prisma/client";

const JOB_NAME = "seed_distribution_os_demo";

function generateTempPassword(): string {
  return randomBytes(9).toString("base64url"); // matches settings/users/actions.ts's convention
}

type CreatedAccount = { email: string; role: string; tempPassword: string };

/**
 * One-time production seed for the Distribution OS demo org/partner hierarchy (Company, Team,
 * PartnerProfile, HierarchyAssignment + a handful of demo users). Deliberately NOT the same
 * mechanism as prisma/seed-distribution-os.ts (a local-only script) — that script needs a direct
 * DATABASE_URL this environment intentionally never exposes for production. This runs inside the
 * deployed app instead, off the existing 5-minute cron tick, exactly like every other self-
 * determining job there (see src/app/api/internal/cron/tick/route.ts).
 *
 * Idempotency: DailyJobRun's unique constraint acts as a one-time (not daily) mutex here via a
 * fixed ranForDate sentinel — same precedent as the daily jobs, just a single "ever" run instead
 * of once per calendar day.
 *
 * Passwords are freshly randomly generated per account (never a shared/guessable value) and are
 * delivered ONLY via an in-app Notification to every active Admin — never logged in plaintext
 * anywhere durable.
 */
export async function seedDistributionOsDemoData() {
  try {
    await prisma.dailyJobRun.create({ data: { jobName: JOB_NAME, ranForDate: "once" } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { skipped: "already-seeded" as const };
    }
    throw error;
  }

  try {
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
    if (!admin) return { error: "no-admin-user-found" as const };

    const created: CreatedAccount[] = [];

    async function upsertDemoUser(input: { name: string; email: string; role: "TEAM_MANAGER" | "FINANCE" | "DISTRIBUTOR" | "PARTNER" | "AFFILIATE"; managerId?: string }) {
      const existing = await prisma.user.findUnique({ where: { email: input.email } });
      if (existing) return existing;
      const tempPassword = generateTempPassword();
      const user = await prisma.user.create({
        data: {
          name: input.name,
          email: input.email,
          role: input.role,
          passwordHash: await bcrypt.hash(tempPassword, 10),
          managerId: input.managerId,
        },
      });
      created.push({ email: user.email, role: user.role, tempPassword });
      return user;
    }

    const company = await prisma.company.upsert({
      where: { code: "ALLVEST" },
      update: {},
      create: { name: "Allvest Securities", code: "ALLVEST" },
    });

    const teamManager = await upsertDemoUser({ name: "Team Manager Tara", email: "teammgr@allvest.local", role: "TEAM_MANAGER", managerId: admin.id });
    await upsertDemoUser({ name: "Finance Fiona", email: "finance@allvest.local", role: "FINANCE", managerId: admin.id });

    const partnerTeam = await prisma.team.upsert({
      where: { code: "PTR-TEAM-01" },
      update: { teamManagerId: teamManager.id },
      create: { companyId: company.id, name: "North Partner Team", code: "PTR-TEAM-01", type: "PARTNER_TEAM", teamManagerId: teamManager.id },
    });

    const distributorUser = await upsertDemoUser({ name: "Distributor Deepak", email: "distributor1@allvest.local", role: "DISTRIBUTOR" });
    let distributorProfile = await prisma.partnerProfile.findUnique({ where: { userId: distributorUser.id } });
    if (!distributorProfile) {
      distributorProfile = await prisma.partnerProfile.create({
        data: {
          userId: distributorUser.id,
          partnerCode: await generatePartnerCode(),
          partnerType: "DISTRIBUTOR",
          tier: "GOLD",
          empanelmentStatus: "ACTIVE",
          empanelmentDate: new Date(),
        },
      });
    }
    await prisma.hierarchyAssignment.upsert({
      where: { id: "seed-team-member-distributor" },
      update: {},
      create: { id: "seed-team-member-distributor", relationType: "TEAM_MEMBER", assigneePartnerId: distributorProfile.id, teamId: partnerTeam.id, createdById: admin.id },
    });

    const PARTNER_SEEDS = [
      { name: "Priya Partner", email: "partner1@allvest.local", isAffiliate: false },
      { name: "Rahul Referrer", email: "partner2@allvest.local", isAffiliate: false },
      { name: "Anita Affiliate", email: "partner3@allvest.local", isAffiliate: true },
    ];
    for (const seed of PARTNER_SEEDS) {
      const user = await upsertDemoUser({ name: seed.name, email: seed.email, role: seed.isAffiliate ? "AFFILIATE" : "PARTNER" });
      let profile = await prisma.partnerProfile.findUnique({ where: { userId: user.id } });
      if (!profile) {
        profile = await prisma.partnerProfile.create({
          data: {
            userId: user.id,
            partnerCode: await generatePartnerCode(),
            partnerType: seed.isAffiliate ? "AFFILIATE" : "PARTNER",
            tier: "SILVER",
            empanelmentStatus: "ACTIVE",
            empanelmentDate: new Date(),
            parentPartnerProfileId: seed.isAffiliate ? distributorProfile.id : null,
          },
        });
      }
      await prisma.hierarchyAssignment.upsert({
        where: { id: `seed-team-member-${profile.id}` },
        update: {},
        create: { id: `seed-team-member-${profile.id}`, relationType: "TEAM_MEMBER", assigneePartnerId: profile.id, teamId: partnerTeam.id, createdById: admin.id },
      });
    }

    if (created.length > 0) {
      // Deliberately console-logged (visible only to the Vercel project's own account owner via
      // `vercel logs`), not stored in the Notification model — that UI is a compact one-line-per-
      // item dropdown, a poor fit for delivering a list of one-time credentials, and this is a
      // single operational event rather than a recurring user-facing alert type.
      console.log("Distribution OS demo accounts created:", JSON.stringify(created));
    }

    return { sent: true as const, accountsCreated: created.length, accounts: created };
  } catch (error) {
    console.error("Failed to seed Distribution OS demo data", error);
    return { error: "seed-failed" as const };
  }
}
