import { canAccessMarketing } from "@/lib/access/marketing-access";
import { requireRole } from "@/lib/auth/require-role";
import { creativeIntelEnabled, directorReportsEnabled } from "@/lib/creative/flags";

/**
 * The one door for every creative and report server action. requireRole bounces anyone who is not ADMIN or MARKETING before
 * anything else runs; canAccessMarketing is checked again on the session's role (so the two can never drift); the feature
 * flag is checked last. Returns null when the feature is switched off.
 */
export type Actor = { id: string; role: string };
export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const OFF: ActionResult = { ok: false, error: "This feature is switched off on this server." };

export async function creativeGate(): Promise<Actor | null> {
  const session = await requireRole(["ADMIN", "MARKETING"]);
  if (!canAccessMarketing(session.user.role) || !creativeIntelEnabled()) return null;
  return { id: session.user.id, role: session.user.role as string };
}

export async function reportsGate(): Promise<Actor | null> {
  const session = await requireRole(["ADMIN", "MARKETING"]);
  if (!canAccessMarketing(session.user.role) || !directorReportsEnabled()) return null;
  return { id: session.user.id, role: session.user.role as string };
}

/** Admin-only settings (recipients, the AI kill switch). */
export async function adminCreativeGate(flag: "creative" | "reports"): Promise<Actor | null> {
  const session = await requireRole(["ADMIN"]);
  if (flag === "creative" ? !creativeIntelEnabled() : !directorReportsEnabled()) return null;
  return { id: session.user.id, role: session.user.role as string };
}

export const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
