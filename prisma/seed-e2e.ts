// Seed for the role-based e2e run (CI and local). Composes the existing seeds and adds a small, fixed, SYNTHETIC data set:
// one user per role the suite signs in as, a second RM, a dozen customers across the two RMs and two consent states.
// Idempotent. Refuses a non-local database (see src/lib/safety/local-db-guard.ts). Password: E2E_PASSWORD, default = the
// documented seed password. Usage: DATABASE_URL=... npx tsx prisma/seed-e2e.ts
import "dotenv/config";
import "../src/lib/safety/assert-local-db";
import { execFileSync } from "node:child_process";
import bcrypt from "bcryptjs";

import { prisma } from "../src/lib/db/prisma";

export const E2E_USERS = {
  admin: "admin@supportify.local",
  manager: "manager@supportify.local",
  rm: "rm@supportify.local",
  marketing: "marketing@supportify.local",
  finance: "finance@supportify.local",
  partner: "partner1@supportify.local",
} as const;

async function main() {
  const run = (script: string) => execFileSync("npx", ["tsx", script], { stdio: "inherit", env: process.env });
  run("prisma/seed.ts"); // admin, manager, rm, the baseline stages
  run("prisma/seed-distribution-os.ts"); // finance, marketing, partners, a team manager

  const passwordHash = await bcrypt.hash(process.env.E2E_PASSWORD ?? "password123", 10);
  const manager = await prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.manager } });
  const rm = await prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.rm } });
  const rm2 = await prisma.user.upsert({
    where: { email: "rm2@supportify.local" },
    update: {},
    create: { name: "RM Rita", email: "rm2@supportify.local", passwordHash, role: "RM", managerId: manager.id },
  });

  // No first-visit guided tour (a dialog that blocks clicks) for any user the suite signs in as.
  await prisma.user.updateMany({ where: { email: { in: [...Object.values(E2E_USERS), "rm2@supportify.local"] } }, data: { hasSeenTour: true, mustChangePassword: false } });

  const stage = await prisma.stage.findFirstOrThrow({ where: { isActive: true }, orderBy: { sequence: "asc" } });
  for (let i = 1; i <= 12; i++) {
    const code = `E2E-${String(i).padStart(3, "0")}`;
    const owner = i <= 8 ? rm : rm2;
    await prisma.client.upsert({
      where: { clientCode: code },
      update: {},
      create: {
        clientCode: code,
        name: `E2E Client ${String(i).padStart(2, "0")}`,
        mobile: `9000${String(100000 + i).padStart(6, "0")}`,
        email: `e2e.client${i}@example.invalid`,
        city: "Mumbai",
        leadSource: i % 3 === 0 ? "Meta Ads" : "Website",
        currentStageId: stage.id,
        assignedToId: owner.id,
        status: "ACTIVE",
      },
    });
  }
  // Wave 2 C: example registry products, a few attention items for the standard RM, a synthetic campaign (so the role e2e and axe open real content).
  await (await import("../scripts/layout-budget/seed-wave2c")).seedWave2c();
  console.log("E2E seed ready: users admin, manager, rm, marketing, finance, partner; 12 synthetic customers (E2E-001..012, 8 for rm, 4 for rm2).");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
