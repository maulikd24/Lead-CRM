"use server";

import { revalidatePath } from "next/cache";

import { requireAccess } from "@/lib/auth/require-role";
import { runReplay, saveReplayRun } from "@/lib/intelligence/decision/replay-db";

/** Run the decision replay over historical snapshots and keep the summary. ADMIN only (registry area "decision-report"). Read-only on customer data. */
export async function runReplayAction(): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  const session = await requireAccess("decision-report", "manage");
  try {
    const params = { clients: 60, snapshots: 3, stepDays: 10 };
    const report = await runReplay(params);
    const runId = await saveReplayRun(params, report, session.user.id);
    revalidatePath("/settings/decision-shadow");
    return { ok: true, runId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 200) : "The replay failed" };
  }
}
