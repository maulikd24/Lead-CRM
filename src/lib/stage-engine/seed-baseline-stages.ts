import { prisma } from "@/lib/db/prisma";
import { STAGE_DEFINITIONS } from "@/lib/stage-engine/stages";
import { Prisma } from "@/generated/prisma/client";

const JOB_NAME = "seed_baseline_stages";

/**
 * One-time production seed for the 5 baseline onboarding stages (STAGE_DEFINITIONS). Some
 * environments — production included — were only ever seeded with the Distribution OS org-
 * hierarchy demo data (see seedDistributionOsDemoData), never the base pipeline Stage rows the
 * stage engine assumes always exist: getStageByName("New Lead") (used by clients/actions.ts on
 * every new-client creation) throws without them, and Reports' Stage Funnel/Conversion/Bottleneck/
 * SLA-by-stage sections all render empty. Runs inside the deployed app off the existing 5-minute
 * cron tick — same mechanism and DailyJobRun-mutex precedent as seedDistributionOsDemoData — since
 * this environment intentionally never exposes a direct production DATABASE_URL for a local script
 * to use.
 */
export async function seedBaselineStages() {
  try {
    await prisma.dailyJobRun.create({ data: { jobName: JOB_NAME, ranForDate: "once" } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { skipped: "already-seeded" as const };
    }
    throw error;
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
