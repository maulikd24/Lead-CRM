import { notFound, redirect } from "next/navigation";

import { requireMarketing } from "@/lib/auth/require-role";
import { plannerEnabled } from "@/lib/planner/flag";

export const dynamic = "force-dynamic";

/** The old address of the new-plan form: it is a sheet over the board now. Kept so links and bookmarks still work, with the same access check. */
export default async function NewPlanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireMarketing("marketing-planner", "manage");
  if (!plannerEnabled()) notFound();
  const params = await searchParams;
  const q = new URLSearchParams({ new: "1" });
  for (const k of ["audience", "channel"]) if (typeof params[k] === "string") q.set(k, params[k] as string);
  redirect(`/planner?${q.toString()}`);
}
