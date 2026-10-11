/**
 * AI reply-assist pilot: who may use the draft-only reply assistant, and what must be true before anyone can.
 *
 * Layers, outermost first (each can only narrow what the one before allows):
 *   1. WA_ASSIST_ENABLED=1 and the `wa_reply` kill switch (src/lib/agents/enabled.ts);
 *   2. an Admin has saved an AI provider key in Settings;
 *   3. compliance sign-off of the wording below is recorded (who and when), against the CURRENT wording version;
 *   4. the signed-in user is on the pilot list. An empty list means nobody.
 * The consent gate (CONSENT_ENFORCEMENT) and the draft-only rule sit below all of this and are not touched.
 *
 * Prisma-free so the whole decision is unit-testable.
 */

/** Change this whenever the statement below changes: a sign-off recorded against an older version stops counting. */
export const PILOT_STATEMENT_VERSION = "2026-10-v1";

/** What the Admin ticks. Plain words; compliance reads exactly this. */
export const PILOT_STATEMENT = [
  "The reply assistant only writes a draft. Nothing is sent to a customer unless the relationship manager reads it, edits it if needed, and presses Send.",
  "A draft is never sent by the system on its own, and it never promises returns, guarantees an outcome or gives investment advice. Drafts that break these rules are discarded before anyone sees them.",
  "When a listed relationship manager asks for a draft, the recent messages of that customer's thread are sent to the AI provider. While consent enforcement is on, only customers who agreed to AI processing of chats are included; while it is off, the consent record is kept but not enforced.",
  "Only the people on the pilot list see the assistant. Every change to the list, the key and this sign-off is recorded with who made it and when.",
  "Compliance has reviewed this wording and agrees to a limited pilot.",
] as const;

export type PilotBlock = "agent_off" | "no_ai_key" | "no_signoff" | "not_in_pilot";

export const PILOT_BLOCK_TEXT: Record<PilotBlock, string> = {
  agent_off: "The reply assistant is switched off (environment flag or kill switch).",
  no_ai_key: "An Admin has not saved an AI provider key in Settings yet.",
  no_signoff: "Compliance sign-off of the pilot wording has not been recorded.",
  not_in_pilot: "You are not on the pilot list.",
};

/** One line for the Agents page, for whoever is looking at it. `null` = this user may use the assistant. */
export function describePilotStatus(block: PilotBlock | null): string {
  return block === null ? "You are in the reply assistant pilot." : `Reply assistant pilot: ${PILOT_BLOCK_TEXT[block]}`;
}

export type PilotReadinessFacts = { agentOn: boolean; aiKeySaved: boolean; signoff: { statementVersion: string } | null };
export type PilotFacts = PilotReadinessFacts & { listed: boolean };

const signoffCounts = (s: PilotReadinessFacts["signoff"]) => !!s && s.statementVersion === PILOT_STATEMENT_VERSION;

/** What is still missing for the pilot to run for anyone (nothing about a particular user). */
export function pilotReadiness(f: PilotReadinessFacts): { ready: boolean; missing: Exclude<PilotBlock, "not_in_pilot">[] } {
  const missing: Exclude<PilotBlock, "not_in_pilot">[] = [];
  if (!f.agentOn) missing.push("agent_off");
  if (!f.aiKeySaved) missing.push("no_ai_key");
  if (!signoffCounts(f.signoff)) missing.push("no_signoff");
  return { ready: missing.length === 0, missing };
}

/** Why this user may not use the assistant, or null when they may. */
export function pilotBlock(f: PilotFacts): PilotBlock | null {
  const r = pilotReadiness(f);
  if (!r.ready) return r.missing[0];
  return f.listed ? null : "not_in_pilot";
}

/** Roles that can open a customer's inbox thread and reply (see canReplyTo): the assigned RM, or an Admin. Managers are view-only. */
export const PILOT_ROLES = ["RM", "ADMIN"] as const;

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };

export function parsePilotUserInput(userId: unknown): Ok<{ userId: string }> | Err {
  if (typeof userId !== "string") return { ok: false, error: "Choose a user." };
  const id = userId.trim();
  if (!id || id.length > 64) return { ok: false, error: "Choose a user." };
  return { ok: true, userId: id };
}

export function parseSignoffInput(input: unknown): Ok<object> | Err {
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  if (!o || o.confirmed !== true) return { ok: false, error: "Tick the box to record the sign-off." };
  if (o.statementVersion !== PILOT_STATEMENT_VERSION) return { ok: false, error: "The wording has changed. Reload the page and read it again." };
  return { ok: true };
}

/** Shape check only: the provider is the judge of whether the key works. The error never repeats the key. */
export function parseAiKeyInput(raw: unknown): Ok<{ key: string }> | Err {
  if (typeof raw !== "string") return { ok: false, error: "Enter the key." };
  const key = raw.trim();
  if (!/^sk-[A-Za-z0-9_-]{20,300}$/.test(key)) return { ok: false, error: "That does not look like an AI provider key. Paste it exactly as the provider shows it." };
  return { ok: true, key };
}
