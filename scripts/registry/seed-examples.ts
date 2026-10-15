/**
 * Seeds the generic EXAMPLE products into the registry of the database DATABASE_URL points at. Idempotent. Local and demo use only:
 * the owner replaces these with the real catalogue (Settings, Product registry). Run: npx tsx scripts/registry/seed-examples.ts
 */
import { basePrisma } from "../../src/lib/db/prisma";
import { seedExampleProducts } from "../../src/lib/registry/seed-examples";

seedExampleProducts(basePrisma)
  .then((created) => console.log(created.length === 0 ? "Example products already present." : `Created example products: ${created.join(", ")}`))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => basePrisma.$disconnect());
