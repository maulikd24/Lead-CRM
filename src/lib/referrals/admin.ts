import type { Actor } from "./ledger";
import { generateCode } from "./code";
import { can } from "./permissions";
import { validateRuleInput, type RuleFormInput, type RuleValue } from "./rewards";
import type { Role } from "@/generated/prisma/client";

/** Admin writes for the programme, over an injectable store. Each one re-checks the role itself. */
export interface AdminStore {
  findClientByCode(clientCode: string): Promise<{ id: string; name: string; status: string; mergedIntoId: string | null; isDeleted: boolean } | null>;
  /** "exists": already a referrer. "code_taken": the code collided (the caller draws another). */
  createReferrerWithCode(i: { clientId: string; createdById: string; code: string }): Promise<{ referrerId: string } | "exists" | "code_taken">;
  getReferrerStatus(referrerId: string): Promise<"ACTIVE" | "SUSPENDED" | null>;
  addCode(referrerId: string, code: string): Promise<"ok" | "code_taken">;
  /** False when the code is already revoked or missing. */
  revokeCode(codeId: string, by: string, reason: string): Promise<boolean>;
  setReferrerStatus(referrerId: string, status: "ACTIVE" | "SUSPENDED"): Promise<boolean>;
  createRule(v: RuleValue, active: boolean, by: string): Promise<string>;
  updateRule(id: string, v: RuleValue, active: boolean | undefined, by: string): Promise<boolean>;
  getRule(id: string): Promise<{ active: boolean; validFrom: Date | null } | null>;
  setRuleActive(id: string, active: boolean, validFrom: Date | null, by: string): Promise<boolean>;
  saveSetting(key: string, value: string, by: string): Promise<void>;
}

type Ok<T = object> = { ok: true } & T;
type Fail = { ok: false; error: string };
const NO: Fail = { ok: false, error: "You do not have permission to do that." };
const allowed = (a: Actor, action: Parameters<typeof can>[1]) => can(a.role as Role, action);
const MAX_ATTEMPTS = 5;

async function freshCode(add: (code: string) => Promise<string | "code_taken">, rng?: (n: number) => number): Promise<string | null> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const r = await add(generateCode(rng));
    if (r !== "code_taken") return r;
  }
  return null;
}

export async function enrollReferrer(i: { db: AdminStore; actor: Actor; clientCode: string; rng?: (n: number) => number }): Promise<Ok<{ referrerId: string }> | Fail> {
  if (!allowed(i.actor, "manage_referrers")) return NO;
  const client = await i.db.findClientByCode(i.clientCode.trim().toUpperCase());
  if (!client) return { ok: false, error: "No customer has that code. Use the customer code, for example CL-00001." };
  if (client.mergedIntoId || client.isDeleted) return { ok: false, error: "That customer record is merged or archived. Use the current one." };
  let created: string | "exists" | null = null;
  const id = await freshCode(async (code) => {
    const r = await i.db.createReferrerWithCode({ clientId: client.id, createdById: i.actor.id, code });
    if (r === "exists") return (created = "exists");
    if (r === "code_taken") return "code_taken";
    created = r.referrerId;
    return r.referrerId;
  }, i.rng);
  if (created === "exists") return { ok: false, error: "That customer is already a referrer." };
  return id ? { ok: true, referrerId: id } : { ok: false, error: "Could not make a code. Try again." };
}

export async function issueCode(i: { db: AdminStore; actor: Actor; referrerId: string; rng?: (n: number) => number }): Promise<Ok | Fail> {
  if (!allowed(i.actor, "manage_referrers")) return NO;
  if ((await i.db.getReferrerStatus(i.referrerId)) !== "ACTIVE") return { ok: false, error: "Only an active referrer can get a new code." };
  const made = await freshCode(async (code) => ((await i.db.addCode(i.referrerId, code)) === "ok" ? code : "code_taken"), i.rng);
  return made ? { ok: true } : { ok: false, error: "Could not make a code. Try again." };
}

export async function revokeCode(i: { db: AdminStore; actor: Actor; codeId: string; reason: string }): Promise<Ok | Fail> {
  if (!allowed(i.actor, "manage_referrers")) return NO;
  const reason = i.reason.trim();
  if (reason.length < 3) return { ok: false, error: "Give a reason for revoking the code." };
  return (await i.db.revokeCode(i.codeId, i.actor.id, reason.slice(0, 200))) ? { ok: true } : { ok: false, error: "That code is already revoked." };
}

export async function setReferrerStatus(i: { db: AdminStore; actor: Actor; referrerId: string; status: "ACTIVE" | "SUSPENDED" }): Promise<Ok | Fail> {
  if (!allowed(i.actor, "manage_referrers")) return NO;
  if (i.status !== "ACTIVE" && i.status !== "SUSPENDED") return { ok: false, error: "Unknown status." };
  return (await i.db.setReferrerStatus(i.referrerId, i.status)) ? { ok: true } : { ok: false, error: "That referrer does not exist." };
}

/** A rule saved with `activate` (or toggled on) and no start date starts now: switching a rule on never pays for events that already happened. */
export async function saveRule(i: { db: AdminStore; actor: Actor; input: RuleFormInput; ruleId?: string; activate: boolean | undefined; now: Date }): Promise<Ok<{ ruleId: string }> | Fail> {
  if (!allowed(i.actor, "manage_rules")) return NO;
  const v = validateRuleInput(i.input);
  if (!v.ok) return v;
  const value = i.activate && !v.value.validFrom ? { ...v.value, validFrom: i.now } : v.value;
  if (i.ruleId) return (await i.db.updateRule(i.ruleId, value, i.activate, i.actor.id)) ? { ok: true, ruleId: i.ruleId } : { ok: false, error: "That rule does not exist." };
  return { ok: true, ruleId: await i.db.createRule(value, i.activate === true, i.actor.id) };
}

export async function setRuleActive(i: { db: AdminStore; actor: Actor; ruleId: string; active: boolean; now: Date }): Promise<Ok | Fail> {
  if (!allowed(i.actor, "manage_rules")) return NO;
  const rule = await i.db.getRule(i.ruleId);
  if (!rule) return { ok: false, error: "That rule does not exist." };
  const from = i.active && !rule.validFrom ? i.now : rule.validFrom;
  return (await i.db.setRuleActive(i.ruleId, i.active, from, i.actor.id)) ? { ok: true } : { ok: false, error: "That rule does not exist." };
}

export const SETTING_KEYS = ["disclaimer", "velocity_limit"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export async function saveSetting(i: { db: AdminStore; actor: Actor; key: SettingKey; value: string }): Promise<Ok | Fail> {
  if (!allowed(i.actor, "manage_settings")) return NO;
  const value = i.value.trim();
  if (i.key === "disclaimer") {
    if (value.length > 600) return { ok: false, error: "Keep the disclaimer under 600 characters." };
  } else if (i.key === "velocity_limit") {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 1000) return { ok: false, error: "Enter a whole number from 1 to 1000." };
  } else return { ok: false, error: "Unknown setting." };
  await i.db.saveSetting(i.key, value, i.actor.id);
  return { ok: true };
}
