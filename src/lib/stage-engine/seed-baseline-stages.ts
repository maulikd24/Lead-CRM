import { prisma } from "@/lib/db/prisma";
import { STAGE_DEFINITIONS } from "@/lib/stage-engine/stages";

/**
 * One-time production seed for the 5 baseline onboarding stages (STAGE_DEFINITIONS). Some
 * environments — production included — were only ever seeded with the Distribution OS org-
 * hierarchy demo data (see seedDistributionOsDemoData), never the base pipeline Stage rows the
 * stage engine assumes always exist: getStageByName("New Lead") (used by clients/actions.ts on
 * every new-client creation) throws without them, and Reports' Stage Funnel/Conversion/Bottleneck/
 * SLA-by-stage sections all render empty. Runs inside the deployed app off the existing 5-minute
 * cron tick, since this environment intentionally never exposes a direct production DATABASE_URL
 * for a local script to use.
 *
 * Idempotency is a direct completion check (does Stage already have all 5 names), not a
 * DailyJobRun mutex claimed before the work runs — a mutex claimed first and never re-verified
 * means a single transient failure on the first tick permanently "completes" the job having
 * created zero rows. Checking real state instead makes a partial or failed prior attempt
 * self-heal on the next tick.
 */
export async function seedBaselineStages() {
  const existingCount = await prisma.stage.count({ where: { name: { in: STAGE_DEFINITIONS.map((s) => s.name) } } });
  if (existingCount >= STAGE_DEFINITIONS.length) {
    return { skipped: "already-seeded" as const };
  }

  try {
    for (const stage of STAGE_DEFINITIONS) {
      await prisma.stage.upsert({
        where: { name: stage.name },
        update: { sequence: stage.sequence, slaHours: stage.slaHours },
        create: stage,
      });
    }
    return { seeded: true as const, count: STAGE_DEFINITIONS.length };
  } catch (error) {
    console.error("Failed to seed baseline stages", error);
    return { error: "seed-failed" as const };
  }
}
