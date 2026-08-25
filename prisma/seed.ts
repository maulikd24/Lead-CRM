import bcrypt from "bcryptjs";

import { prisma } from "../src/lib/db/prisma";
import { STAGE_DEFINITIONS } from "../src/lib/stage-engine/stages";

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@supportify.local" },
    update: {},
    create: {
      name: "Admin",
      email: "admin@supportify.local",
      passwordHash,
      role: "ADMIN",
    },
  });

  const manager = await prisma.user.upsert({
    where: { email: "manager@supportify.local" },
    update: {},
    create: {
      name: "Manager Mia",
      email: "manager@supportify.local",
      passwordHash,
      role: "MANAGER",
      managerId: admin.id,
    },
  });

  await prisma.user.upsert({
    where: { email: "rm@supportify.local" },
    update: {},
    create: {
      name: "RM Raj",
      email: "rm@supportify.local",
      passwordHash,
      role: "RM",
      managerId: manager.id,
    },
  });

  for (const stage of STAGE_DEFINITIONS) {
    await prisma.stage.upsert({
      where: { name: stage.name },
      update: { sequence: stage.sequence, slaHours: stage.slaHours },
      create: stage,
    });
  }

  console.log("Seeded users: admin@supportify.local / manager@supportify.local / rm@supportify.local (password: password123)");
  console.log(`Seeded ${STAGE_DEFINITIONS.length} onboarding stages`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
