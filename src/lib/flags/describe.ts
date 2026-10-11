import type { Cond, FlagDef, Requirement } from "./types";

/** A short, value-free reading of a condition, for the generated docs and the Admin Flags tab. */
export function describeCond(c: Cond): string {
  if ("on" in c) return `${c.on}=1`;
  if ("set" in c) return `${c.set} set`;
  if ("eq" in c) return `${c.eq}=${c.value}`;
  if ("listHas" in c) return `${c.value} in ${c.listHas}`;
  if ("cred" in c) return `${c.cred} (credential)`;
  if ("aiKey" in c) return "AI provider key";
  if ("prod" in c) return "VERCEL_ENV=production";
  if ("dbNonLocal" in c) return "a non-local DATABASE_URL";
  if ("matches" in c) return `${c.matches} = ${c.twin}`;
  if ("anyOf" in c) return c.anyOf.map(describeCond).join(" or ");
  if ("allOf" in c) return c.allOf.map(describeCond).join(" and ");
  return `not (${describeCond(c.not)})`;
}

const withRule = (r: Requirement, text: string) => `${text} [${r.rule}${r.severity === "warn" ? ", warn" : ""}]`;

/** "Depends on" cell: what must hold when the flag is on. */
export function dependsOn(def: FlagDef): string[] {
  const out = def.requires.map((r) => withRule(r, describeCond(r.cond)));
  for (const r of def.requiresAlways) out.push(withRule(r, `${describeCond(r.cond)} (always)`));
  for (const s of def.requiresAgentSetting ?? []) out.push(`AgentSetting ${s} on (database)`);
  if (def.requiresAiSignoff) out.push("recorded AI pilot sign-off (database)");
  if (def.requiresTrustSignoff) out.push("recorded compliance sign-off of the trust-strip wording (database); without it the strip is not shown");
  return out;
}

/** "Conflicts with" cell: what must NOT hold when the flag is on. */
export function conflictsWith(def: FlagDef): string[] {
  const out = def.conflictsWith.map((r) => withRule(r, describeCond(r.cond)));
  if (def.kind === "blocked") out.unshift("on in any profile [FR-05]");
  return out;
}

export function effectsOf(def: FlagDef): string[] {
  const e = def.effects;
  return [e.outbound && "outbound", e.vendorSharing && "vendor-sharing", e.ai && "AI", e.pii && "PII"].filter((x): x is string => !!x);
}
