/**
 * One synthetic campaign plan for the layout budget: the six plan-marketing routes (default, links, copy, funnel, history, edit) skip
 * when the planner board has no plan, so this seeds one draft plan with a synthetic destination, through the planner's own create
 * functions (no raw SQL). Nothing here is a real person, a real campaign or a live link. Local database only. Idempotent: does
 * nothing when the plan already exists.
 *
 *   npm run layout-budget:seed      (last step; needs the standard seed and seed-creative for the marketing owner)
 */
import "dotenv/config";
import "../../src/lib/safety/assert-local-db";

import { prisma } from "../../src/lib/db/prisma";
import { createPlan, ensurePlannerDefaults, saveDestination } from "../../src/lib/planner/db";

const PLAN_TITLE = "Layout budget synthetic plan";
const DESTINATION_NAME = "Layout budget synthetic landing";

export async function seedPlanner(): Promise<string> {
  if (await prisma.plannerPlan.findFirst({ where: { title: PLAN_TITLE } })) return "planner plan already present";

  await ensurePlannerDefaults();

  // The owner is the marketing tester when seed-creative has run, else the admin from the standard seed.
  const owner =
    (await prisma.user.findUnique({ where: { email: "marketing@supportify.local" }, select: { id: true, role: true } })) ??
    (await prisma.user.findUniqueOrThrow({ where: { email: "admin@supportify.local" }, select: { id: true, role: true } }));

  let destination = await prisma.plannerDestination.findFirst({ where: { name: DESTINATION_NAME } });
  if (!destination) {
    const saved = await saveDestination(null, { name: DESTINATION_NAME, kind: "WEB_LANDING", urlPattern: "https://example.com/layout-budget", status: "PLANNED", ownerId: owner.id, notes: "Synthetic destination for layout-budget screenshots." });
    if (!saved.ok) throw new Error(`destination: ${saved.error}`);
    destination = await prisma.plannerDestination.findUniqueOrThrow({ where: { id: saved.id } });
  }

  const audience = await prisma.plannerAudience.findFirst({ where: { archivedAt: null }, orderBy: { sortOrder: "asc" } });
  const promise = await prisma.plannerPromise.findFirst({ where: { archivedAt: null }, orderBy: { createdAt: "asc" } });
  if (!audience || !promise) throw new Error("No active planner audience or promise after ensurePlannerDefaults");

  const created = await createPlan(
    { title: PLAN_TITLE, audienceId: audience.id, promiseId: promise.id, channel: "search_ad", destinationId: destination.id, ownerId: owner.id, notes: "Synthetic plan for layout-budget screenshots. Not a real campaign." },
    { id: owner.id, role: owner.role },
  );
  if (!created.ok) throw new Error(`plan: ${created.error}`);
  return `seeded planner plan ${created.code}`;
}

seedPlanner()
  .then((msg) => console.log(msg))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
