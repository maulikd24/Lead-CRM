import bcrypt from "bcryptjs";

import { prisma } from "../src/lib/db/prisma";

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@crm.local" },
    update: {},
    create: {
      name: "Admin",
      email: "admin@crm.local",
      passwordHash,
      role: "ADMIN",
    },
  });

  const manager = await prisma.user.upsert({
    where: { email: "manager@crm.local" },
    update: {},
    create: {
      name: "Manager Mia",
      email: "manager@crm.local",
      passwordHash,
      role: "MANAGER",
      managerId: admin.id,
    },
  });

  await prisma.user.upsert({
    where: { email: "rm@crm.local" },
    update: {},
    create: {
      name: "RM Raj",
      email: "rm@crm.local",
      passwordHash,
      role: "RM",
      managerId: manager.id,
    },
  });

  const existingPipeline = await prisma.pipeline.findFirst({ where: { name: "Default Pipeline" } });
  if (!existingPipeline) {
    await prisma.pipeline.create({
      data: {
        name: "Default Pipeline",
        stages: {
          create: [
            { name: "New", order: 0 },
            { name: "Qualified", order: 1 },
            { name: "Proposal", order: 2 },
            { name: "Negotiation", order: 3 },
            { name: "Won", order: 4 },
            { name: "Lost", order: 5 },
          ],
        },
      },
    });
  }

  console.log("Seeded users: admin@crm.local / manager@crm.local / rm@crm.local (password: password123)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
