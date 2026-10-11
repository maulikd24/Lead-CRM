"use server";

import { revalidatePath } from "next/cache";

import { requireAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { pilotProvider } from "@/lib/agents/pilot-wiring";
import { memoryEnabled } from "@/lib/memory/flag";
import { MEMORY_CLASSES } from "@/lib/memory/rules";
import { actOnMemoryAs, editMemoryAs, recordMemoryAs } from "@/lib/memory/service";
import { authoriseMemory } from "@/lib/memory/access";
import { memoryExtractionEnabled, proposeMemoryForClient } from "@/lib/memory/run";

export type MemoryActionResult = { ok: true; message?: string } | { ok: false; error: string };

const refresh = (clientId: string) => revalidatePath(`/clients/${clientId}/360`);
const CLASSES_FOR_PEOPLE = MEMORY_CLASSES.filter((c) => c !== "SENTIMENT");

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Every action re-checks: the flag, the registry (requireAccess), the customer's record scope, and that the item belongs to this customer. The browser sends ids and words only. */
async function ctx(clientId: string) {
  const session = await requireAccess("customer-memory", "manage");
  if (!memoryEnabled()) return null;
  const viewer = { userId: session.user.id, role: session.user.role };
  const auth = await authoriseMemory(viewer, String(clientId));
  return auth.ok && auth.canManage ? viewer : null;
}

async function itemBelongs(clientId: string, itemId: string): Promise<boolean> {
  return (await prisma.customerMemoryItem.count({ where: { id: String(itemId), clientId: String(clientId) } })) === 1;
}

const NOT_AVAILABLE: MemoryActionResult = { ok: false, error: "Not available." };
const from = (r: { ok: boolean; message?: string }, ok = "Saved."): MemoryActionResult => (r.ok ? { ok: true, message: ok } : { ok: false, error: r.message ?? "Could not save." });

export async function confirmMemoryAction(clientId: string, itemId: string, note?: string): Promise<MemoryActionResult> {
  const viewer = await ctx(clientId);
  if (!viewer || !(await itemBelongs(clientId, itemId))) return NOT_AVAILABLE;
  const r = await actOnMemoryAs(viewer, String(itemId), { type: "confirm" }, text(note, 240) || undefined);
  if (r.ok) refresh(clientId);
  return from(r, "Confirmed.");
}

export async function rejectMemoryAction(clientId: string, itemId: string, reason: string): Promise<MemoryActionResult> {
  const viewer = await ctx(clientId);
  if (!viewer || !(await itemBelongs(clientId, itemId))) return NOT_AVAILABLE;
  const r = await actOnMemoryAs(viewer, String(itemId), { type: "reject", reason: text(reason, 300) });
  if (r.ok) refresh(clientId);
  return from(r, "Rejected. It will not be suggested again for 90 days.");
}

export async function disputeMemoryAction(clientId: string, itemId: string, reason: string): Promise<MemoryActionResult> {
  const viewer = await ctx(clientId);
  if (!viewer || !(await itemBelongs(clientId, itemId))) return NOT_AVAILABLE;
  const r = await actOnMemoryAs(viewer, String(itemId), { type: "dispute", reason: text(reason, 300) });
  if (r.ok) refresh(clientId);
  return from(r, "Marked as disputed. Nothing will rely on it until it is settled.");
}

export async function reconfirmMemoryAction(clientId: string, itemId: string): Promise<MemoryActionResult> {
  const viewer = await ctx(clientId);
  if (!viewer || !(await itemBelongs(clientId, itemId))) return NOT_AVAILABLE;
  const r = await actOnMemoryAs(viewer, String(itemId), { type: "reconfirm" });
  if (r.ok) refresh(clientId);
  return from(r, "Reconfirmed.");
}

export async function editMemoryAction(clientId: string, itemId: string, newText: string, reason: string): Promise<MemoryActionResult> {
  const viewer = await ctx(clientId);
  if (!viewer || !(await itemBelongs(clientId, itemId))) return NOT_AVAILABLE;
  const value = text(newText, 300);
  if (!value) return { ok: false, error: "Write what is correct." };
  const r = await editMemoryAs(viewer, String(itemId), { text: value }, text(reason, 300));
  if (r.ok) refresh(clientId);
  return from(r, "Corrected. The old entry is kept as replaced.");
}

/** An RM records something they know. The class decides the key prefix; the text is stored as the value. */
export async function recordMemoryAction(clientId: string, input: { class: string; topic: string; text: string; note: string }): Promise<MemoryActionResult> {
  const viewer = await ctx(clientId);
  if (!viewer) return NOT_AVAILABLE;
  const cls = (CLASSES_FOR_PEOPLE as readonly string[]).includes(input.class) ? (input.class as (typeof CLASSES_FOR_PEOPLE)[number]) : null;
  if (!cls) return { ok: false, error: "Choose what kind of thing this is." };
  const value = text(input.text, 300);
  const topic = text(input.topic, 60).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!value || !topic) return { ok: false, error: "Add a short topic and what you know." };
  const r = await recordMemoryAs(viewer, { clientId: String(clientId), class: cls, key: `${cls.toLowerCase()}:${topic}`, value: { text: value }, note: text(input.note, 280) || "Entered by the RM" });
  if (r.ok) refresh(clientId);
  return r.ok ? { ok: true, message: r.outcome === "created" && r.confirmation === "DISPUTED" ? "Saved, but it disagrees with something already recorded, so both are marked disputed until you settle it." : "Saved." } : { ok: false, error: r.message };
}

/** Looks at the customer's recent conversation insights and adds suggestions (never confirmed). With the extraction flag on and an AI key saved, the notes are also read for preferences and do-not-do requests. */
export async function suggestMemoryAction(clientId: string): Promise<MemoryActionResult> {
  const viewer = await ctx(clientId);
  if (!viewer) return NOT_AVAILABLE;
  const model = memoryExtractionEnabled() ? await pilotProvider() : null;
  const s = await proposeMemoryForClient(String(clientId), { model });
  refresh(clientId);
  const refused = Object.values(s.refused).reduce((a, b) => a + b, 0);
  return { ok: true, message: s.created + s.reaffirmed === 0 ? (refused ? "Nothing new: the customer has not agreed to AI reading of their conversations, or the notes cannot be traced." : "Nothing new to suggest.") : `${s.created} new suggestion${s.created === 1 ? "" : "s"} to review.` };
}
