/**
 * Backfill the app user id link for customers created before the signup ledger pointed at them.
 *
 *   npx tsx scripts/backfill-app-user-ids.ts                       dry run (default): prints what it WOULD link, writes nothing
 *   APP_USER_ID_LINKING=1 npx tsx scripts/backfill-app-user-ids.ts --apply --actor=admin@your-company.example
 *
 * Safe to run again (idempotent): it only re-points a signup ledger row that points at nobody or at a merged-away customer,
 * and only on strong, unambiguous evidence (see src/lib/integrations/clevertap/backfill.ts). It never creates a row, never
 * guesses, and prints row ids, customer ids and counts only. Applying needs APP_USER_ID_LINKING=1 and an existing Admin.
 * Optional: --limit=500 (rows examined per kind, default 500).
 */
import "dotenv/config";
import { basePrisma } from "../src/lib/db/prisma";
import { applyBackfill, planBackfill } from "../src/lib/integrations/clevertap/backfill";
import { listBackfillCandidates, prismaBackfillDeps } from "../src/lib/integrations/clevertap/backfill-db";
import { appIdLinkingEnabled } from "../src/lib/integrations/clevertap/identity";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main() {
  const apply = process.argv.includes("--apply");
  const limit = Math.min(Math.max(Number(arg("limit") ?? 500) || 500, 1), 5000);

  let actorId: string | null = null;
  if (apply) {
    if (!appIdLinkingEnabled()) throw new Error("Refusing to apply: set APP_USER_ID_LINKING=1 first. A dry run needs no switch.");
    const email = arg("actor");
    if (!email) throw new Error("Refusing to apply: pass --actor=<email of an existing Admin>.");
    const user = await basePrisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
    if (!user || user.role !== "ADMIN") throw new Error("Refusing to apply: --actor must be an existing Admin user.");
    actorId = user.id;
  }

  const rows = await listBackfillCandidates(basePrisma, limit);
  const deps = prismaBackfillDeps(basePrisma, actorId);
  const plan = await planBackfill(rows, deps);
  const result = await applyBackfill(plan, rows, deps, { dryRun: !apply });

  const tally: Record<string, number> = {};
  for (const d of plan) {
    const key = d.action === "link" ? `link (${d.basis})` : `skip (${d.reason})`;
    tally[key] = (tally[key] ?? 0) + 1;
  }
  console.log(apply ? "APPLIED" : "DRY RUN (nothing written)");
  console.log(`examined ${rows.length} signup rows`);
  for (const [k, v] of Object.entries(tally).sort()) console.log(`  ${k}: ${v}`);
  console.log(apply ? `linked ${result.linked}, lost a race ${result.skipped}` : `would link ${result.wouldLink}`);
  for (const d of plan) if (d.action === "link") console.log(`  ${apply ? "linked" : "would link"} row ${d.rowId} -> customer ${d.clientId}`);
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => basePrisma.$disconnect());
