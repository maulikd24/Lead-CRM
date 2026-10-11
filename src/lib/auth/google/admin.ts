import { parseAllowedDomains } from "./index";

/** The data the settings page needs, as plain functions: the real one is in admin-wiring.ts, tests pass a fake. */
export interface GoogleSettingsDb {
  read(): Promise<string[]>;
  write(domains: string[]): Promise<void>;
  audit(entry: { userId: string; entity: "GoogleSignIn"; entityId: string; action: string; oldValue?: unknown; newValue?: unknown }): Promise<void>;
}

export type Result = { ok: true; domains: string[]; changed: boolean } | { ok: false; error: string };
export const MAX_DOMAINS = 20;

/** Admin only. Refuses anything that is not a plain domain (never silently drops it). An empty list switches Google sign-in off. */
export async function saveAllowedDomains(db: GoogleSettingsDb, actor: { id: string; role: string }, raw: unknown): Promise<Result> {
  if (actor.role !== "ADMIN") return { ok: false, error: "Only an Admin can change sign-in settings." };
  const text = typeof raw === "string" ? raw : "";
  const wanted = text.split(/[\s,;]+/).filter(Boolean);
  const domains = parseAllowedDomains(wanted);
  const rejected = wanted.filter((w) => !domains.includes(w.trim().toLowerCase()));
  if (rejected.length > 0) return { ok: false, error: `These are not plain domains (use the part after the @, like example.com): ${rejected.slice(0, 5).join(", ")}` };
  if (domains.length > MAX_DOMAINS) return { ok: false, error: `At most ${MAX_DOMAINS} domains.` };
  const before = await db.read();
  const same = before.length === domains.length && before.every((d, i) => d === domains[i]);
  if (same) return { ok: true, domains, changed: false };
  await db.write(domains);
  await db.audit({ userId: actor.id, entity: "GoogleSignIn", entityId: "allowed-domains", action: "google_signin_domains_changed", oldValue: { allowedDomains: before }, newValue: { allowedDomains: domains } });
  return { ok: true, domains, changed: true };
}
