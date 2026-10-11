import { notFound } from "next/navigation";

import { requireMarketing } from "@/lib/auth/require-role";
import { plannerEnabled } from "@/lib/planner/flag";

import PlannerPage from "../page";

export const dynamic = "force-dynamic";
export const metadata = { title: "New plan" };

/** The new-plan form is a sheet over the board; this address opens the board with it open (links and bookmarks keep working), after the manage check. */
export default async function NewPlanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireMarketing("marketing-planner", "manage");
  if (!plannerEnabled()) notFound();
  const params = await searchParams;
  return PlannerPage({ searchParams: Promise.resolve({ ...params, new: "1" }) });
}
