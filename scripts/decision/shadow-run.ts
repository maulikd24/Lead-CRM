/**
 * npm run decision:shadow -- [--limit 500]
 * Computes the shadow decision for customers now (what the cron does in small batches when NBA_ENGINE_V2 is on). Local database only.
 * Writes DecisionRecord rows and the disagreement log. Never sends or writes outward.
 */
import "./_env";
import { basePrisma } from "../../src/lib/db/prisma";
import { runShadowDecision } from "../../src/lib/intelligence/decision/shadow";
import { linkOutcomesForClient } from "../../src/lib/intelligence/decision/outcomes-db";

async function main() {
  const i = process.argv.indexOf("--limit");
  const limit = i >= 0 ? Number(process.argv[i + 1]) : 500;
  const clients = await basePrisma.client.findMany({ where: { isDeleted: false, mergedIntoId: null }, select: { id: true }, orderBy: { createdAt: "desc" }, take: limit });
  let created = 0;
  let linked = 0;
  for (const c of clients) {
    const r = await runShadowDecision(c.id);
    if (r?.created) created += 1;
    linked += await linkOutcomesForClient(c.id);
  }
  console.log(`Shadow decisions: ${clients.length} customers, ${created} new decision rows, ${linked} outcome links`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
