"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { setCutoverTick } from "@/lib/system/cutover-checks";
import { tickDb } from "@/lib/system/status-wiring";

/** Tick or untick one manual post-cutover check. Admin only; who and when are stored and the change is audited. */
export async function setCutoverTickAction(id: unknown, done: unknown, note: unknown) {
  const session = await requireRole(["ADMIN"]);
  const r = await setCutoverTick(tickDb, { id: session.user.id, role: session.user.role }, id, done, note);
  revalidatePath("/settings/system/status");
  return r;
}
