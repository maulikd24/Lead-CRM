"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { encryptForStorage, pilotDb } from "@/lib/agents/pilot-wiring";
import { addPilotUser, recordSignoff, removeAiKey, removePilotUser, revokeSignoff, saveAiKey, type Change } from "@/lib/agents/pilot-service";

/** Every action here is Admin-only (checked twice: here, and again inside the service). The service writes the audit row. */
async function admin() {
  const session = await requireRole(["ADMIN"]);
  return { id: session.user.id, role: session.user.role };
}
function done(r: Change): Change {
  revalidatePath("/settings/ai-pilot");
  revalidatePath("/agents");
  return r;
}

export async function addPilotUserAction(userId: unknown): Promise<Change> {
  return done(await addPilotUser(pilotDb, await admin(), userId));
}
export async function removePilotUserAction(userId: unknown): Promise<Change> {
  return done(await removePilotUser(pilotDb, await admin(), userId));
}
export async function recordSignoffAction(input: unknown): Promise<Change> {
  return done(await recordSignoff(pilotDb, await admin(), input));
}
export async function revokeSignoffAction(): Promise<Change> {
  return done(await revokeSignoff(pilotDb, await admin()));
}
export async function saveAiKeyAction(key: unknown): Promise<Change> {
  return done(await saveAiKey(pilotDb, await admin(), key, encryptForStorage));
}
export async function removeAiKeyAction(): Promise<Change> {
  return done(await removeAiKey(pilotDb, await admin()));
}
