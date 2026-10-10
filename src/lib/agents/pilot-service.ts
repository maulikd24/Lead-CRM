import { PILOT_ROLES, PILOT_STATEMENT, PILOT_STATEMENT_VERSION, parseAiKeyInput, parsePilotUserInput, parseSignoffInput, pilotReadiness, type PilotBlock } from "./pilot";

/** The data the pilot needs, as plain functions: the real one is in pilot-wiring.ts, tests pass a fake. */
export interface PilotDb {
  agentOn(): Promise<boolean>;
  listPilotUsers(): Promise<{ userId: string; name: string; role: string; addedById: string; addedAt: Date }[]>;
  findUser(id: string): Promise<{ id: string; name: string; role: string; isActive: boolean } | null>;
  addPilotUser(userId: string, addedById: string, at: Date): Promise<boolean>;
  removePilotUser(userId: string): Promise<boolean>;
  isListed(userId: string): Promise<boolean>;
  currentSignoff(): Promise<{ id: string; statementVersion: string; acknowledgedById: string; acknowledgedAt: Date } | null>;
  createSignoff(s: { statementVersion: string; statement: string; acknowledgedById: string; acknowledgedAt: Date }): Promise<void>;
  revokeSignoffs(byId: string, at: Date): Promise<number>;
  aiKeyMeta(): Promise<{ last4: string; savedAt: Date; savedById: string } | null>;
  saveAiKey(encryptedPayload: string, last4: string, byId: string, at: Date): Promise<void>;
  deleteAiKey(): Promise<boolean>;
  audit(entry: { userId: string; entity: "AiPilot"; entityId: string; action: string; oldValue?: unknown; newValue?: unknown; reason?: string }): Promise<void>;
}

export type Actor = { id: string; role: string };
export type Change = { ok: true; changed: boolean } | { ok: false; error: string };
const ADMIN_ONLY: Change = { ok: false, error: "Only an Admin can change the pilot." };
const isAdmin = (a: Actor) => a.role === "ADMIN";

export async function addPilotUser(db: PilotDb, actor: Actor, userId: unknown, now = new Date()): Promise<Change> {
  if (!isAdmin(actor)) return ADMIN_ONLY;
  const input = parsePilotUserInput(userId);
  if (!input.ok) return input;
  const user = await db.findUser(input.userId);
  if (!user || !user.isActive) return { ok: false, error: "That user cannot be added: not found or not active." };
  if (!(PILOT_ROLES as readonly string[]).includes(user.role)) return { ok: false, error: "Only relationship managers and Admins can reply to customers, so only they can be added." };
  if (!(await db.addPilotUser(user.id, actor.id, now))) return { ok: true, changed: false };
  await db.audit({ userId: actor.id, entity: "AiPilot", entityId: user.id, action: "pilot_user_added", newValue: { name: user.name, role: user.role } });
  return { ok: true, changed: true };
}

export async function removePilotUser(db: PilotDb, actor: Actor, userId: unknown, _now = new Date()): Promise<Change> {
  if (!isAdmin(actor)) return ADMIN_ONLY;
  const input = parsePilotUserInput(userId);
  if (!input.ok) return input;
  const user = await db.findUser(input.userId);
  if (!(await db.removePilotUser(input.userId))) return { ok: true, changed: false };
  await db.audit({ userId: actor.id, entity: "AiPilot", entityId: input.userId, action: "pilot_user_removed", oldValue: { name: user?.name ?? null, role: user?.role ?? null } });
  return { ok: true, changed: true };
}

export async function recordSignoff(db: PilotDb, actor: Actor, input: unknown, now = new Date()): Promise<Change> {
  if (!isAdmin(actor)) return ADMIN_ONLY;
  const parsed = parseSignoffInput(input);
  if (!parsed.ok) return parsed;
  const current = await db.currentSignoff();
  if (current && current.statementVersion === PILOT_STATEMENT_VERSION) return { ok: true, changed: false };
  await db.createSignoff({ statementVersion: PILOT_STATEMENT_VERSION, statement: PILOT_STATEMENT.join("\n"), acknowledgedById: actor.id, acknowledgedAt: now });
  await db.audit({ userId: actor.id, entity: "AiPilot", entityId: "signoff", action: "pilot_signoff_recorded", newValue: { statementVersion: PILOT_STATEMENT_VERSION } });
  return { ok: true, changed: true };
}

export async function revokeSignoff(db: PilotDb, actor: Actor, now = new Date()): Promise<Change> {
  if (!isAdmin(actor)) return ADMIN_ONLY;
  if ((await db.revokeSignoffs(actor.id, now)) === 0) return { ok: true, changed: false };
  await db.audit({ userId: actor.id, entity: "AiPilot", entityId: "signoff", action: "pilot_signoff_revoked" });
  return { ok: true, changed: true };
}

/** The key is encrypted by the caller-supplied function (src/lib/security/crypto.ts in production). Only its last four characters are ever shown or audited. */
export async function saveAiKey(db: PilotDb, actor: Actor, raw: unknown, encrypt: (value: unknown) => string, now = new Date()): Promise<Change> {
  if (!isAdmin(actor)) return ADMIN_ONLY;
  const parsed = parseAiKeyInput(raw);
  if (!parsed.ok) return parsed;
  const existing = await db.aiKeyMeta();
  const last4 = parsed.key.slice(-4);
  await db.saveAiKey(encrypt({ apiKey: parsed.key }), last4, actor.id, now);
  await db.audit({ userId: actor.id, entity: "AiPilot", entityId: "ai_key", action: existing ? "ai_key_replaced" : "ai_key_saved", newValue: { last4 } });
  return { ok: true, changed: true };
}

export async function removeAiKey(db: PilotDb, actor: Actor, _now = new Date()): Promise<Change> {
  if (!isAdmin(actor)) return ADMIN_ONLY;
  if (!(await db.deleteAiKey())) return { ok: true, changed: false };
  await db.audit({ userId: actor.id, entity: "AiPilot", entityId: "ai_key", action: "ai_key_removed" });
  return { ok: true, changed: true };
}

export type PilotState = {
  users: { userId: string; name: string; role: string; addedAt: Date; addedById: string }[];
  signoff: { statementVersion: string; acknowledgedById: string; acknowledgedByName: string | null; acknowledgedAt: Date; current: boolean } | null;
  aiKey: { last4: string; savedAt: Date; savedById: string } | null;
  agentOn: boolean;
  readiness: ReturnType<typeof pilotReadiness>;
};

/** Everything the Settings page shows. No key material: the database layer only ever hands back the last four characters. */
export async function loadPilotState(db: PilotDb): Promise<PilotState> {
  const [users, so, aiKey, agentOn] = await Promise.all([db.listPilotUsers(), db.currentSignoff(), db.aiKeyMeta(), db.agentOn()]);
  const who = so ? await db.findUser(so.acknowledgedById) : null;
  const signoff = so ? { statementVersion: so.statementVersion, acknowledgedById: so.acknowledgedById, acknowledgedByName: who?.name ?? null, acknowledgedAt: so.acknowledgedAt, current: so.statementVersion === PILOT_STATEMENT_VERSION } : null;
  return {
    users: users.map((u) => ({ userId: u.userId, name: u.name, role: u.role, addedAt: u.addedAt, addedById: u.addedById })),
    signoff: signoff && signoff.current ? signoff : null,
    aiKey,
    agentOn,
    readiness: pilotReadiness({ agentOn, aiKeySaved: !!aiKey, signoff: so }),
  };
}

/** The one question the reply assistant asks per request: may THIS user use it right now, and if not, why. */
export async function pilotAccess(db: PilotDb, userId: string): Promise<{ allowed: true } | { allowed: false; reason: PilotBlock }> {
  const [agentOn, key, so] = await Promise.all([db.agentOn(), db.aiKeyMeta(), db.currentSignoff()]);
  const ready = pilotReadiness({ agentOn, aiKeySaved: !!key, signoff: so });
  if (!ready.ready) return { allowed: false, reason: ready.missing[0] };
  return (await db.isListed(userId)) ? { allowed: true } : { allowed: false, reason: "not_in_pilot" };
}
