import Link from "next/link";
import { notFound } from "next/navigation";

import { requireMarketing } from "@/lib/auth/require-role";
import { ensurePlannerDefaults } from "@/lib/planner/db";
import { plannerEnabled } from "@/lib/planner/flag";

import { PlanForm } from "../plan-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New plan" };

export default async function NewPlanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireMarketing("marketing-planner", "manage");
  if (!plannerEnabled()) notFound();
  await ensurePlannerDefaults();
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <div>
        <Link href="/planner" className="text-sm text-primary underline-offset-4 hover:underline">Back to the planner</Link>
        <h1 className="font-heading text-2xl font-extrabold tracking-tight">New plan</h1>
        <p className="text-sm text-muted-foreground">Pick the audience, the promise, the channel and where it lands. You will get tracked links, copy drafts and a checklist next.</p>
      </div>
      <PlanForm preset={{ audienceId: one(params.audience), channel: one(params.channel) }} initial={{ ownerId: session.user.id }} />
    </div>
  );
}
